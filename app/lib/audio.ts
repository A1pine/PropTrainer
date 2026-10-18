/**
 * Tiny Web Audio cue synthesizer. No binary assets, no network, no autoplay:
 * the context is created on the first gesture-driven call.
 */
type Cue = 'fill' | 'win' | 'loss' | 'breach' | 'reveal' | 'tick'

let context: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    context = new Ctor()
  }
  if (context.state === 'suspended') void context.resume()
  return context
}

function tone(
  ctx: AudioContext,
  frequency: number,
  at: number,
  duration: number,
  options: { type?: OscillatorType; gain?: number; endFrequency?: number } = {},
) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = options.type ?? 'sine'
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + at)
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, ctx.currentTime + at + duration)
  }
  const peak = options.gain ?? 0.06
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
  gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + duration)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(ctx.currentTime + at)
  oscillator.stop(ctx.currentTime + at + duration + 0.02)
}

export function playCue(cue: Cue, enabled: boolean) {
  if (!enabled) return
  const ctx = getContext()
  if (!ctx) return
  switch (cue) {
    case 'fill':
      tone(ctx, 880, 0, 0.05, { gain: 0.04 })
      break
    case 'tick':
      tone(ctx, 660, 0, 0.035, { gain: 0.025 })
      break
    case 'win':
      tone(ctx, 523.25, 0, 0.16, { gain: 0.05 })
      tone(ctx, 783.99, 0.1, 0.24, { gain: 0.05 })
      break
    case 'loss':
      tone(ctx, 392, 0, 0.18, { gain: 0.045 })
      tone(ctx, 311.13, 0.1, 0.22, { gain: 0.04 })
      break
    case 'breach':
      tone(ctx, 220, 0, 0.12, { type: 'square', gain: 0.035 })
      tone(ctx, 164.81, 0.14, 0.2, { type: 'square', gain: 0.03 })
      break
    case 'reveal':
      tone(ctx, 330, 0, 0.3, { gain: 0.04, endFrequency: 660 })
      break
  }
}
