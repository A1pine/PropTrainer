# Trading Terminal — design and parity plan

Status: implementation plan for the Tradovate-style historical replay terminal.
Scope confirmed with the user: **core futures terminal**, **replay first**, **simulated
fills only**, **Prop Desk visual language**, **no real-money connection**.

This document is the contract for what will be built, where it lives, and what is
explicitly out of reach with the available data. It is written before implementation
and updated with evidence as phases land.

## 1. Product boundary

| Question           | Decision                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Reference platform | Tradovate Web core futures terminal. Feature parity is tracked item by item, never claimed wholesale.                                  |
| Market data        | Existing local 5-minute packs (Yahoo) or the deterministic synthetic generator. One base series per symbol.                            |
| Finer timeframes   | 1m/1s/tick are **not available**. They are shown as disabled with a reason, not synthesized.                                           |
| Order book / tape  | No depth or time-and-sales data exists. The DOM is a price ladder for order entry and position management, not a claim of book depth.  |
| Fills              | Deterministic bar-based simulation with a declared path policy. No claim of exchange-grade matching.                                   |
| Money              | Simulated account only. No broker, no live orders, no real capital.                                                                    |
| Existing exams     | `/trainer`, `/drill`, `/daily`, `/pk` keep their blind flow, scoring, reveal and analysis. The terminal is a separate route and store. |

### What "1:1" means here

A parity matrix (section 9) maps every confirmed core feature to one of:

- **Implemented** — usable in the terminal with automated evidence.
- **Adapted** — same workflow, but constrained by OHLCV replay (for example DOM
  without depth).
- **Not available** — requires data or services the project does not have.

The terminal will not present an adapted or missing feature as equivalent.

## 2. Data model and clock

### 2.1 Base series

Every terminal session loads one **base series** per symbol at 5 minutes. A session
pins:

- symbol and contract spec (tick size, tick value, point value, fee),
- the base candle array (immutable for the session),
- `cursor`: the index of the last **closed** base bar revealed to the trader,
- the replay start index and the session seed.

The cursor is the only clock. Advancing it is the only way time moves. Nothing else
(switching timeframe, resizing, opening a panel) can advance it.

### 2.2 Timeframe aggregation

Higher timeframes are aggregated from the base series **up to the cursor**:

| Timeframe        | Source                                        | Availability         |
| ---------------- | --------------------------------------------- | -------------------- |
| 5m               | base                                          | always               |
| 15m, 30m, 1h, 4h | 3/6/12/48 base bars, session-aware            | always               |
| 1D               | CME trading day (17:00–16:00 America/Chicago) | always               |
| 1m, 1s, tick     | —                                             | disabled with reason |

Rules:

- Aggregation buckets by wall-clock boundary, not by "every N bars", so a session
  gap never smears two days into one candle.
- A partially formed higher-timeframe candle is displayed from the revealed base
  bars only, and is marked as forming. Its high/low/close cannot include hidden
  future bars because the input slice ends at the cursor.
- Switching timeframe preserves the cursor and every order/fill. The engine always
  matches on base bars, so a 1h chart cannot fill an order "sooner" than the 5m
  replay allows.

### 2.3 Trading day and session calendar

- Trading day = CME Globex session starting 17:00 America/Chicago.
- Daily P&L, daily loss limit, max trades per day and consistency days use that
  boundary, computed with `Intl` timezone data — never the browser's local midnight.
- Weekend and holiday gaps come from the data itself; the aggregator never invents
  bars to fill them.
- The session clock is derived from candle timestamps, so replaying a historical
  Tuesday uses Tuesday's session even if the wall clock says otherwise.

## 3. Execution engine

### 3.1 Declared fill policy

OHLCV does not reveal the intrabar path. The engine therefore declares one policy
and applies it consistently:

1. A bar that opens beyond a resting level fills at the open (gap fill).
2. Otherwise a stop fills at its trigger price and a limit fills at its limit.
3. When a bar touches both the stop and a target, the **stop is assumed first**
   (adverse-first). This is conservative and matches the existing exam broker.
4. A market order fills at the current mark (last revealed close) and never at a
   price from a future bar.
5. All fills are all-or-nothing per level. Partial fills are not simulated because
   queue position is unknowable; this is documented in the UI.

Risk rules are evaluated at the **adverse extreme** of each revealed bar for open
positions (worst case within the bar), which is conservative and cannot understate a
breach. The UI states that intrabar sequencing is approximate.

### 3.2 Order model

- Sides: buy/sell.
- Types: market, limit, stop (stop-market), stop-limit.
- Time in force: DAY and GTC. IOC only for marketable limits, documented.
- One working entry order per instrument at a time; protective legs are separate.
- Bracket: one stop leg plus up to 5 target legs (OCO). Reducing a target reduces
  position quantity; remaining targets stay active until filled or cancelled.
- Position operations: add, reduce, close, reverse (close then open opposite).
- Protective orders are attached to the position, not to the entry order, so they
  survive partial exits.
- Cancel/replace preserves order identity in history (cancel event + new order).

### 3.3 Auto trade management (ATM)

- Auto breakeven: when profit reaches N ticks, move the stop to entry ± offset.
- Trailing stop: trail by N ticks from the best price since entry.
- Auto-trim: optional partial exit at a target.
- ATM settings are per template and visible in the ticket; they are applied by the
  engine on each revealed bar, never retroactively.

### 3.4 Position and account accounting

- Net position per symbol with average entry, quantity, unrealized P&L.
- Realized P&L is net of round-turn fees; the same number feeds every rule.
- Equity = balance + unrealized. Balance changes only on realized fills and fees.
- Every fill, cancel, rule transition and lock is appended to an event log with a
  bar index and timestamp, so the journal can be audited.

## 4. Prop-firm rule engine

Rules are a **configurable template**, not a hardcoded "Topstep mode". Presets are
examples with a source and a date; the engine is generic.

### 4.1 Schema

```ts
interface PropTemplate {
  id: string
  label: string
  accountSize: number
  profitTarget: number // 0 disables
  drawdown: {
    mode: 'static' | 'trailing_intraday' | 'trailing_eod'
    amount: number
    basis: 'balance' | 'equity' // equity includes unrealized
    floorCap: number | null // lock the floor at this level, e.g. start balance
    includeUnrealized: boolean
  }
  dailyLoss: {
    amount: number // 0 disables
    action: 'warn' | 'flatten' | 'flatten_lock'
    sessionStart: '17:00' // America/Chicago
  }
  maxContracts: number
  maxTradesPerDay: number // 0 = unlimited
  minTradingDays: number
  consistency: {
    maxBestDayRatio: number // e.g. 0.4 / 0.5 / 0.55
    gate: 'pass' | 'payout'
    basis: 'netProfit'
  } | null
}
```

### 4.2 Floor and breach semantics

- **Static**: floor = start balance − amount, never moves.
- **Trailing intraday**: floor = max(previous floor, peak equity − amount), updated
  from realized and unrealized equity at each revealed bar; never moves down.
- **Trailing EOD**: same, but the peak only updates at session close.
- **floorCap**: once the trailing floor reaches the cap (typically the starting
  balance), it locks there permanently.
- Breach when equity **≤** floor (equality counts). A breach is terminal: positions
  are flattened at the mark, working orders are cancelled, the account is locked,
  and editing the template cannot undo it. Only an explicit "new attempt" resets.
- **Daily loss** is a separate circuit breaker: hitting it flattens and cancels, then
  locks trading until the next session. It is **not** an account failure unless the
  template says so.
- **Consistency** is an eligibility gate, not a liquidation:
  `best profitable day ÷ total net profit`. Above the ratio, the target/payout is
  "not yet eligible"; trading continues. Losing days do not reset the best day.
- **Minimum trading days** gates the target the same way.

### 4.3 Breach line on the chart

For a single open position, the terminal shows the exact price where equity would
equal the floor:

```
floor = account floor
distance = equity − floor
priceMove = distance / (pointValue × |qty|)
long  breach price = mark − priceMove
short breach price = mark + priceMove
```

The line is labelled as a **risk threshold**, not an exchange liquidation price. With
multiple positions the panel shows account-level cushion only, because a single
price line would be misleading.

### 4.4 Presets (examples, versioned)

The UI ships generic templates (`50K Evaluation`, `100K Evaluation`, `Funded`) and
records their source and retrieval date. Topstep's published values as of
2026-10 are one example:

- Maximum Loss Limit: 50K → $2,000, trailing on end-of-day balance, locks at the
  starting balance; intraday unrealized losses count.
- Consistency target: 55% of the profit target in the Combine; 40% for XFA payout.
- Daily loss limit: optional, $1,000 / $2,000 / $3,000 for 50K/100K/150K, trading day
  17:00–15:10 America/Chicago, flatten + cancel, resume next session.

These are **not** presented as universal prop rules, and the app does not claim
certification by any firm.

## 5. UI placement

### 5.1 Navigation

New primary route `/terminal`, label **Trade** (en) / 交易 (zh) / トレード (ja).
Rail order: Lobby, Trainer, **Trade**, Drill, Analysis, Daily, Stats. On mobile the
tab bar keeps Trade and moves Daily into "More" so the bar stays readable.

### 5.2 Desktop layout (≥ 1280 px)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ account bar: equity · day P&L · drawdown cushion · DLL · consistency · status│
├──────────┬──────────────────────────────────────────────┬──────────────────┤
│ watchlist│ chart toolbar: TF chips · type · indicators   │ order ticket     │
│ 220 px   │                                              │ 300 px           │
│ symbol   │              price chart                     │ Buy / Sell       │
│ last     │      (1 or 2 panes, same clock)              │ qty · type       │
│ change   │                                              │ limit/stop       │
│ position │                                              │ bracket + ATM    │
│          ├──────────────────────────────────────────────┤ Position summary │
│          │ DOM ladder (toggle) / volume profile          │ Locate / flatten │
├──────────┴──────────────────────────────────────────────┴──────────────────┤
│ dock: Positions | Working orders | Fills | Journal | Rules                  │
└────────────────────────────────────────────────────────────────────────────┘
```

- Timeframe chips sit in the chart toolbar, not in a separate page.
- The replay controls (play/pause, step, speed, session progress) sit under the
  chart toolbar, matching the exam playback language.
- Buy/Sell buttons are always visible; the ticket defaults to the last used
  quantity and order type.
- Chart dragging: dragging an order line moves the price and issues cancel/replace.
  Dragging a bracket leg updates the protective order.
- DOM ladder: click a price row to load it into the ticket, shift-click to send a
  limit, right-click a working order to cancel. Depth column shows "no book data"
  rather than fabricated sizes.

### 5.3 Medium (768–1279 px)

- Watchlist collapses to a symbol dropdown in the account bar.
- Order ticket becomes a right-side drawer (320 px) opened by Buy/Sell.
- DOM becomes a tab beside the chart.

### 5.4 Mobile (< 768 px)

- Chart full width; sticky Buy/Sell bar above the tab bar.
- Ticket opens as a bottom sheet; brackets/ATM are collapsible sections.
- Dock becomes a segmented control (Positions / Orders / Fills / Rules).
- Timeframe chips scroll horizontally; unavailable timeframes stay visible but
  disabled with an explanation.
- Risk strip stays visible under the chart: equity, day P&L, cushion.

## 6. Technical architecture

```
app/domain/sim/
  types.ts        order, position, account, template, event types
  session.ts      CME trading day, session boundaries, DST-safe
  timeframe.ts    base → higher timeframe aggregation (cursor-bounded)
  engine.ts       deterministic matching, positions, brackets, ATM
  risk.ts         drawdown/daily/consistency evaluation and transitions
  presets.ts      versioned example templates
app/lib/sim/
  clock.ts        replay cursor + speed, single source of truth
  persistence.ts  snapshot serialization and restore
app/stores/terminal.ts
app/pages/terminal.vue
app/components/terminal/
  AccountBar.vue  Watchlist.vue  OrderTicket.vue  DomLadder.vue
  PositionsTable.vue  OrdersTable.vue  FillsTable.vue  RulesPanel.vue
  ReplayControls.vue  TimeframePicker.vue
app/lib/chart/  (extend: order lines, click-to-price, drag-to-replace)
wasm/src/       aggregate + risk analytics where the batch work is O(n)
```

- The engine is pure and deterministic: same candles + same actions = same result.
- Rust/WASM takes the O(n) batch work (multi-timeframe aggregation, drawdown curve,
  consistency aggregation) behind the existing optional-loader contract; a
  TypeScript fallback keeps the terminal usable if WASM fails.
- Persistence is a versioned snapshot in IndexedDB (`propdesk-replay-v1`) pinned to
  its run and tapes; a checkpoint whose cursor, marks or engine time no longer match
  is refused with `restoreBlocked` instead of being partially applied.
- The terminal never reads a candle beyond the cursor.

## 7. Milestones

| #   | Milestone                                                        | Evidence                                                    |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Domain: sessions, timeframes, order engine, risk engine          | unit tests, property tests for determinism and no-lookahead |
| 2   | Replay clock + terminal store + persistence                      | restore/continue tests, breach immutability                 |
| 3   | Shell: account bar, chart, timeframe switching, replay controls  | screenshots at 1440/1280/390, same cursor across TFs        |
| 4   | Ticket, brackets/OCO, ATM, positions, add/reduce/reverse/flatten | engine + component tests, e2e order lifecycle               |
| 5   | Chart trading + DOM ladder + watchlist                           | drag-to-replace e2e, ladder entry e2e                       |
| 6   | Rules panel, breach line, consistency gate, journal              | rule test matrix, screenshot evidence                       |
| 7   | i18n, responsive, a11y, docs, perf, commits                      | full suite, theme audit, smoke, perf log                    |

## 8. Verification plan

- **No lookahead**: mutate or replace candles after the cursor; reports, fills and
  risk must not change. Property test across all timeframes.
- **Clock invariance**: switching timeframe or layout cannot change cursor, orders,
  fills or equity.
- **Determinism**: same seed + same action script = identical event log and P&L.
- **Risk matrix**: static/trailing intraday/trailing EOD, floor cap, equality breach,
  daily lock vs account breach, consistency gate vs breach, min days.
- **Order matrix**: market/limit/stop/stop-limit, gap fills, stop-first ambiguity,
  OCO target/stop, partial target reduction, reverse, flatten, cancel/replace.
- **Persistence**: reload mid-session restores exactly; breach cannot be edited away.
- **UI**: keyboard operation, focus return, no exam shortcut leakage, mobile no
  overflow, light/dark contrast AA.
- **Performance**: timeframe switch and step latency budgets recorded in
  [`docs/perf/terminal.md`](../perf/terminal.md) — aggregation P95 4.67 ms against
  a 10 ms budget, artifact 157.6 KiB raw / 58.8 KiB brotli inside 160/60.

## 9. Parity matrix (filled in during acceptance)

| Area                          | Tradovate core behavior              | Terminal delivery                                      | Status        |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------ | ------------- |
| Timeframes                    | intraday + daily, custom intervals   | 5m base + 15/30/60/240/D via one aggregator            | delivered     |
| Charts                        | multiple panes, indicators, drawings | single pane, 4 styles, existing TA overlays + drawings | partial       |
| Quotes                        | watchlist with last/change/volume    | watchlist last/change from replay cursor               | partial       |
| Orders                        | market/limit/stop/stop-limit, TIF    | + trailing stop and trailing stop limit, DAY/GTC/GTD   | delivered     |
| Brackets                      | OCO stop + multiple targets          | 1 stop + up to 5 OCO targets                           | delivered     |
| ATM                           | auto BE, trailing                    | auto BE + trailing by ticks, per-contract presets      | delivered     |
| Chart trading                 | drag/modify/cancel                   | drag order lines, click to price, X to cancel          | delivered     |
| DOM                           | depth + order entry                  | price ladder and own orders; no depth claim            | adapted       |
| Tape                          | time & sales                         | unavailable without tick data                          | not available |
| Positions                     | add/reduce/reverse/flatten           | same, per instrument                                   | delivered     |
| Account                       | balance/equity/realized/unrealized   | same, fees included, day P&L                           | delivered     |
| Prop rules                    | drawdown, daily loss, consistency    | floor, daily loss, cap, min days, consistency, breach  | delivered     |
| History                       | orders/fills/journal                 | orders, fills, trades, events, day ledger, CSV         | delivered     |
| Workspace                     | saved layouts                        | up to 3 linked chart panes + saved layout/panes        | delivered     |
| Hotkeys                       | configurable                         | fixed core set (space, N, B, S, F, Esc)                | partial       |
| Real-time feed                | exchange connectivity                | not in scope                                           | not available |
| Options/spreads/multi-account | platform extensions                  | out of confirmed scope                                 | not available |

## 10. Open risks

- OHLCV ambiguity: stop/target ordering is a policy, not truth. The UI says so.
- Data licensing: local packs stay uncommitted; the app ships synthetic by default.
- Scope size: the matrix is large; milestones land independently and each is
  verified before the next, so partial delivery is never presented as full parity.
- Historical replay only: no claim about live behavior, latency or fills.
