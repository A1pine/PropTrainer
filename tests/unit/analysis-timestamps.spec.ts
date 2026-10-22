import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeMarket } from '@/domain/analysis/analyze'
import type { AnalysisReport } from '@/domain/analysis/types'
import type { Candle } from '@/domain/market/types'
import { createWasmCore } from '@/domain/wasm/core'

const startTime = Date.parse('2026-03-06T05:00:00Z') / 1000
const step = 300
const artifact = readFileSync(resolve(process.cwd(), 'public/wasm/prop_core.wasm'))

interface AnalyzePayload {
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
  time?: number[]
  startTime: number
  step: number
}

function makeCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => ({
    time: startTime + index * step,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1000,
  }))
}

async function analyzeWithPayload(candles: readonly Candle[]) {
  const { instance } = await WebAssembly.instantiate(artifact, {})
  const exports = instance.exports as unknown as Parameters<typeof createWasmCore>[0]
  const requests: AnalyzePayload[] = []
  const core = createWasmCore({
    ...exports,
    prop_analyze(pointer, length) {
      requests.push(JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, length))))
      return exports.prop_analyze(pointer, length)
    },
  })
  const report = core.analyze(candles)
  expect(requests).toHaveLength(1)
  return { report, payload: requests[0]! }
}

function expectEventTimes(report: AnalysisReport, candles: readonly Candle[]) {
  expect(report.events.length).toBeGreaterThan(0)
  expect(report.events.some((event) => event.index === candles.length - 1)).toBe(true)
  for (const event of report.events) {
    expect(event.index).toBeGreaterThanOrEqual(0)
    expect(event.index).toBeLessThan(candles.length)
    expect(event.time).toBe(candles[event.index]!.time)
  }
}

describe('analysis timestamps', () => {
  it('keeps the compact path for verified regular candles', async () => {
    const candles = makeCandles(48)
    const { report, payload } = await analyzeWithPayload(candles)
    expect(payload).not.toHaveProperty('time')
    expect(payload.startTime).toBe(startTime)
    expect(payload.step).toBe(step)
    expectEventTimes(report, candles)
    expect(report.ict.session).toBe('london')
    expect(report.ict.killzone).toBe(true)
  })

  it.each([
    { name: 'session break', gapIndex: 40, resume: '2026-03-06T17:00:00Z', session: 'late', killzone: false },
    { name: 'weekend break', gapIndex: 40, resume: '2026-03-09T12:00:00Z', session: 'newYork', killzone: true },
    {
      name: 'gap in the first interval',
      gapIndex: 1,
      resume: '2026-03-09T12:00:00Z',
      session: 'newYork',
      killzone: true,
    },
    {
      name: 'gap at the last candle',
      gapIndex: 47,
      resume: '2026-03-09T12:00:00Z',
      session: 'newYork',
      killzone: true,
    },
  ])('preserves actual timestamps across a $name', async ({ gapIndex, resume, session, killzone }) => {
    const candles = makeCandles(48).map((candle, index) => ({
      ...candle,
      time: index < gapIndex ? candle.time : Date.parse(resume) / 1000 + (index - gapIndex) * step,
    }))
    const { report, payload } = await analyzeWithPayload(candles)
    expect(payload.time).toEqual(candles.map((candle) => candle.time))
    expectEventTimes(report, candles)
    expect(report.ict.session).toBe(session)
    expect(report.ict.killzone).toBe(killzone)
  })

  it('uses only the visible prefix, before and after a weekend gap', async () => {
    const tape = makeCandles(80).map((candle, index) => ({
      ...candle,
      time:
        index < 40
          ? candle.time
          : index < 60
            ? Date.parse('2026-03-09T12:00:00Z') / 1000 + (index - 40) * step
            : Date.parse('2026-03-10T18:00:00Z') / 1000 + (index - 60) * step,
    }))
    expect(analyzeMarket(tape)!.ict.session).toBe('late')

    for (const length of [40, 50]) {
      const visible = tape.slice(0, length)
      const { report, payload } = await analyzeWithPayload(visible)
      expect(analyzeMarket(visible)).toEqual(report)
      for (const column of ['open', 'high', 'low', 'close', 'volume'] as const) {
        expect(payload[column]).toEqual(visible.map((candle) => candle[column]))
      }
      if (length === 40) {
        expect(payload).not.toHaveProperty('time')
      } else {
        expect(payload.time).toEqual(visible.map((candle) => candle.time))
      }
      expectEventTimes(report, visible)
      expect(report.indicators.ema20).toHaveLength(length)
      expect(report.flow.delta).toHaveLength(length)
      expect(report.indicators.latest.price).toBe(visible.at(-1)!.close)
      expect(report.ict.session).toBe(length === 40 ? 'london' : 'newYork')
      expect(report.ict.killzone).toBe(true)
    }
  })
})
