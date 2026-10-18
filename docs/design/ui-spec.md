# Prop Desk — UI design specification

Status: accepted · Owner: design + frontend · Scope: web app (desktop-first, mobile supported)

## 1. Product frame

**Who**: a discretionary futures trader preparing for a prop-firm evaluation (MNQ / NQ / MES / ES / MYM / M2K / MGC / MCL, plus crypto perps).

**Task**: practise execution on a chart whose symbol, date and price axis are hidden. Candles print one bar at a time.
The trader must read structure, decide direction, size by risk, place bracketed orders, and survive the account rules.
A second mode grades the decision itself: market state → thesis → entry / stop / target plan.

**Scope**: a complete app — dashboard, trainer, decision drill, daily challenge, pass-and-play PK, statistics, settings, guide.

**Main actions, in order of weight**
1. Start or continue a blind session (primary).
2. Read the chart and step candles (space / next bar).
3. Place and manage a bracketed futures order (risk-first sizing).
4. Submit a drill plan and read the graded feedback.
5. Review statistics and adjust settings.

## 2. Visual concept — "the quiet desk"

A prop desk should feel like a place to think, not a slot machine.

- **First impression**: warm paper surfaces and a large, calm chart. A serif display line and one clay-coloured action.
  No neon, no gradient chrome, no ticker tape noise.
- **Why it fits**: blind replay is an exercise in patience. The interface lowers arousal, keeps numbers legible,
  and reserves saturated colour for the moments that matter: the primary action, the live price, the reveal.
- **How it carries across pages**: every page is composed of the same four things — a hairline-framed panel,
  a serif caption, mono numerals, and a single clay accent. Density changes, the material does not.
- **Signature details**:
  - A "veil" over the price axis in blind mode: masked digits with a slow shimmer.
  - The chart is framed like a printed market plate: corner ticks, `SESSION 03 / 20` in the corner.
  - The reveal wipes the veil away (clip-path) and unmasks the symbol and date.
  - The order ticket sizes in **contracts**, not USDT. Risk in dollars is the headline; leverage is a consequence.

## 3. Viewports

| Target | Logical viewport | Layout |
| --- | --- | --- |
| Desktop | 1440 × 900 | 244px rail + fluid main; 12-col grid; chart 8 cols, ticket 4 cols |
| Laptop | 1280 × 800 | rail 224px; chart 7 cols, ticket 5 cols |
| Tablet | 834 × 1112 | rail collapses to icons (72px); ticket below chart |
| Mobile | 390 × 844 | top bar + bottom tab bar (64px); chart full-bleed; ticket in a bottom sheet |

Scrolling: pages scroll vertically; the trainer viewport is height-locked (`100dvh`) on desktop with independent
panel scroll. Safe areas respected on iOS (`env(safe-area-inset-*)`).

## 4. Grid, spacing, radii

- Spacing base 4px; recurring rhythm 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Panel radius 12px, control radius 8px, pill 999px, dialog 16px (CDS-derived).
- Hairline: 1px at 1×, 0.5px at 2×, 0.333px at 3× — set through `--hairline`.
- Single-ring principle: one border per surface, never border + outline + heavy shadow.
- Max content width 1480px centered; dashboard gutters 32px desktop / 16px mobile.

## 5. Colour tokens

Light (default) — warm neutrals, clay accent, muted market colours.

| Token | Value | Use |
| --- | --- | --- |
| surface-0 | `#f9f9f7` | app canvas / rail |
| surface-1 | `#fcfcfb` | page canvas |
| surface-2 | `#ffffff` | panels, cards |
| surface-3 | `#ffffff` | overlays, inputs |
| ink | `#151515` | primary text |
| ink-2 | `#525252` | secondary text |
| ink-3 | `#8a8a8a` | muted labels, axis |
| line | `rgba(20,20,20,.10)` | hairlines |
| line-strong | `rgba(20,20,20,.20)` | hover borders |
| clay | `#d97757` | primary action, active nav, focus |
| clay-hover | `#cc5a36` | hover |
| clay-soft | `#fbf3ef` | selected tint |
| bull | `#5b7f6b` | up candles, profit |
| bull-soft | `rgba(91,127,107,.12)` | profit tint |
| bear | `#b5533d` | down candles, loss |
| bear-soft | `rgba(181,83,61,.12)` | loss tint |
| warn | `#b8862f` | rule warning |
| danger | `#c0392b` | rule breach, destructive |

Dark — `#0b0b0b` / `#151515` / `#1a1a19` / `#20201f`; ink `#f5f5f5`, ink-2 `#a3a3a3`, ink-3 `#6b6b6b`;
line `rgba(255,255,255,.10)`; clay `#e08264`; bull `#83bfa0`; bear `#e79880`.

Market colour never carries meaning alone: arrows, `+/-` signs and labels accompany it.

## 6. Typography

- Sans: system UI stack, with CJK fallbacks (PingFang SC / Hiragino Sans).
- Serif: `ui-serif, Georgia, 'Iowan Old Style', 'Songti SC', serif` — used only for display lines and large numerals.
- Mono: `ui-monospace, 'SF Mono', Menlo` — all prices, P&L, quantities, timers; `font-variant-numeric: tabular-nums`.
- Scale: display 56/44 (serif, -0.03em), h1 32, h2 22, h3 17, body 14/1.55, label 12, micro 11 uppercase +0.12em.
- Dark mode: reduce synthetic weight (465 / 560) to counter optical bloom.

## 7. Components

| Component | Rules |
| --- | --- |
| Button | 4 sizes (xs 28, sm 32, md 38, lg 46), variants primary / secondary / ghost / outline / danger; `active:scale(.98)`; clay focus ring 2px offset 2px |
| Segmented | pill track, sliding white thumb, keyboard arrows, `role=tablist` |
| Panel | surface-2, 1px line, radius 12, no shadow at rest; hover lifts 1.5px on interactive cards only |
| Stat | label micro uppercase, mono value, delta chip, optional sparkline |
| Order ticket | side toggle (long/short), market/limit, contracts stepper with risk-derived suggestion, bracket inputs, live margin/fee/risk summary, submit |
| Position row | side chip, size, entry, mark, uP&L, R multiple, close/breakeven buttons |
| Chart | canvas, 28px right axis gutter, volume histogram 18% height, hairline grid, crosshair + OHLC tooltip, drawing toolbar |
| Playback bar | play/pause, next bar, speed, progress ticks, reveal button (hold-to-confirm) |
| Stepper (drill) | 3 steps, clay progress line, completed check, locked state |
| Dialog | backdrop `blur(8px)` + 40% ink; panel 16px radius, scale 0.97→1 with overshoot; Esc + focus trap |
| Toast | bottom-right desktop / top mobile; icon + text + undo; 4s auto-dismiss |
| Command palette | ⌘K; grouped results, arrow navigation, 40ms stagger |
| Empty state | one-line explanation + one action; thin line illustration drawn in CSS/SVG |

## 8. Motion

Physics from CDS: `--ease-swift (.16,1,.3,1)`, `--ease-enter (.22,1,.36,1)`, `--ease-pop (.34,1.56,.64,1)`,
`--ease-snap (.32,.72,0,1)`. Durations: 120ms micro, 220ms standard, 320ms page, 600ms reveal.

| Moment | Treatment |
| --- | --- |
| Route change | 180ms out (fade, 4px down) → 320ms in (fade, 10px rise), staggered children 40ms |
| New candle | 180ms grow from open to close/high/low, wick draws 120ms after body; live price dot pulses once |
| Price/equity update | rAF number ticker, 400ms ease-out, tabular digits |
| Primary CTA | ambient clay glow breathing 3.2s, hover lift 1.5px |
| Session start | full-screen "dealing" overlay: three cards riffle, then chart unfolds (900ms) |
| Reveal | veil wipes left→right 600ms, masked digits scramble 400ms, symbol/date fade up |
| Correct drill answer | clay/sage particle burst (24 particles, 900ms), score counts up |
| Rule breach | panel border flashes danger 2× 160ms, toast |
| Sidebar nav | active pill slides (shared layout), 220ms spring |
| Chart crosshair | follows pointer with no lag; tooltip fades in 90ms |

Respect `prefers-reduced-motion` and an in-app "reduce motion" setting: disable particles, wipes and parallax;
keep opacity transitions ≤120ms.

## 9. Sound

Optional, off by default. Web Audio oscillators only (no assets): fill tick (880Hz, 40ms), win chime (523→784Hz),
rule breach (220Hz square, 120ms), reveal swell (330→660Hz). Volume 0.3 max. Never autoplay before a gesture.

## 10. Content and states

- English is the source language. All strings live in `i18n/locales/en.json`; zh-CN and ja mirror the keys 1:1.
- Numbers: prices to tick precision, money with `$` and thousands separators, R multiples to 2 decimals, percent 1 decimal.
- Every async or empty surface has three states: skeleton (shimmer), empty (explain + action), error (retry).
- Blind mode always states what is hidden and why: "Symbol, date and absolute price are hidden until reveal."
- The app labels simulated data and simulated rivals/benchmarks plainly. No fake testimonials, no invented payouts.

## 11. Assets

No photography, no raster assets. Brand mark is inline SVG (candlestick glyph). Icons: Lucide at 1.5px stroke,
16/18/20px sizes. Chart is code-drawn. Grain texture is a CSS radial mask at 2% opacity, disabled in dark mode
and reduced motion.

## 12. Acceptance

- 1440 and 390 screenshots of dashboard, trainer, drill, stats; no clipped text, no horizontal scroll.
- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries.
- Keyboard: every control reachable, visible focus ring, Esc closes overlays, space steps the chart when not typing.
- Motion: no layout shift on route enter, no animation longer than 600ms except ambient loops.
- The chart remains readable at 390px width with the ticket collapsed into a sheet.
