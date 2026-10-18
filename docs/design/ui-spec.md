# Prop Desk — UI & Motion Specification

> Produced with the `draw-ui` skill. This document is the design baseline for the implementation.
> Reference direction: **open-claude-ui / Claude Design System (CDS)** — editorial warmth, low-contrast
> surfaces, hairline geometry, calibrated spring motion. It is a style reference, not a component copy.

---

## 1. Product frame

**Who.** A futures trader preparing for a prop-firm evaluation. They already know what a stop is; they
need to rehearse _reading structure, waiting for a setup, sizing by risk, and surviving drawdown rules_
without risking capital.

**Job to be done.** Open the app, get a blind sample from a familiar instrument universe (MNQ, NQ, MES,
ES, MYM, M2K, MGC, MCL), judge the market, place a bracketed plan, watch it resolve bar by bar, and
receive a process grade that is separate from the P&L.

**Main action.** `Start blind session` → `Judge` → `Plan` → `Run replay` → `Review` → `Next round`.

**Scope of this design.** Five routes: Lobby, Trainer, Stats, Settings, Guide. Trainer is the center of
gravity; the other routes support preparation, review, and trust.

---

## 2. Visual concept — “The Quiet Terminal”

The first impression should be **calm control**, not a casino. A warm paper-like canvas holds one
luminous analytical surface: the chart. Everything else is quiet instrumentation around it.

| Decision                                                                 | Rationale                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Warm off-white canvas (`#f9f9f7`) instead of pure white                  | Reduces glare during long drills; matches CDS editorial warmth.         |
| Clay accent (`#d97757`) used sparingly for intent, focus, and live state | The eye should find the next action, not a wall of brand color.         |
| Charcoal text (`#151515`) with secondary warm grays                      | High legibility without the coldness of blue-gray dashboards.           |
| Hairline panels, almost no shadow                                        | Reads as precision instruments; depth comes from micro-luminance steps. |
| Serif display only on Lobby / review headlines                           | A human, editorial voice; the Trainer stays sans + mono for speed.      |
| Mono tabular numerals for every price, P&L, timer, and size              | No layout jitter while values animate.                                  |
| Market colors are muted sage / brick, never neon                         | Color supports meaning but is always paired with a sign or label.       |
| One large chart + one floating ticket                                    | The central decision is “what is the structure, and what is my risk?”   |

**Signature moment.** On the Lobby, a miniature replay chart paints its candles in sequence inside a
soft clay ambient glow while a live price line travels across it. The headline sits asymmetrically to
the left. On the Trainer, that same chart becomes full-size and the ticket slides in from the right on
a spring, like a desk drawer settling into place.

**What we deliberately avoid.** Glassmorphism everywhere, purple/blue gradients, glowing neon grids,
crypto-exchange visual noise, mascots, gamified coin icons, and dense tables with no hierarchy.

---

## 3. Design tokens

### 3.1 Color

| Token              | Light                    | Dark                    | Use                         |
| ------------------ | ------------------------ | ----------------------- | --------------------------- |
| `--surface-0`      | `#f9f9f7`                | `#0b0b0a`               | App canvas                  |
| `--surface-1`      | `#fcfcfb`                | `#151514`               | Rails, secondary panels     |
| `--surface-2`      | `#ffffff`                | `#1a1a19`               | Cards, ticket, popovers     |
| `--surface-3`      | `#ffffff`                | `#20201e`               | Hover / elevated chips      |
| `--text-primary`   | `#151515`                | `#f5f5f2`               | Headings, values            |
| `--text-secondary` | `#5b5a56`                | `#b9b7b0`               | Labels, body                |
| `--text-muted`     | `#8a8882`                | `#807e78`               | Hints, metadata             |
| `--border`         | `rgba(21,21,21,.08)`     | `rgba(255,255,255,.09)` | Hairlines                   |
| `--border-strong`  | `rgba(21,21,21,.16)`     | `rgba(255,255,255,.18)` | Hover / focus geometry      |
| `--clay`           | `#d97757`                | `#cc6b49`               | Primary action, live state  |
| `--clay-deep`      | `#b95434`                | `#e08464`               | Pressed / emphasis text     |
| `--clay-wash`      | `#fbf1ec`                | `#2a1a14`               | Selected chips, tinted rows |
| `--positive`       | `#5c7f68`                | `#86ab90`               | Long, profit, pass          |
| `--negative`       | `#b4554b`                | `#d98b80`               | Short, loss, breach         |
| `--warning`        | `#a97a34`                | `#d2a45e`               | Caution, near breach        |
| `--focus`          | clay ring + 6px 25% halo | same                    | Keyboard focus              |

Surface steps are tiny on purpose. Borders do the separating; shadows are reserved for floating layers.

### 3.2 Type

| Role            | Stack                                         | Size / leading                        | Weight  |
| --------------- | --------------------------------------------- | ------------------------------------- | ------- |
| Display         | `ui-serif, Georgia, 'Times New Roman', serif` | `clamp(2.6rem, 6vw, 4.9rem)` / 0.98   | 500     |
| Page title      | system sans                                   | 28–34 / 1.1                           | 600     |
| Section title   | system sans                                   | 15–17 / 1.3                           | 600     |
| Body            | system sans + CJK fallbacks                   | 14 / 1.55                             | 400     |
| Label / eyebrow | system sans                                   | 11 / 1.2, `.14em` tracking, uppercase | 500     |
| Numeric         | `ui-monospace, SFMono-Regular, Menlo`         | 12–30, tabular                        | 500–600 |

No proprietary font binaries. System fallback stack includes PingFang SC, Hiragino Sans, and Apple SD
Gothic Neo so Chinese and Japanese never fall back to a mismatched Latin face.

### 3.3 Geometry

- Base spacing unit 4 px; common rhythm 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Radii: chips 999 px, buttons 8 px, inputs 8 px, cards 12 px, dialogs 16 px, composer/ticket 20 px.
- Hairline: 1 px at 1x, `0.5px` compensation via inset ring on retina.
- Panel elevation: `0 0 0 1px var(--border), 0 1px 2px rgba(0,0,0,.03)`.
- Floating elevation: `0 0 0 1px var(--border), 0 12px 32px -8px rgba(35,28,22,.16)`.

### 3.4 Motion

| Token           | Curve / spring                      | Duration   | Use                          |
| --------------- | ----------------------------------- | ---------- | ---------------------------- |
| `snap`          | `cubic-bezier(.16,1,.3,1)`          | 120–180 ms | Hover, press, chip selection |
| `spring-snappy` | stiffness 320, damping 28, mass 1   | ~350 ms    | Cards, popovers, ticket      |
| `spring-bouncy` | stiffness 600, damping 30, mass 1   | ~220 ms    | Buttons, toggles, badges     |
| `spring-gentle` | stiffness 220, damping 24, mass 1   | ~480 ms    | Dialogs, panel height        |
| `spring-heavy`  | stiffness 1200, damping 80, mass .1 | ~180 ms    | Drag snapping, drawer        |
| `reveal`        | `cubic-bezier(.19,1,.22,1)`         | 600 ms     | Candle paint-on              |
| `pulse`         | `cubic-bezier(.4,0,.2,1)`           | 1.6 s loop | Live dot, last-price halo    |

Rules:

1. No `transition: all`. Animate only `transform`, `opacity`, `filter`, and explicit colors.
2. Every pressable control scales to `.98` for 90 ms on pointer-down.
3. Stagger lists by 35–55 ms, never more than 8 items.
4. Respect `prefers-reduced-motion`: remove travel, parallax, confetti, and candle stagger; keep opacity.
5. A value that changes gets a 260 ms numeric tween and a 500 ms background flash in its semantic color.

---

## 4. Information architecture

```
/            Lobby — start a session, see the universe and recent form
/trainer     Trainer — blind replay, judgment, plan, execution, review
/stats       Stats — equity, R distribution, instrument edge, history
/settings    Settings — appearance, locale, risk, prop rules, sound
/guide       Guide — protocol, controls, glossary, disclaimer
```

Persistent shell: 76 px left rail on desktop with logo, five destinations, theme toggle at the bottom.
On mobile the rail becomes a frosted bottom tab bar. The shell is hidden in the Trainer’s focus mode
only below 768 px, where a compact top bar remains.

---

## 5. Screen specification

### 5.1 Lobby — `/`

**Viewport.** 1440×900 logical reference; page scrolls to approx. 1900 px.

**Composition.**

1. **Rail** (76 px) with a clay squircle mark and vertical destination icons.
2. **Hero** in a 12-column grid: left 6 columns for copy, right 6 for the replay preview. The hero is
   offset upward, not vertically centered, so the instrument rail peeks above the fold.
3. **Eyebrow**: `PROP DESK · BLIND REPLAY`.
4. **Headline** (serif): “Trade the chart. Not the ticker.” Three lines on desktop, two on mobile.
5. **Subcopy**: “Hidden instrument. Hidden date. One bar at a time. Build the only edge that survives
   an evaluation: a repeatable process under uncertainty.”
6. **Actions**: `Start blind session` (clay, arrow icon, press spring) and `Open the playbook` (ghost).
7. **Micro-stats**: `8 instruments`, `20 rounds / session`, `5m replay`, `0 real dollars`.
8. **Preview card**: 16:9 mini chart with animated candles, a masked symbol `M???`, a clay live-price
   tag, a soft “BLIND” stamp, floating order chips, and a faint grid. A clay ambient glow sits behind
   the card and drifts 8 px over 12 s.
9. **Instrument rail**: horizontal chips with symbol, name, point value. Hover lifts 2 px; click
   pre-selects the universe (both futures micros and full-size).
10. **“How a round works”**: four editorial columns — Read, Plan, Run, Review — each with a 32 px
    line icon and a one-sentence rule. Numbered 01–04.
11. **“The rules that bite”**: three cards for trailing drawdown, daily loss, profit target, each with
    a small rule diagram (line/area) and a plain-language explanation. Not marketing claims.
12. **Daily blind card**: full-width tinted strip with today’s locked sample, a `Play today’s sample`
    action, and a note that symbol/date reveal after completion.
13. **Footer**: simulation disclaimer, locale, version.

**Animation timeline on first load.**

- 0 ms: canvas and rail visible.
- 80 ms: eyebrow fades up 8 px.
- 140 ms: headline lines rise 16 px with 60 ms stagger, clip-path reveal.
- 260 ms: subcopy and actions fade.
- 300 ms: preview card scales from .97 to 1 and candles paint left-to-right over 1.4 s.
- 500 ms: instrument chips stagger.
- Continuous: ambient glow drift, live tag 2.4 s clay breathe, ticker marquee (paused on hover).

**Responsive.** Under 1024 px the hero collapses to one column, preview below copy. Under 640 px the
headline clamps to 2.4rem, stats wrap 2×2, instrument rail scrolls horizontally with edge fade, and
the footer stacks.

### 5.2 Trainer — `/trainer`

**Viewport.** Fits 1440×900 without page scroll. Chart is the flexible element; the ticket is fixed
360 px. Under 1180 px the ticket becomes a 320 px column; under 980 px it moves into a bottom sheet.

**Top bar (64 px).**

- Left: back-to-lobby icon, `Session 03`, status pill (`Judging`, `Live`, `Review`) with a breathing dot.
- Center: randomized instrument mask (`M??? · 5m`) and `Day ?` / `--:--` clock.
- Right: equity, round `3/20`, sound toggle, pause, `End session`.

**Stats strip (72 px).** Six equal segments separated by vertical hairlines: Starting balance, Equity,
Round P&L, Progress ring, Win rate, Session P&L. Values use tabular numerals and tween. A thin
progress bar under the strip shows profit target progress with a clay fill and a dashed drawdown floor.

**Chart card (flex 1).**

- Toolbar: timeframe segmented (`1m`, `5m`, `15m` visually, 5m active), pointer, trend, horizontal, fib,
  undo, clear, fit. A `BLIND` chip and `Reveal` chip (disabled until review).
- Canvas: 2:1 module of price grid, candles, volume histogram, right price axis, bottom time axis.
  Up candles sage, down brick, wicks 1 px; current bar has a subtle clay halo.
- Overlays: entry line (dashed, charcoal), stop line (brick, draggable), target line (sage,
  draggable), shaded risk zone (brick 7%), reward zone (sage 7%), labels on the right axis.
- Crosshair: 1 px dashed, price/time pills, OHLC readout in the top-left floating chip.
- Watermark: large low-contrast `BLIND` wordmark centered behind candles; hidden after reveal.
- Playback bar: play/pause, `Next bar` (Space), speed segmented (`0.5×`, `1×`, `2×`), bar counter,
  “Replay remaining 300” in review.
- Candle paint: when a new bar prints, it scales in Y from the previous close over 180 ms with opacity;
  the last-price tag slides to the new close with spring-snappy.

**Ticket card (360 px).**

- Header: `Trade ticket`, `Risk-based` badge, small settings icon.
- Direction segmented: `Long` / `Short` (sage/brick thumb).
- Order type: `Market` / `Limit`; limit price field animates in.
- Quantity stepper with risk-derived default, `Auto` toggle.
- Risk presets: `0.5%`, `1%`, `1.5%`, `2%`; active chip clay wash.
- Stop and target inputs with `−` / `+` tick buttons; distance, R:R, and fee readout.
- Computed block: position size, margin, risk amount, reward amount, max contracts warning.
- Primary CTA: `Buy MNQ` / `Sell MNQ` (direction-colored, full width, 44 px, arrow).
- Secondary: `Flatten` when in a position, `Cancel order` when pending.
- Position card: entry, size, open P&L, R multiple, stop/target distances, `Close at market`.
- Footer microcopy: “Fees included. Simulated fills at bar close.”
- During judgment, the ticket is replaced by a **Drill panel** (see below) with a spring cross-fade.

**Drill panel.**

Step 1 — Judgment:

- Step indicator `1 / 2` with a clay progress line.
- Prompt: “What is the market doing?”
- 2×2 segmented cards: `Uptrend`, `Downtrend`, `Range`, `Disorder`.
- Direction: `Long`, `Short`, `No trade` (locked when counter-trend, with an inline reason).
- Thesis textarea (160 chars) with placeholder “If I showed this to another trader, could they reproduce my entry?”
- `Commit read` primary; `Advance one bar` ghost; wait counter appears after each advance.
- Keyboard: `1–4` state, `L/S` direction, `Enter` commit.

Step 2 — Plan:

- Prompt: “Place the invalidation before the entry.”
- Entry / stop / target numeric fields plus chart drag hint.
- Live validation list: direction, risk below cap, R:R ≥ 1.5, stop inside structure, target inside structure.
- Risk preview: contracts, risk $, reward $, fees, margin.
- `Place bracket` primary; `Back` ghost.
- Structural check: stop must sit within 0.6 ATR of a recent swing; target within 0.6 ATR of a swing or
  range edge. Failing this is a warning with a grade penalty, not a block — the trader can still express
  the idea, then see the consequence.

Step 3 — Live: chart + ticket + position card. Playback auto-starts at 1×, can pause.

**Review dialog.** 560 px modal over a blurred chart. Header `Round complete` + grade medallion
(A–F). Reveal line: instrument, date, regime. Three columns: process score, outcome (R), execution
(fees/size). A timeline of entry → stop/target with bars. Coach notes generated from rules, not an LLM.
Buttons: `Replay the future` (chart reveals remaining bars), `Next round`, `End session`.

**Session report dialog.** Final equity curve, rounds, win rate, average R, rule breaches, process
grade, `Start a new session`, `View stats`.

**States.**

- `Drawing sample…` — skeleton chart with shimmer, 700 ms minimum, ticket disabled.
- `No fill` — order never triggered; review shows missed entry and a “patience” note.
- `Breach` — red-tinted status pill, modal explaining trailing/daily breach, account reset option.
- `Target hit` — clay/sage confetti burst, `Evaluation passed` banner.
- Offline / malformed storage — toast and safe fallback to defaults.

### 5.3 Stats — `/stats`

- Page title `Your tape`, subtitle, date range segmented (`7D`, `30D`, `All`), export JSON ghost button.
- Four KPI cards: sessions, rounds, win rate, average R. Each has a sparkline or radial gauge.
- Equity curve card: 2 px clay line with soft area, drawdown band, hover crosshair, empty state with a
  single CTA to run a session.
- R distribution: 11 vertical bars from −3R to +3R, clay for positive, brick for negative.
- Instrument table: symbol, trades, win rate, avg R, net P&L, fees. Rows 44 px, hover surface-3.
- Process card: structural stops %, waited ≥ 3 bars %, risk cap respected %, countertrend attempts.
- Session history list: date, rounds, net P&L, grade, duration.
- Empty state uses a line drawing of a candlestick and copy “Your first session writes this page.”

### 5.4 Settings — `/settings`

Sections separated by hairlines, max width 760 px:

- **Appearance**: theme (System/Light/Dark) segmented; motion (Full/Reduced) segmented; density.
- **Language**: English, 简体中文, 日本語; note that English is the source language.
- **Risk defaults**: account size, risk per trade %, max contracts, daily loss, trailing drawdown,
  profit target. Inputs show dollar previews; invalid combinations get inline errors.
- **Instrument universe**: toggle chips for the eight instruments; minimum two.
- **Audio**: UI sounds toggle, volume slider.
- **Data**: export JSON, reset local history (danger dialog).
- Footer: version, “Simulated data only.”

### 5.5 Guide — `/guide`

- Editorial hero `The protocol`.
- Five numbered sections: Read the state, Define invalidation, Size by risk, Let the tape speak,
  Grade the process.
- Each with a 2-column layout: rule text left, small diagram/example right.
- Keyboard reference table with `<Kbd>` chips.
- Glossary: R, ATR, trailing drawdown, bracket, no-fill.
- Disclaimer card.

---

## 6. Component inventory

| Component          | Notes                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| `AppRail`          | Desktop destination rail, animated active pill, mobile bottom bar.                |
| `TopBar`           | Context title, status pill, account snapshot, session actions.                    |
| `CdsButton`        | Sizes xs/sm/md/lg; variants primary, secondary, ghost, outline, danger, positive. |
| `SegmentedControl` | 999 px track, 2 px padding, sliding thumb, roving focus.                          |
| `StatusDot`        | Clay breathe, live pulse, neutral, positive, negative.                            |
| `Metric`           | Label, value, delta, sparkline, tabular numerals.                                 |
| `Panel`            | Hairline card with optional header/action.                                        |
| `Dialog`           | Reka UI focus trap, backdrop blur, spring scale, Escape.                          |
| `NumberField`      | Tick steppers, validation message, suffix.                                        |
| `RiskGauge`        | Horizontal target/drawdown bands with markers.                                    |
| `ChartCanvas`      | Canvas renderer + pointer interactions + overlays.                                |
| `PlanLines`        | Entry/stop/target handles and labels.                                             |
| `TradeTicket`      | Direction, type, size, risk, computed block.                                      |
| `DrillPanel`       | Two-step state machine and validation.                                            |
| `PlaybackBar`      | Play/pause, step, speed, progress.                                                |
| `ReviewDialog`     | Grade, notes, outcome, next action.                                               |
| `ToastStack`       | Top-right, 4 s, pause on hover, aria-live.                                        |
| `Sparkline`        | SVG polyline, no dependency.                                                      |
| `EquityCurve`      | SVG path with gradient area and hover dot.                                        |
| `Kbd`              | Keyboard chip.                                                                    |
| `LocaleSwitcher`   | Select with flag-free language names.                                             |

All primitives are hand-built on Reka UI where a headless primitive is useful; no shadcn-vue runtime
dependency. Variants use `class-variance-authority` + `tailwind-merge` via a local `cn()` helper.

---

## 7. Data presentation rules

- Currency: `$12,480.00` for account values; P&L always signed (`+$240.00`, `−$125.50`); R to two
  decimals (`+1.84R`).
- Prices: instrument tick precision (MNQ 2 decimals, MGC 1, MCL 2).
- Contract counts are integers and never localized with decimals.
- Dates in the UI use the active locale; the hidden replay date is never rendered before review, and
  the instrument is only shown as a masked token (`M???`).
- All changing numbers use `font-variant-numeric: tabular-nums`.
- Positive/negative is conveyed with sign, arrow, and color; never color alone.
- Empty values render as an em dash, not `0`, until the first sample exists.

---

## 8. Accessibility & keyboard

- WCAG 2.2 AA contrast targets; muted text is only used for non-essential metadata.
- Focus ring: 1.5 px clay outline with 3 px offset, visible on all interactive elements.
- Dialogs: Reka UI focus trap, `aria-labelledby`, restore focus, Escape closes unless destructive.
- Chart: canvas has `role="img"` and an `aria-label` summary; all decisions are available as DOM controls.
- Live P&L and fill events announced through one polite `aria-live` region.
- Keyboard: `Space` play/pause or next bar, `N` next bar, `L`/`S` direction, `1–4` state,
  `Enter` primary, `Esc` close, `?` shortcuts, `G` then `T` to trainer.
- Touch targets ≥ 44×44 px on mobile; chart line handles get a 24 px invisible hit area.
- `prefers-reduced-motion` respected globally; sound is opt-in and defaults off.

---

## 9. Responsive matrix

| Width     | Shell      | Trainer    | Ticket              | Chart      |
| --------- | ---------- | ---------- | ------------------- | ---------- |
| ≥ 1440    | 76 px rail | 3-row grid | 360 px fixed right  | 1fr        |
| 1180–1439 | 76 px rail | 3-row grid | 320 px              | 1fr        |
| 980–1179  | 68 px rail | 2-row grid | 300 px bottom panel | full width |
| 640–979   | bottom bar | stacked    | bottom sheet toggle | 420 px min |
| < 640     | bottom bar | stacked    | full-width sheet    | 360 px min |

The chart never shrinks below 360 px height. On small screens the stats strip becomes a horizontal
scroll snap row with edge fade; the ticket becomes a sticky bottom sheet with a grabber.

---

## 10. Content voice

- Direct, calm, specific. No hype, no promises, no “alpha”.
- Prefer verbs: `Read the state`, `Place the bracket`, `Let it resolve`.
- Coach notes name the behavior, not the person: “Stop was 2.4 ATR away — wider than the structure.”
- Disclaimer appears in the footer and in the Guide: simulated data, not financial advice.
- English is the source language. zh-CN and ja translations preserve meaning and tone, not literal
  word order.

---

## 11. Acceptance checklist

- [ ] Every route renders at 1440×900, 1024×768, 768×1024, and 390×844 without horizontal overflow.
- [ ] Light and dark themes both pass contrast checks.
- [ ] A user can complete a full round with mouse only and with keyboard only.
- [ ] Hidden symbol/date never appear in the DOM before review.
- [ ] Chart remains 60 fps during playback on a 2019-class laptop; no layout thrash.
- [ ] Reduced-motion mode removes travel, parallax, confetti, and stagger.
- [ ] Empty, loading, error, no-fill, breach, and pass states are all designed and reachable.
- [ ] No proprietary font/audio binaries; sounds synthesized with Web Audio.
- [ ] i18n strings exist for every visible label in en, zh-CN, and ja.

---

## 12. Implementation notes (as built)

- Routes shipped: the five specified routes plus `/analysis` (PA/ICT/order-flow lab), `/drill` (standalone decision drill), `/daily` (UTC-seeded
  challenge with deterministic reference plans) and `/pk` (local pass-and-play room). The rail carries six primary
  destinations; Guide and Settings sit in the rail footer.
- Tokens are implemented under the `--surface-*`, `--ink*`, `--line*`, `--clay*`, `--bull*`, `--bear*` names in
  `app/assets/css/main.css`; the visual values match §3.
- The chart is a dependency-free Canvas 2D engine (`app/lib/chart/engine.ts`): blind axes, relative time axis,
  candle grow-in, crosshair, drawings and draggable plan overlays.
- Heavy O(n) math runs in Rust/WebAssembly on both SSR and the client: scenario generation, fractal swing detection,
  plan simulation and the analysis stack (indicators, market structure, ICT zones, volume profile, delta proxy). A TypeScript reference remains as a fallback and parity is enforced by tests.
- i18n ships 583 keys in `en`, `zh-CN` and `ja`; the locale and settings are cookie-hydrated so SSR and hydration
  agree on language and theme.
- Verification: `bun run test` (93 tests), `bun run typecheck`, `bun run build`, `bun run smoke`, plus Playwright
  screenshots at 1440×900 and 390×844 in light and dark themes.
