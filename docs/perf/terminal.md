# Replay terminal performance and verification

> **Historical acceptance snapshot (commit `44e950e`).** The terminal was optimized afterwards; see
> [terminal-optimization.md](terminal-optimization.md) for the same-harness before/after comparison, the current
> benchmark numbers, and the measurement boundaries. The counts and timings below describe the acceptance build,
> not the current tree.

The terminal aggregates 5-minute tapes for display and steps pinned instruments through one shared replay clock.
This page separates the acceptance run from historical microbenchmarks: the current replay-step and chart-frame
numbers come from a fresh production build, while the aggregation table remains a labelled prior measurement.

## Current acceptance run

Production build at acceptance (`bun run build`): **9.25 MB total / 2.32 MB gzip**, built in 25.0 s. The server
was started with `PORT=4173 HOST=127.0.0.1 node .output/server/index.mjs`; all browser checks below ran against
that server, not the dev server.

| Gate                                          | Result                                         |
| --------------------------------------------- | ---------------------------------------------- |
| `bun run test`                                | 829 tests / 43 files                           |
| `bun run typecheck`                           | clean                                          |
| `bun run format:check`                        | clean                                          |
| `cargo test --manifest-path wasm/Cargo.toml`  | 10 passed                                      |
| `bun run check:terminal`                      | 65 checks passed                               |
| `bun run smoke`                               | 18 flows, no console errors                    |
| `bun run audit:theme`                         | 5 routes × light/dark, terminal 218 text nodes |
| `bun run check:wasm`                          | 4 checks passed                                |
| `bun run check:analysis` / `check:executions` | passed (11 / 5 checks)                         |

### Replay and chart responsiveness

`scripts/bench-terminal.mjs` uses a fresh production context per cold sample and three hot scenarios, each stepping
the real replay button. It measures event-to-next-presented-RAF latency covering every visible pane, plus the chart
callback CPU inside that frame. Input is a programmatic `HTMLElement.click()` on the real toolbar button; OS input,
pointer delivery, paint, compositing and checkpoint drain are outside the number.

| Scenario                        | Response P95                  | Chart callback P95 |
| ------------------------------- | ----------------------------- | ------------------ |
| Single pane, TA off             | 26.4 ms                       | 2.8 ms             |
| Three panes, TA off             | 26.7 ms                       | 3.9 ms             |
| Single pane, TA on              | 27.8 ms                       | 3.5 ms             |
| Cold open → ready + drawn chart | **938.7 ms P95** (30 samples) | —                  |

Budgets are **50 ms** hot response, **16.7 ms** chart callback, **1500 ms** cold. The aggregate 90-event hot sample
was **P95 26.8 ms / P50 23.8 ms / max 30.8 ms**; synchronous click work P95 1.3 ms; draw CPU P95 3.8 ms; the largest
single chart callback was 3.8 ms. Raw samples and machine metadata are in [`terminal-ui.json`](./terminal-ui.json).

These are single-machine, headless Chrome numbers, not a live-market SLA. The terminal is a historical replay desk:
tapes are 5-minute OHLCV, execution is a deterministic matcher, and no claim is made about exchange queue position,
real spreads or live fill quality.

## Reproduction

Run the benchmark alone, not alongside tests/builds. Browser scripts need a running server; use a production
preview when recording acceptance evidence.

```bash
bun run bench:timeframes # aggregation parity, latency and artifact budgets
bun run bench:terminal   # replay-step and chart-frame responsiveness (production server)
bun run check:terminal   # 65 browser checks; BASE_URL defaults to http://localhost:3000
bun run check:wasm       # first-paint and single-fetch checks
```

`bench:terminal` expects a production preview on `127.0.0.1:4173` by default. Use `SAMPLES`/`COLD_SAMPLES` for a
quick pass and `PERF_OUTPUT` to choose where the JSON evidence is written; a full run uses 30 + 30 samples.

## Prior aggregation measurement

The existing recorded run used artifact **`6f25df2fa549bae9`**. These are historical local microbenchmark values,
not new measurements of the current UI. `scripts/bench-timeframes.ts` builds a 13,000-bar tape and compares each
Rust-backed `aggregateCandles` result against `aggregateCandlesTs`. It times the public aggregation paths,
including validation, session filtering and the WASM ABI where applicable—not just a raw Rust loop or a browser
chart paint.

| Frame | P50  | P95  | P99  |
| ----- | ---- | ---- | ---- |
| all   | 3.74 | 4.67 | 5.69 |
| 15m   | 4.55 | 5.69 | 5.69 |
| 30m   | 3.93 | 4.67 | 4.67 |
| 1h    | 3.69 | 4.01 | 4.01 |
| 4h    | 3.43 | 4.19 | 4.19 |
| 1D    | 3.25 | 3.69 | 3.69 |
| 45m   | 3.70 | 4.53 | 4.53 |

Milliseconds; six warm-up calls, then **60 total samples** rotating through six frames (ten per frame). Per-frame
P95/P99 are therefore coarse, effectively the maximum of ten samples. The script fails at overall P95 **≥10 ms**.
The TypeScript reference was faster in this recorded run (**P95 0.67 ms**); these numbers do not establish a WASM
speedup. Non-base aggregation falls back to the TypeScript reducer if the optional export is absent or fails.

Base `5m` skips higher-timeframe reduction and the WASM call, but still pays for prefix slicing, validation and
session filtering. It is not a zero-cost operation. Rendering, TA, multi-pane updates and storage are not timed by
this benchmark. Execution, drawdown and consistency state transitions remain TypeScript; WASM is used for
aggregation and the existing optional analysis helpers.

## Prior artifact measurement

Same recorded artifact; sizes cover the **whole shared core**, not just terminal aggregation.

| Metric | Value     | Budget (KiB) |
| ------ | --------- | ------------ |
| raw    | 157.6 KiB | 160          |
| brotli | 58.8 KiB  | 60           |
| gzip   | 69.1 KiB  | 70           |

`tests/unit/wasm-budget.spec.ts` checks sizes, compression ratio, required core exports and content hash.
`scripts/bench-timeframes.ts` additionally requires `prop_aggregate` and verifies aggregation parity. The loader
keeps that export optional so an older artifact can still run the terminal with the TypeScript reducer.

## Replay stepping and persistence

`app/stores/terminal.ts` uses a 250 ms timer, accumulating `speed × 0.5` steps per tick. At 1× this requests two
shared-timeline entries per second; it is not a real-time market clock or a measured latency guarantee. Supported
speeds are 0.5×/1×/2×/4×. `stepBars` accepts integers 1–10000 and clamps at tape exhaustion.

The last revealed timestamp is `timeline[cursor - 1]`; symbol-local bars and session boundaries follow that
clock. `tests/unit/sim-replay.spec.ts` covers deterministic actions, sparse tapes, no-lookahead, scheduled closes,
exhaustion and validated continuation. A replay ending mid-session does not fabricate a final close.

Pinned runs and engine checkpoints live in IndexedDB. Writes are asynchronous, but snapshot creation and
serialization are not measured here. Save failures can leave the most recent state unsaved; the UI reports them
and offers Retry. Failed restore sets `restoreBlocked` and does not silently overwrite the attempt.

## Browser acceptance scope

`scripts/check-terminal.mjs` is a behavioral check source, not a performance benchmark. The accepted run executes
**65 checks** at 1440 and 390 px: market entry and steps, four independent technical-analysis frameworks, custom
45-minute timeframes, quote volume/account details, canvas **order drag/amend/cancel**, drawing isolation, confirmed
Exit all, three-pane layouts with per-pane study panels, layout reload/close, hotkey remapping and typing isolation,
mobile ticket/study bounds, and corrupt-checkpoint retry without silent reset. It records console/page errors and
horizontal overflow.

The script is not exhaustive end-to-end coverage of every order type, risk rule or breakpoint. It proves the named
flows and the absence of the named errors; it does not prove exchange-grade execution or every combination of
instruments and templates.

The source-level acceptance map is in [the terminal design document](../design/trading-terminal.md#7-acceptance-evidence-map).

## Limits

- The timing values are from one local machine/runtime, not a cross-device or live-market SLA. Aggregation's
  timing gate is the standalone benchmark; normal unit tests enforce correctness and artifact budgets.
- Replay-step and chart-frame numbers exclude OS input, paint/compositing and IndexedDB checkpoint drain.
  Checkpoint serialization/write latency is not measured.
- A 5-minute OHLCV tape cannot validate exchange queue position, partial fills, spreads or real execution quality.
- Session handling is weekly (Monday–Friday, 17:00–16:00 Chicago); exchange holidays and early closes are not modelled.
- Browser checks use headless Chrome. Mobile layout is viewport-checked, not tested on a physical device.
