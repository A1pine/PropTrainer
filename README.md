# Prop Desk

A blind-replay trading trainer for prop-firm instruments. Prices, symbol and date are hidden while candles print
one at a time. You size like a futures trader, place bracketed orders, and manage risk against configurable
evaluation-style guardrails: profit target, trailing drawdown, daily loss limit.

The decision drill then grades the part most traders skip — state, an optional thesis, and a plan whose stop
belongs beyond structure rather than at your comfort level.

> **Simulated execution only; synthetic data by default.** Series are generated deterministically from a seeded
> regime model, or you can install a local pack of real 5-minute futures bars (`bun run data:fetch`) for practice.
> There is no live market feed, broker connection or real-money trading. Nothing here is financial advice.

![Lobby](docs/media/lobby.png)

![Trainer](docs/media/trainer.png)

![Analysis lab](docs/media/analysis.png)

## Features

- **Blind replay trainer** — hidden instrument, date and price axis; candle-by-candle playback, market/limit
  orders, brackets, futures P&L in ticks, commissions, and prop-firm guardrails.
- **Decision drill** — read the state, add an optional thesis, drag entry/stop/target on the chart, size by risk,
  then receive a process grade split into state (40), direction (20), plan structure (25) and discipline (15).
- **Fills on review** — after the reveal, the chart marks every actual fill (entry triangle, exit diamond) with
  price and UTC candle time, and a Locate button frames the trade. Fills are never drawn while the tape is blind.
- **Daily challenge** — one sample seeded by the UTC date, with deterministic _reference plans_ as a benchmark
  board. First submission is locked; replays cannot overwrite it.
- **Friends PK** — local pass-and-play on the same seed, one committed attempt per player, process score wins
  and R breaks ties. Results stay in the browser, by design.
- **Analysis lab** — price action, ICT concepts and an OHLCV order-flow proxy on one chart: EMA/VWAP/Bollinger,
  market structure (BOS/CHoCH), FVG and order blocks, liquidity levels/sweeps, volume profile, delta pressure and
  a weighted confluence score. All computed in Rust/WASM.
- **Optional exam helpers** — the chart toolbar's TA toggle enables the same visible-bar analysis in training
  and drill questions, including daily/PK attempts. PA, ICT, flow proxy and indicators switch independently;
  helpers start off, keep blind price/date masking, and do not change the grading rules.
- **Optional real data** — fetch a local 5-minute pack from Yahoo Finance, switch sources in Settings, and train
  on real CME micro/mini futures tape without giving up the blind contract. Daily and PK stay generated.
- **Replay terminal** — core Tradovate Web-style futures workflows in Prop Desk's existing design, not a 1:1 clone:
  six simulated order types, DAY/GTC/GTD, sized OCO targets, break-even/trailing ATM, same-ID chart amendments,
  one to three linked chart panes with locally saved display settings, opt-in TA/drawings, a price ladder without
  fake depth, and account/history docks. Configurable prop rules track drawdown, daily loss, caps, consistency and
  conditional per-symbol risk prices. Preset/custom timeframes share a revealed 5-minute tape; pinned runs and
  checkpoints use IndexedDB with explicit storage errors and retry.
- **Guided learning** — a local academy with a validated course registry, lesson notes, required checks and
  self-reported completion, starting with an **ICT 2022 Concept** course. The curriculum is the 14-chapter outline
  supplied by the course owner, with knowledge points, outline examples, per-chapter self-checks and an explicitly
  pending practice slot; the app adds no invented ICT syllabus. Independent study, not an official ICT affiliation.
- **Stats** — equity curve, R distribution, instrument edge, process metrics and session history.
- **English-first i18n** — complete `en`, `zh-CN` and `ja` bundles (key parity checked).
- **Claude Design System port** — warm surfaces, clay accent, hairline rings, spring easing, light/dark themes,
  reduced-motion support, and a custom canvas chart.

## Stack

| Layer      | Choice                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| App        | Nuxt 4, Vue 3, TypeScript (strict, `noUncheckedIndexedAccess`)                                        |
| Styling    | Tailwind CSS v4 with CDS tokens ported from [open-claude-ui](https://github.com/Caho1/open-claude-ui) |
| Primitives | Reka UI wrapped shadcn-style; `class-variance-authority` + `tailwind-merge`                           |
| State      | Pinia setup stores                                                                                    |
| i18n       | `@nuxtjs/i18n` (no prefix, cookie-aware SSR)                                                          |
| Charts     | Custom Canvas 2D engine (candles/OHLC/line/Heikin-Ashi, drawings, order lines, blind mode)            |
| Compute    | Rust → WebAssembly core for O(n) market, drill and analysis math, with a TypeScript fallback          |
| Tests      | Vitest unit/component tests including Rust/TypeScript parity, data races and chart invariants         |
| QA         | Playwright screenshot script                                                                          |

## Getting started

```bash
bun install
bun run dev        # http://localhost:3000
```

```bash
bun run test        # unit tests (runs through the real wasm core)
bun run typecheck   # vue-tsc
bun run build       # production build
bun run preview     # preview the production build
bun run data:fetch  # optional: fetch a local real-data pack (Yahoo Finance, gitignored)
bun run screenshot  # visual QA at 1440 and 390 (requires the dev server)
bun run smoke       # end-to-end flows against a running dev server
```

Bun 1.3+ is the package manager. The committed `public/wasm/prop_core.wasm` means Rust is **not** required to run the app.
To rebuild the core you need Rust with the `wasm32-unknown-unknown` target:

```bash
rustup target add wasm32-unknown-unknown
bun run wasm:build
```

The build writes a content hash to `app/wasm/artifact.ts`; the browser fetches `prop_core.wasm?v=<hash>` so a new
artifact is never served from cache. Restart the dev server (SSR loads the module at boot) and reload the page after
a rebuild.

Performance work is measured, not guessed:

```bash
bun run bench:wasm     # size, brotli/gzip, compile, generate/analyze/simulate
bun run measure:wasm   # real browser timings against a running server
bun run check:wasm     # proves the core never blocks first paint and loads once
bun run check:executions # result-page fill markers, same-bar exits and blind masking
bun run check:analysis   # exam overlay toggles, keyboard isolation, failure recovery and layout
bun run check:terminal   # replay terminal orders, chart trading, prop lines and mobile layout
bun run check:accounts   # independent accounts, legacy IndexedDB migration and mobile management
bun run check:learning   # academy navigation, notes, checks, drafts, themes and storage recovery
bun scripts/bench-timeframes.ts # 13k-bar aggregation parity and P95 against the 10 ms budget
```

Last recorded artifact (prior measurement; a fresh build will replace it): **157.6 KiB raw / 58.8 KiB brotli** (budget 160/60), including the replay aggregator. WASM never gates hydration: it warms on idle;
only a direct, server-rendered analysis visit adds a preload. SPA navigation shares the loader's pending request.
See [`docs/perf/wasm.md`](docs/perf/wasm.md) for the artifact history and
[`docs/perf/response.md`](docs/perf/response.md) for production response budgets, raw before/after samples and limits.

```bash
bun run bench:compute --check    # 710-bar public wrappers, validation and cached windows
bun run bench:ui --check         # production localhost:4173, synthetic + installed local pack
bun run bench:terminal           # replay-step and multi-pane chart responsiveness
bun run bench:terminal:compute   # real-engine long-history CPU and snapshot probe
bun run bench:timeframes         # aggregation parity, latency and artifact budgets
```

## Routes

| Route       | Purpose                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| `/`         | Lobby: pitch, animated preview, universe picker, rules, daily entry, recent form |
| `/trainer`  | Blind session: read → plan → live bracket → review → next round                  |
| `/terminal` | Replay trading desk: orders, brackets/ATM, ladder, prop account, history         |
| `/learn`    | Academy: course library, outline, lesson notes, checks and completion            |
| `/analysis` | Analysis lab: indicators, PA, ICT, order-flow proxy, confluence                  |
| `/drill`    | Standalone decision drill (`?seed=` for a shared sample)                         |
| `/daily`    | Daily sample, lock state, result and reference board                             |
| `/pk`       | Pass-and-play room, shared seed, rematch                                         |
| `/stats`    | Equity, R distribution, instrument edge, process, history                        |
| `/settings` | Theme, motion, language, account rules, universe, playback, data                 |
| `/guide`    | Protocol, keyboard reference, glossary, disclaimer                               |

## Architecture

```
wasm/                     Rust compute core (crate: prop_core)
  src/lib.rs              scenario generation, swing detection, plan simulation, JSON ABI
app/
  domain/                 pure TypeScript, no Vue imports
    wasm/                 typed bridge + JSON ABI client for the Rust core
    instruments/          contract specs + registry factory
    market/               seeded PRNG, regime OHLC generator, scenario factory, daily seed
    trading/              broker, futures P&L, sizing, prop rules
    drill/                plan validation, conservative simulation, grading, reference plans
    stats/                trade analytics + persistence record types
    analysis/             analysis report types and the Rust-core entry point
    learning/             course registry, content validation and progress types
    settings/             zod schema and defaults
    sim/                  replay calendar, timeframes, risk engine, order engine, presets
  lib/
    chart/                canvas engine, geometry, theme reader
    sim/                  pinned replay tapes, session wrapper, IndexedDB checkpoints
    learning/             versioned learning-state repository and browser storage
    repositories/         history repository over a KeyValueStore
    storage.ts            storage adapter factory (localStorage / memory)
    audio.ts              Web Audio cue synth (no assets)
  components/             ui kit, layout shell, chart, terminal, trainer, lobby, drill, stats, learning
  stores/                 Pinia orchestration (trainer, drill, terminal, learning, settings, history, pk, toasts)
  pages/                  routes
i18n/locales/             en, zh-CN, ja
tests/unit/               domain and adapter tests
```

### Patterns

- **Factory + registry** — `createInstrumentRegistry`, `createScenarioFactory`, `createBroker`,
  `createHistoryRepository`, `createWebStore`. Adding a contract is one catalog entry; adding a data source is one
  adapter, not a refactor.
- **Domain stays pure** — the broker, generator, sizing and grading have no Vue or DOM dependencies. They are
  deterministic and directly unit-tested.
- **One writer per concern** — Pinia stores own lifecycle and persistence; components render and emit. The
  trainer store feeds its broker; the separate terminal store coordinates `ReplaySession` and its engine.
- **Declared simulation policy** — trainer/drill reviews resolve ambiguous stop/target bars stop-first. The terminal
  instead walks an explicit OHLC path, described below. Fees and gap behavior remain part of each model.
- **Honest boundaries** — daily/PK reference results are labelled as deterministic strategy baselines, not people.
  No fake testimonials, payouts or live-data claims. The terminal's ladder never invents depth, and its conditional
  breach price holds other symbols' marks fixed; it does not assume those positions are closed.

### The trainer trading model

- Contracts, not notional leverage. `riskPerContract = stopTicks × tickValue + roundTurnFee`.
- `contracts = floor(riskBudget / riskPerContract)`, capped by the account's max contracts.
- Prop rules: trailing drawdown from the equity high-water mark, daily loss limit, profit target, contract cap.
- R multiple includes commissions, so a scratch trade reads slightly negative.

### Rust / WebAssembly compute core

The batch work runs in Rust; the last recorded build was a 157.6 KiB WASM module:

| Work                                                                 | Why it is in Rust                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Regime scenario generation (710 OHLCV bars + ATR/efficiency metrics) | Runs for every round, daily sample, PK rematch and lobby preview |
| Fractal swing detection                                              | Cached for the visible prefix; reused across plan edits          |
| Plan simulation (bracket fill, gaps, stop-first, MAE/MFE, R)         | 300-bar conservative walk for trainer reviews and drill grading  |
| Chart analysis (indicators, structure, ICT, flow)                    | Visible-prefix reports for the lab and optional chart helpers    |
| Terminal higher-timeframe aggregation (`prop_aggregate`)             | Batch OHLCV reduction; TypeScript fallback and parity reference  |

Both the Nuxt server and the browser load the **same** module: the server reads
`public/wasm/prop_core.wasm` at boot, while the client warms it without blocking hydration. A typed JSON ABI
(`app/domain/wasm/core.ts`) keeps the call surface small; irregular market tapes include explicit timestamps so
session/weekend gaps survive analysis. Generation, swings and plan simulation have tested TypeScript fallbacks.
The analysis lab requires WASM and shows an unavailable state if it cannot load. The active core is shown under
Settings → Compute core.

Stateful broker work, terminal execution/risk transitions (including drawdown and consistency), sizing, rendering
and Vue orchestration stay in TypeScript. There is no WASM prop-rule state machine. Tests require Rust/TypeScript
parity for generation, swings, plan simulation and terminal aggregation; the aggregation benchmark does not
establish that WASM is faster than its TypeScript reference.

### Theming

- **Both schemes are declared in light mode.** `color-scheme: light dark` plus a matching meta tag prevented
  Chrome's forced-dark inversion in the tested browser. The app's palette follows `html.dark`; the inline
  `color-scheme` is `dark` or `light dark`. In light mode, native controls can therefore follow the OS preference.
  This is not a guarantee against arbitrary dark-mode extensions.
- **One palette, two modes.** Surfaces, ink, clay and market colours are CSS custom properties; every component
  reads them, so nothing is hard-coded to a mode. The canvas chart reads the same tokens through
  `readChartTheme()` and repaints on theme change.
- **The toggle advertises the action, not the state.** A sun on a dark page means “switch to light”. Icons are
  CSS-driven, so server and client markup agree even when `theme: system` resolves after hydration.
- **Contrast is tested.** `tests/unit/theme-contrast.spec.ts` asserts WCAG AA (4.5:1) for body text, muted text,
  rails and every filled accent (`--on-clay`, `--on-bull`, `--on-bear`, `--on-danger`) in both modes.
  `bun run audit:theme` samples visible DOM text on four routes in both modes and flags contrast failures;
  it is not an exhaustive accessibility audit.

### Market data packs

`bun run data:fetch` pulls free 5-minute bars for `MNQ`, `MES`, `NQ`, `ES`, `MYM`, `M2K`, `MGC` and `MCL` from
Yahoo Finance into `public/data/market/` (gitignored). `Settings → Market data` switches the sample source for the
trainer, drill and analysis; daily and PK remain generated for reproducibility.

- The loader validates every column, rejects out-of-order or inconsistent OHLC bars, and falls back to simulated
  tape instead of plotting corruption.
- A round draws a seeded `150 warm-up + 260 hidden + 300 reveal` window and shifts prices by a tick-aligned
  constant to obscure absolute levels. Seed reproducibility requires the same pack and instrument universe.
- Packs are gitignored and served from the app's origin, not fetched from Yahoo at runtime. A production build
  copies installed packs from `public/` into its output, so remove them before any unauthorized deployment.
  Blind mode hides information in the UI; the full tape is accessible in browser memory, not secured against inspection.
  See [docs/data/market-data.md](docs/data/market-data.md) for the schema, provenance and limits.

### Performance notes

- **Nonblocking WASM with scoped fallbacks.** The client plugin starts the load on idle without blocking hydration;
  the trainer and lobby can run on TypeScript until the core lands. The analysis lab requires WASM, shows a
  skeleton while loading, and reports an unavailable state if loading fails.
- **One download, one compile.** `WebAssembly.compileStreaming` plus a module cache and an instance cache means a
  session fetches and compiles the artifact once, even across client-side navigation. SSR reuses one instance per
  process.
- **Cache-safe delivery.** The URL carries a content hash, `/wasm/**` is immutable for a year, and Nitro emits
  `.br`/`.gz` variants at build time.
- **Small payloads.** Analysis input is sent as numeric columns (67 KiB → 22 KiB) and the response only contains
  the indicator series the chart draws (91 KiB → 51 KiB).
- **Budgets in CI.** `tests/unit/wasm-budget.spec.ts` fails if the artifact exceeds 160 KiB raw / 60 KiB brotli,
  if compression ratio drops below 2×, if an export disappears, or if the cache-busting hash goes stale.

### Analysis lab and exam helpers

The lab remains the full research view: indicator series, market structure, ICT zones, an order-flow proxy, and a
confluence score with translated reason codes. Exam charts reuse its Rust report and shared `buildChartAnalysis`
adapter through `useExamAnalysis`, without displaying the confluence score or changing grading rules.

On trainer and drill question pages (including daily/PK attempts), **TA** in the chart toolbar toggles the helpers.
The adjacent settings button opens a desktop popover or a mobile bottom panel, so it does not reduce chart height.
PA, ICT, flow proxy and indicators have independent switches, plus EMA, VWAP, Bollinger, FVG, OB, levels/liquidity
and volume-profile layer controls. The master switch starts off on each page mount; choices stay only for that
page visit. Escape closes settings and returns keyboard focus; controls do not trigger exam shortcuts.

`useExamAnalysis` slices to `candles.slice(0, visibleCount)` before calling Rust: hidden future bars and retrospective
scenario metrics are not inputs. The current prefix is recalculated as bars advance, so historical annotations may
change as new structure is confirmed. Blind mode still masks absolute prices and dates. This is a display-level
training aid, not secure anti-cheat: the browser still holds the full replay tape.

Framework/layer toggles reuse the computed report while at least one framework is on; disabling all frameworks or
TA clears it and skips further analysis work. WASM loading or errors never block exam actions; unavailable helpers
offer Retry. On narrow screens chart annotation labels are suppressed while geometry remains visible.

Order flow is **OHLCV-derived**: candle close position weights volume into a delta proxy. There is no bid/ask or
footprint feed, and the UI says so. ICT concepts are heuristics (swing-based FVG, OB, liquidity), not vendor signals.

### Replay terminal

`/terminal` is a separate free-form desk: no grading or hidden contract, and no broker. Its scope is core
Tradovate Web-style futures workflows adapted to replay, not complete platform parity. The rail/mobile Trade
entry comes from `app/composables/useNav.ts`; existing exam routes keep their own grading and execution model.

**Tape and timeframes.** Each instrument has a pinned 5-minute tape. `cursor` counts revealed entries in the
shared timeline; the last revealed timestamp is `timeline[cursor - 1]`, and gaps stay gaps. Presets are `5m`, `15m`,
`30m`, `1h`, `4h`, `1D`, plus custom **5–1440 minute multiples of 5**. Finer 1m/seconds/tick choices are not offered.
Aggregation uses only revealed bars; the forming badge marks incomplete higher-timeframe buckets. Switching
frames/styles does not advance the clock. The calendar models Chicago 17:00–16:00 sessions, DST, the maintenance
break and weekends, **not exchange holidays or early closes**. A synthetic/local source label is displayed, but the
terminal has no source picker, replay-start picker or surfaced tape-provenance panel.

**Layout and chart tools.** Up to three panes share the clock; only the active pane renders below 1024 px. It drives
the ticket, ladder, position card and risk overlays. The watchlist is visible at ≥1024 px, the ticket column at
≥1280 px; below 1280 px Buy/Sell opens a bottom sheet. Symbol/timeframe/style persist locally, not as named/cloud
workspaces. Candlestick/OHLC/line/Heikin-Ashi styles, off-by-default TA, trend and horizontal lines are exposed by
`TerminalChartPane.vue`. Drawings clear on symbol/timeframe changes and are not saved. Watchlist last/change/volume
refer to the last revealed **base bar**, not bid/ask quotes or session volume.

**Execution.** Six order types support DAY/GTC/GTD and release/expiry, one stop plus up to five sized OCO targets,
break-even/trailing ATM, explicit partial exits and add/reduce/reverse/flatten. Bars walk `O → L → H → C` when
`close >= open`, otherwise `O → H → L → C`. Stop-limits activate before matching their limit and never reuse
pre-trigger extrema. There is no queue, spread or volume-based partial-fill simulation. Chart drag amends the
**same order ID** with a `modified` event; cursor clicks prefill a price. Reverse cancels old protection and does
not re-arm it. The ladder shows prices/own orders, never fabricated depth or time-and-sales.

**Prop account.** Generic editable presets—not licensed firm rulebooks—support static/intraday/EOD drawdown,
daily actions, contract/trade caps, finalized-day minimums and consistency gates. Peak basis (balance/equity) is
separate from the balance/equity breach monitor. Fees and session finalization affect floors and eligibility;
breaches latch. The account strip/details show balance, equity, realized/unrealized P&L, day P&L, margin, buying
power, floor/cushion and rule status. Charts draw conditional breach and daily-loss **price** lines in scale,
not the account's dollar floor. Per-symbol breach prices hold other symbols' marks fixed; balance-only drawdown
has no drawdown price line. Execution and prop-rule transitions are TypeScript, not WASM.

**Independent accounts.** The account selector creates named **25K / 50K / 100K** simulated accounts, including
multiple accounts of the same size. Each keeps its own pinned tape, replay clock, positions, orders, fills, fees,
P&L and rule ledger. Switch, rename and confirmed delete are available in the account dialog. A **Blown account**
label persists across switches and reloads; a daily lock has a separate label and is not treated as a blown account.
Changing rules or starting a new attempt creates another account, without erasing the old one.

**Persistence and controls.** IndexedDB `propdesk-replay-v1` stores pinned runs, checkpoints and small account
summaries. Legacy accounts migrate without changing their tapes or ledgers. Switching pauses playback and drains
pending saves before loading the destination; a failed save blocks the transition and exposes Retry. A failed
restore sets `restoreBlocked` and never silently resets the account. Deleting the selected account leaves no
selection; deleting the last account stays empty even after reload. Storage is **local to this browser/origin**,
not cloud backup, and clearing site data deletes it. Save failure can leave the latest state unsaved. Display/ATM/hotkey
preferences remain shared in localStorage. Six local hotkeys are
opt-in and remappable (see below); there is no full per-module hotkey catalogue, docking, workspace import/export
or cloud sync.

See [implementation, scoped parity and evidence map](docs/design/trading-terminal.md),
[account lifecycle and migration](docs/design/terminal-accounts.md),
[historical performance and acceptance evidence](docs/perf/terminal.md), and the
[same-harness optimization report](docs/perf/terminal-optimization.md). The performance report records its own
validated revision and sample sizes; newer account checks are separate. Measurement limits (headless single-machine,
5-minute OHLCV, no depth/tape) are recorded there.

### Academy

`/learn` is a separate reading workspace, not a trading module. The catalog is validated at module load; notes,
checks and completion live under `propdesk.learning.v1` and never touch terminal accounts or trade history. Only
published curriculum lessons count toward progress, and the shipped chapter slot stays a draft until the owner
supplies material. See the [framework design](docs/design/academy.md) and
[chapter authoring contract](docs/learning/content-authoring.md).

### Chart engine

`ChartEngine` is a small retained-mode renderer: it owns viewport math, price scales, candles, volume, overlay
lines, drawings (trend/horizontal/Fibonacci), crosshair and pointer interaction. Review charts can also draw filled
entries and exits, with price/time labels, a dashed fill-to-fill connector and `focusRange()` framing. It renders
axes outside the plot clip, animates the newest candle, and supports a blind mode that masks prices, hides fills and
replaces timestamps with relative bars. Mobile layouts size the canvas absolutely to avoid a resize feedback loop.
On review, plan-level tags are suppressed while their lines stay visible, so they do not collide with fill labels.

### i18n

English is the source (`en.json`). `zh-CN` and `ja` mirror its keys; a parity check is part of the
translation workflow. Locale preference is stored in a cookie as well as localStorage so SSR and hydration agree.
The last chosen locale is applied before the first render.

### Visual system

Tokens are adapted from the Claude Design System via `open-claude-ui`: AA-adjusted clay, surface steps, hairline
rings, dual-ring overlays, 7-stop non-linear scroll fades, and a spring easing set. The full design rationale and
acceptance checklist live in [`docs/design/ui-spec.md`](docs/design/ui-spec.md).

## Keyboard

Trainer/drill shortcuts and global controls:

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| `Space`         | Wait one bar while reading / play-pause live replay |
| `N`             | Advance exactly one bar                             |
| `1`–`4`         | State: uptrend, downtrend, range, disorder          |
| `L` / `S`       | Direction: long / short                             |
| `⌘K` / `Ctrl K` | Command palette                                     |
| `Esc`           | Close a dialog or the palette                       |

Terminal shortcuts are **disabled by default** and locally remappable:

| Default key   | Terminal action                                     |
| ------------- | --------------------------------------------------- |
| `Space` / `N` | Play/pause / step one shared-timeline entry         |
| `B` / `S`     | Open/focus the buy/sell ticket, not submit an order |
| `F`           | Flatten the active symbol's position                |
| `Esc`         | Close the ticket                                    |

Typing, menus/dialogs, composition, repeated keys and modifier chords do not fire terminal actions.

## Testing

The unit and component suites cover:

- instrument economics and registry validation,
- PRNG determinism and OHLC/tick invariants across all eight contracts,
- broker fills, gaps, brackets, fees, MAE/MFE, prop-rule breaches and target completion,
- risk sizing and the 1R definition,
- drill validation, conservative simulation and grading,
- daily seed determinism, reference plans and key parity-ready i18n bundles,
- trade analytics, history repository round-trips, and settings schema fallbacks,
- analysis report shape, profile/POC bounds, FVG/OB geometry and event ordering,
- exam helper visible-prefix isolation, framework/layer gates, cached reports and WASM failure/retry handling,
- compact analysis controls, localized summaries, keyboard isolation and focus return,
- exact Rust ↔ TypeScript parity for candles, metrics, swings and plan outcomes,
- local pack cache generations, refresh races, negative-cache recovery and future-independent rebasing,
- shallow scenario state, newest-start-wins, visible-swing reuse, decision-time grading and session accounting,
- fill normalization across session gaps, same-bar round trips, no-fill plans and invalid bar coordinates,
- replay no-lookahead/determinism, sparse shared clocks, scheduled closes and corrupt-checkpoint/retry handling,
- independent account creation/switching/rename/deletion, atomic legacy migration, retry/transition locking,
  quota recovery, persistent blown labels and intentional empty-state reloads,
- six order types, TIF/release, same-ID amendments, reservations, partial targets, OCO and ATM,
- prop peak basis vs breach monitor, fee-aware transitions, finalized-day gates and conditional price rounding,
- timeframe aggregation parity (TS ↔ WASM), custom intervals, DST and weekly-session filtering,
- terminal layout/hotkey storage, guarded remapping, quote/account controls and TA/drawing isolation,
- academy catalog validation, per-lesson progress isolation, revision invalidation, notes/checks persistence,
  corrupt-storage protection and reactive progress after client-side navigation,
- pre-paint chart geometry, no-op redraws, reveal animation targets, option updates and reduced motion.

Visual QA: `bun run screenshot` writes desktop and mobile captures to `screenshots/` (git-ignored).

## Limitations

- No server-side trading/account service, user login or cross-device sync. History and PK rooms are local.
- If WASM is blocked, generation/plan simulation and terminal aggregation have TypeScript fallbacks. Terminal
  execution/risk already run in TypeScript; the analysis lab and optional TA helpers are unavailable.
- Scenarios are synthetic by default, or sampled from an optional local pack; neither proves a real trading edge.
- The trainer permits one position/working entry at a time. The terminal supports multiple symbols and working
  orders, with one net position per symbol in each independent simulated account. Only the selected account
  advances or receives orders; grouped routing and concurrent multi-tab editing are not supported.
- Terminal bar paths, weekly calendar and frozen-other-mark risk prices are approximations. No live quotes,
  order-book depth, tick-based charts, full workspaces or licensed prop-firm rulebooks are provided.
- The academy is local-only: notes and completion live in this browser, with no accounts, certificates or
  cross-device sync. Only a workspace guide and an unconfigured chapter slot ship; chapter copy, video and
  examples must be supplied by the course owner. Completion is self-reported, not a knowledge score.
- Reference plans are fixed strategy baselines; they are not a ranking of real traders.

## License

MIT. Design-token inspiration: [open-claude-ui](https://github.com/Caho1/open-claude-ui) (MIT).
