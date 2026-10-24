# Trading terminal — implementation and parity

Confirmed scope: **Tradovate Web core futures workflows**, **replay first**, **simulated fills only**,
**Prop Desk's existing visual language**, and **prop drawdown, consistency and breach controls**.
There is no broker connection or real-money trading. This is a source-backed description of the current
terminal, not a wholesale 1:1 Tradovate claim. Final production/browser acceptance is recorded in
[the acceptance evidence map](#7-acceptance-evidence-map) and [terminal performance](../perf/terminal.md).

## 1. Product boundary

| Area           | Current boundary                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Data           | One pinned 5-minute OHLCV tape per instrument: local packs or deterministic synthetic data.                                              |
| Execution      | A declared bar-path simulator, not exchange matching or historical tick replay.                                                          |
| Quotes         | Last revealed close, change from the preceding revealed base bar, and that base bar's volume. No bid/ask quotes or session-volume claim. |
| DOM            | Price ladder, order entry and own orders only; no fabricated book depth.                                                                 |
| Account        | One simulated account, multiple symbols and working orders, one net position per symbol.                                                 |
| Existing exams | `/trainer`, `/drill`, `/daily` and `/pk` retain their separate blind flow and grading.                                                   |

Parity statuses in section 8 mean:

- **IMPLEMENTED WITHIN SCOPE**: the stated local workflow exists; this is not a claim that every reference-platform subfeature exists.
- **ADAPTED**: a narrower substitute, with the missing behavior named.
- **UNAVAILABLE**: absent or outside the confirmed scope.

## 2. Data, clock and calendar

### Shared replay clock

A run pins instrument specifications, tape arrays, provenance, seed and start index. Its checkpoint pins the
engine state, including rules, orders, positions, marks and ledger. `ReplaySession` builds a sorted union of tape
timestamps, capped at the common replay end. Gaps remain gaps; bars are never forward-filled.

`cursor` is a **count of revealed shared-timeline entries**, not an index into each symbol's tape. It starts at
`startIndex + 1`; the last revealed timestamp is `timeline[cursor - 1]`. The UI's `knownTime` adds 300 seconds
because base timestamps denote candle opens. Each symbol contributes only candles at or before the shared time;
a stale symbol retains its last mark but cannot accept new entries through the ticket.

Only stepping/playback advances the replay. Timeframe, style and layout changes do not change accounting.
Symbols with a bar at the next shared timestamp execute in stable tape order, holding the other marks fixed.
This is a deterministic cross-symbol approximation, not simultaneous exchange ticks. The full tape is in browser
memory; no-lookahead is an execution/display invariant, not an anti-cheat security boundary.

### Timeframes

| Choice                   | Behavior                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `5m`                     | Revealed base bars, with validation/session filtering.                                     |
| `15m`, `30m`, `1h`, `4h` | Session-open-anchored aggregation of the same revealed prefix.                             |
| `1D`                     | One baseline trading-session bucket.                                                       |
| Custom minutes           | Integer multiples of 5 from **5 through 1440**, entered in the toolbar; for example `45m`. |
| `1m`, `1s`, tick         | **Not offered**, rather than disabled choices. No finer data is synthesized.               |

Buckets use timestamps anchored to the session open, not every N observed bars. A higher-timeframe candle may
be incomplete; the chart's forming badge uses the revealed clock, and its OHLCV contains only revealed base bars.
The engine always executes on the original 5-minute bars, regardless of chart timeframe or Heikin-Ashi display.

### Weekly session baseline

`app/domain/sim/session.ts` models **17:00–16:00 America/Chicago**, the maintenance break, weekends and DST via
`Intl`. Trade dates are Monday–Friday; Sunday evening belongs to Monday. The day key rolls at the 16:00 close,
and the next session opens at 17:00. Accounting follows replay timestamps, never the browser's local midnight.

This is **not a complete exchange calendar**: holidays and early closes have no special rules. Missing holiday
bars stay missing, but a weekday holiday is still a nominal trade date in the weekly model. At a scheduled close,
positions are flattened at last-known marks, fees are booked, risk is checked, the day is finalized, and risk is
checked again. DAY orders expire; GTC orders survive. A missing closing bar is handled before the next session's
bars. Tape exhaustion in the middle of a session does not invent a close or finalize that incomplete day.

## 3. Execution and order management

### Declared fill policy

1. If `close >= open`, walk `O → L → H → C`; otherwise walk `O → H → L → C`.
2. Visit order/risk crossings along that path. Marketable resting orders fill at a gapped open; otherwise limits
   and stops fill at eligible path levels. Stop-versus-target ordering follows this path, not blanket stop-first.
3. An immediate market submission fills at the current revealed mark. A newly submitted resting order cannot
   reuse already-revealed intrabar history. Suspended orders wait for their eligible release/bar event.
4. A stop-limit first activates its limit, then matches against that limit at the next matching evaluation.
   It may fill at the trigger price if marketable there; otherwise it waits for a later eligible path level.
   Pre-trigger highs/lows are never reused, and a gap cannot bypass the limit constraint.
5. There is no queue, spread, depth or volume-based partial-fill model. Each eligible order fills its executable
   quantity at once. **Explicit partial exits and separately sized targets are supported**; those are not queue fills.

Risk is evaluated at visited path events and after fees. Touching a floor and then recovering within the same
bar still breaches. These are reproducible simulator rules, not evidence of the actual intrabar price path.

### Orders, protection and accounting

- Six order types: `market`, `limit`, `stop`, `stop-limit`, `trailing-stop`, `trailing-stop-limit`.
  TIF values are `day`, `gtc`, `gtd` (DAY/GTC/GTD in the UI), with optional release and expiry times.
- Multiple working/suspended entries reserve gross contract capacity and buying power, including entry fees.
  Opposite pending entries do not net away reservations. Checks run at submission, amendment and fill.
- A position can have one protective stop and up to five sized OCO targets. Partial reductions resize remaining
  protection; reduce-only exits cannot reverse the position.
- **Modify keeps the same order ID** and appends a `modified` event. Chart dragging calls this amendment path;
  it is not a cancel event followed by a new order.
- Add, reduce, close, flatten and reverse operate per symbol; confirmed Exit all closes/cancels across the account.
  Reverse cancels that symbol's orders/protection, closes the position and attempts a new opposite market entry.
  Closing fees/risk checks can prevent the new entry. **Old brackets/ATM are not automatically re-armed.**
- ATM supports break-even trigger/offset and trailing trigger/distance/step in ticks, with local per-instrument
  presets. It advances on eligible path events, not retroactively, and does not recreate a cancelled stop.
- Balance reflects realized cash changes and fees; equity is balance plus unrealized P&L. Completed-trade P&L
  includes fees. Fills, amendments, cancellations and risk transitions remain in the event/history records.

## 4. Configurable prop rules

### Current schema

The source of truth is `app/domain/sim/types.ts`; these are the current enum spellings, not a firm rulebook:

```ts
interface PropTemplate {
  id: string
  label: string
  accountSize: number
  profitTarget: number
  drawdown: {
    mode: 'static' | 'trailing-intraday' | 'trailing-eod'
    amount: number
    basis: 'balance' | 'equity'
    floorCap: number | null
    includeUnrealized: boolean
  }
  dailyLoss: {
    amount: number
    action: 'warn' | 'flatten' | 'flatten-lock'
  }
  maxContracts: number
  maxTradesPerDay: number
  minTradingDays: number
  consistency: { maxBestDayRatio: number; gate: 'pass' | 'payout' } | null
  source?: string
}
```

Zero disables the profit target/daily-loss rule or makes max trades unlimited. Max trades counts completed
flat-to-flat positions, not fills. The session calendar is shared; there is no template-specific `sessionStart`.

### Drawdown, fees and eligibility

- **Static floor** = starting balance − drawdown amount.
- **Trailing floor** uses peak − amount, capped by `floorCap` when set, and never decreases. The peak's
  `basis` independently selects balance or equity. `trailing-intraday` updates on path/risk events;
  `trailing-eod` updates only when the ledger day is finalized, after scheduled closing fills and fees.
- **Breach monitoring is separate from peak basis**: `includeUnrealized` selects equity when true and balance
  when false. `monitored <= floor + EPSILON` breaches, so equality counts. A breach latches, cancels orders,
  flattens positions and disables new risk; restore or editing a draft template cannot revive it.
- Daily loss measures equity against session-start equity. `warn` warns once; `flatten` closes/cancels once but
  permits later trading that session; `flatten-lock` also blocks entries until the next session. Exit fees may
  turn a daily stop into a permanent drawdown breach.
- Consistency = best profitable **finalized** day / total net profit across finalized days, including losing days
  and booked fees. A nonpositive total has no eligible ratio. It is an eligibility gate, not liquidation.
  `pass` gates target completion; `payout` is an eligibility display, not an actual payout service.
- A target requires sufficient profit, no open contracts, finalized fill days, minimum finalized days with fills,
  and any pass-consistency gate. Crossing the target intraday is not automatically a pass.
- Rule changes are applied through a confirmed new attempt; the current attempt keeps its pinned rules.

### Conditional price lines

For a symbol with an open position and equity-monitored drawdown, the current threshold is:

```text
signedQty = +qty for long, -qty for short
breachPrice = mark + (floor - accountEquity) / (signedQty * pointValue)
```

It is rounded toward the breaching tick. **Other symbols' marks are held fixed**, so multi-position accounts
still get a conditional per-symbol value, not an unconditional liquidation price. It uses the current floor and
excludes hypothetical future closing fees; changing marks, fees or a trailing floor can change the outcome.
Balance-only drawdown has **no drawdown price line**. The separate daily-loss line remains equity-based.

The active chart pane draws conditional breach and daily-loss levels only when in scale. The account's dollar
floor is an account-bar metric, not a price line. Off-scale values remain available in the position/account UI.

### Generic presets, not licensed firm rules

`app/domain/sim/presets.ts` ships `50K Evaluation`, `100K Evaluation`, `50K Funded` and `Practice (no limits)`.
The evaluation examples use 55% pass-consistency and the funded example 40% payout-consistency as **local
illustrative parameters**, not current Topstep or other firm's rules. Their source strings are descriptive
metadata, not licenses or independently verified rulebook versions. Practice still has a finite floor, contract
cap and margin validation. No preset certifies firm eligibility, exchange compliance or a payout.

## 5. UI and local preferences

### Navigation and responsive layout

`app/composables/useNav.ts` defines the rail order: Lobby, Trainer, Trade (`/terminal`), Drill, Analysis, Daily,
PK, Stats; Guide and Settings are secondary. On mobile, the primary links are Lobby, Trainer, Trade, Drill,
Analysis and Stats; More contains Daily, PK, Guide and Settings.

- **≥1280 px**: 212 px watchlist, chart area and 296 px ticket column. Account bar is above; the ladder can be
  toggled; the dock has Positions, Orders, Fills, History and Rules.
- **1024–1279 px**: watchlist remains; Buy/Sell opens the shared **bottom-sheet ticket**, not a right drawer.
- **<1024 px**: watchlist sidebar is hidden and only the active chart pane renders; pane/symbol controls remain.
  Buy/Sell uses the same bottom sheet. The mobile navigation itself appears below 768 px.
- One to three panes share the replay clock. The active pane controls ticket, ladder, position card and risk
  overlays. The locally saved pane list contains symbol, timeframe and style; it is not named workspaces,
  import/export, arbitrary docking/resizing, multi-window layouts or cloud sync.

### Charts, quotes and account details

`TerminalChartPane.vue` exposes candlestick/OHLC/line/Heikin-Ashi rendering, opt-in TA, trend lines and horizontal
lines. TA starts off and reuses visible-prefix EMA/VWAP/Bollinger, price-action, ICT and OHLCV-flow helpers with
independent controls. This is a fixed local toolset, not the complete Tradovate indicator/drawing catalogue.
Drawings are component-local, clear on symbol/timeframe changes, and are not saved with the layout. Drawing
mode suppresses chart order actions. There are no tick/range/Renko, TPO, footprint or heatmap charts.

Cursor mode supports click-to-price, tick-rounded order amendments and cancellation. The ladder's center price
prefills the ticket (shift-click selects a limit); side buttons place limits, with shift-click/context-menu/shift-Enter
for stops. Own order quantities and cancel controls are shown; depth stays unavailable.

Watchlist last/change/volume refer to the **revealed 5-minute base bar**, not the selected chart interval or
session totals. The account strip/details show balance, equity, realized/unrealized P&L, day P&L, margin,
buying power, floor/cushion, daily remaining, contracts, consistency and status.

### Hotkeys

Six locally remappable actions are **disabled by default**: Space play/pause, N step, B/S open or focus the
buy/sell ticket (not submit), F flatten the active-symbol position, Escape close the ticket. Bindings persist
locally. Typing, menus/dialogs, composition, repeats and modifier chords are guarded. This is not full
per-module Tradovate hotkey support.

## 6. Architecture and persistence

```text
app/domain/sim/
  types.ts, presets.ts    contracts and generic templates
  session.ts              weekly Chicago/DST calendar
  timeframe.ts            validated, revealed-prefix aggregation
  engine.ts, risk.ts      TypeScript execution and rule state transitions
app/lib/sim/
  tape.ts, replay.ts      pinned tapes, shared timeline and ReplaySession
  persistence.ts         IndexedDB run/checkpoint repository
  layout.ts, hotkeys.ts   local display/input preferences
  chart.ts, risk-lines.ts chart helpers and risk-price rounding
  atm-presets.ts          local ATM presets
  export.ts               CSV output
app/stores/terminal.ts    page orchestration, timer, persistence status/retry
app/pages/terminal.vue    responsive desk and active-pane coordination
app/components/terminal/
  AccountBar.vue, Watchlist.vue, OrderTicket.vue, DomLadder.vue
  PositionsTable.vue, OrdersTable.vue, FillsTable.vue, TerminalHistory.vue
  RulesPanel.vue, ReplayBar.vue, TimeframePicker.vue
  TerminalChartPane.vue, HotkeySettings.vue
app/lib/chart/           shared canvas rendering and pointer interaction
wasm/src/terminal.rs     prop_aggregate batch aggregation
```

WASM accelerates aggregation and supplies the existing analysis helpers. Aggregation has a TypeScript fallback;
TA is unavailable without its analysis core, while replay/trading remains usable. **Execution, drawdown and
consistency transitions stay in TypeScript**; there is no WASM drawdown/consistency engine.

IndexedDB `propdesk-replay-v1` stores the pinned run plus checkpoint. Restore validates cursor, tape marks and
engine time; a bad/unreadable checkpoint sets `restoreBlocked` rather than silently resetting an account.
The UI exposes save/restore status, Retry and an explicit confirmed new attempt. Async save failure means the
latest state may not survive refresh; trading success is not a promise that storage succeeded.

Symbol/timeframe, pane layout, hotkeys and ATM preferences use localStorage separately from accounting.
The terminal shows a synthetic/local source label and fallback notices. Tape provenance is carried in
`ReplayTape.provenance` but not surfaced as a panel, and there is **no source or replay-start picker**.
An existing attempt restores its pinned tape rather than silently switching to a newly installed pack.

## 7. Acceptance evidence map

The final production run passed the source and browser checks below; unit/component checks do not substitute for
the browser pointer, focus and responsive flows, which are listed separately.

| Contract                                                                                  | Evidence source and scope                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calendar, custom frames, no future aggregation, TS/WASM parity                            | `tests/unit/sim-core.spec.ts`, `tests/unit/sim-timeframes.spec.ts`                                                                                                                                                                                                 |
| Path ordering, gaps, six order types, reservations, partial exits, ATM, fee/session risk  | `tests/unit/sim-engine.spec.ts`                                                                                                                                                                                                                                    |
| Peak basis vs monitor, floors/caps, daily actions, finalized consistency/target gates     | `tests/unit/sim-risk.spec.ts`                                                                                                                                                                                                                                      |
| Shared timeline, future mutation isolation, deterministic actions, exhaustion and restore | `tests/unit/sim-replay.spec.ts`                                                                                                                                                                                                                                    |
| Save/restore failures, pinned rules, retry, breach persistence                            | `tests/unit/terminal-persistence.spec.ts`                                                                                                                                                                                                                          |
| Ticket/ladder/table/rules/history controls and CSV                                        | `tests/component/terminal-ticket.spec.ts`, `tests/component/terminal-tables.spec.ts`, `tests/component/terminal-rules.spec.ts`, `tests/component/terminal-history.spec.ts`                                                                                         |
| Quotes, custom input, account details and replay controls                                 | `tests/component/terminal-market-controls.spec.ts`                                                                                                                                                                                                                 |
| TA/drawing isolation, forming/focus helpers, canvas behavior                              | `tests/component/terminal-chart-pane.spec.ts`, `tests/unit/terminal-chart-helpers.spec.ts`, `tests/unit/chart-engine.spec.ts`, `tests/component/chart-canvas.spec.ts`                                                                                              |
| Layout storage and guarded remapping                                                      | `tests/unit/terminal-layout.spec.ts`, `tests/unit/terminal-hotkeys.spec.ts`, `tests/component/hotkey-settings.spec.ts`                                                                                                                                             |
| Browser checks against a running server                                                   | `scripts/check-terminal.mjs`: 65 checks passed on the production build — orders/steps, conditional risk display, display invariance, layout reload, hotkeys, 1440/390 layouts, TA/drawing isolation, real canvas amend/cancel, Exit all and restore-blocked retry. |
| Aggregation/artifact and WASM loading                                                     | `scripts/bench-timeframes.ts`, `tests/unit/wasm-budget.spec.ts`, `scripts/check-wasm-load.mjs`; measurements/limits in [terminal performance](../perf/terminal.md)                                                                                                 |

The older browser checks did **not** establish chart drag acceptance; a check existing in the updated script is
not itself a passing result. Nor does this map claim every order/rule combination has end-to-end coverage.

## 8. Scoped parity matrix

| Area                               | Current implementation and omissions                                                                                                   | Status                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Replay timeframes                  | Six presets plus custom 5–1440 minute multiples of 5, forming badge, one revealed timeline.                                            | IMPLEMENTED WITHIN SCOPE |
| Finer timeframes                   | No 1m/seconds/tick data or choices.                                                                                                    | UNAVAILABLE              |
| Charts/studies/drawings            | Up to three panes, four styles, fixed TA layers, trend/horizontal drawings; no full catalogue, saved drawings or advanced chart types. | ADAPTED                  |
| Quotes                             | Replay last, one-base-bar change and volume; no bid/ask or live/session quote service.                                                 | ADAPTED                  |
| Orders                             | Six local order types, DAY/GTC/GTD, release/expiry, amendment/cancel; no exchange queue, volume-based partial fills or routing.        | ADAPTED                  |
| Brackets and ATM                   | One stop/up to five sized targets, OCO reduction, break-even/trailing and local presets; no automatic protection re-arm after reverse. | IMPLEMENTED WITHIN SCOPE |
| Chart trading                      | Click-to-price, same-ID drag amendment and X cancel in cursor mode; simulated orders only.                                             | IMPLEMENTED WITHIN SCOPE |
| DOM                                | Price ladder and own orders, not book depth/queue/liquidity.                                                                           | ADAPTED                  |
| Time & sales / order flow feed     | No trade prints, bid/ask delta, footprint or depth feed; analysis flow is an OHLCV proxy only.                                         | UNAVAILABLE              |
| Positions/account                  | Multi-symbol net positions, add/reduce/reverse/flatten/Exit all, fee-aware P&L, margin/buying power; one simulated account.            | IMPLEMENTED WITHIN SCOPE |
| Prop overlay                       | Configurable floors, daily actions, caps, finalized-day/consistency gates and conditional risk price; not a licensed firm rulebook.    | IMPLEMENTED WITHIN SCOPE |
| History                            | Orders, fills, trades, events, day ledger and CSV; local records, not broker statements.                                               | IMPLEMENTED WITHIN SCOPE |
| Workspace                          | One locally saved pane list; no named workspaces, layout import/export, docking, multi-window or cloud sync.                           | ADAPTED                  |
| Hotkeys                            | Six opt-in remappable local actions; not the full per-module action catalogue.                                                         | ADAPTED                  |
| Exchange connectivity / real money | No live or delayed streaming feed, broker, real orders or payout service.                                                              | UNAVAILABLE              |
| Options, spreads, multi-account    | Outside the confirmed core replay scope.                                                                                               | UNAVAILABLE              |

## 9. References and remaining limits

Official reference context: [Tradovate](https://www.tradovate.com/) and
[Tradovate platform overview](https://www.tradovate.com/platform/). These identify the reference product; they do
not certify this simulator or verify any firm's current rules. No unverified deep help-article URL is used as
acceptance evidence.

Local packs remain subject to their source's licensing and are not committed. Weekly session modeling,
bar-path ambiguity, frozen other-symbol marks and local-only storage are explicit limits. No result here
establishes live-market latency, realistic queue fills or a real trading edge.
