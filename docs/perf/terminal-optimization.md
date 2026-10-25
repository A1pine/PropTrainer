# Terminal performance optimization

This pass follows measure → optimize → verify. The acceptance report in
[terminal.md](terminal.md) remains historical evidence; this document compares the
untouched baseline `7efe627` with the optimized tree using the same workloads and
scripts. Machine-readable values are in
[terminal-optimization.json](terminal-optimization.json).

## Outcome

The final comparison uses serial runs after the durability fixes, with matching
before/after source, harness and production-build hashes. Earlier exploratory
runs are retained but excluded from the tables. All values below are milliseconds
unless otherwise indicated.

### Browser response, not just engine CPU

Each hot scenario has 30 measured steps after a warm-up. The stress workload has
1,000 completed round trips, 16 resting limits, one open contract and three 5m
panes. TA-off and TA-on use successive bars, not identical paired market states.

| Scenario (P95)                    | Baseline response | Optimized response | Baseline sync CPU | Optimized sync CPU | Baseline draw CPU | Optimized draw CPU |
| --------------------------------- | ----------------- | ------------------ | ----------------- | ------------------ | ----------------- | ------------------ |
| Normal, one pane, TA off          | 30.6              | 30.3               | 0.6               | 0.4                | 1.4               | 1.4                |
| Normal, three panes, TA off       | 30.6              | 30.1               | 0.6               | 0.3                | 1.7               | 1.9                |
| Normal, one pane, TA on           | 30.8              | 30.4               | 0.6               | 0.3                | 1.5               | 1.6                |
| Late history, three panes, TA off | 54.3              | **31.3**           | 45.5              | **0.5**            | 0.7               | 1.2                |
| Late history, three panes, TA on  | 59.3              | **30.9**           | 45.5              | **0.5**            | 0.8               | 1.2                |

The stress response drops by about **42% / 48%**; pooled stress P95 is
58.2 → 31.1 ms. Normal interactions remain around 30–32 ms, consistent with the
measurement's frame-cadence floor: this is not evidence of a meaningful normal-page
speedup. Draw CPU does not improve in every scenario; its small increases remain
well below the 16.7 ms budget. A separate confirmation run has worst normal
scenario P95 **31.9 → 31.9 ms** and worst draw P95 **1.9 → 2.0 ms**.

| Single stress observation                     | Baseline | Optimized |
| --------------------------------------------- | -------- | --------- |
| Total setup, including pane/TA preparation    | 51.21 s  | 0.901 s   |
| Store-only setup                              | 50.45 s  | 0.284 s   |
| One real step plus awaited checkpoint flush   | 59.0 ms  | 13.4 ms   |
| Awaited `terminal.flush()` only               | 14.3 ms  | 12.9 ms   |
| Reload to ready store and chart draw callback | 144.2 ms | 127.5 ms  |

Setup, flush and reload are single observations, **not** P95 estimates. The
~57× setup ratio describes a synthetic bulk-history workload, not normal input
latency or the whole UI.

### Offline replay cost

The step interval includes scheduled entry/flatten plus one shared-timeline step
across eight symbols. It excludes Vue, chart drawing and IndexedDB. Snapshot,
checkpoint export and in-memory restore are measured separately.

| Operation (P95)                  | Baseline | Optimized | Interpretation               |
| -------------------------------- | -------- | --------- | ---------------------------- |
| Step, 1,200 steps / 595 trades   | 31.293   | 0.123     | ~255× lower engine cost      |
| Step, 5,000 steps / 2,481 trades | 106.250  | 0.057     | ~1,861× lower engine cost    |
| Snapshot, 595 trades             | 3.871    | 0.166     | Caller-owned copies retained |
| Checkpoint export, 595 trades    | 3.758    | 0.153     | Excludes IndexedDB commit    |
| In-memory restore, 595 trades    | 15.961   | 12.486    | Excludes IndexedDB read      |
| Snapshot, 2,481 trades           | 12.200   | 0.664     | Full history retained        |
| Checkpoint export, 2,481 trades  | 13.032   | 0.350     | Full history retained        |
| In-memory restore, 2,481 trades  | 54.001   | 40.038    | Full validation retained     |

The 10,000-step / 4,963-trade scale probe has no paired baseline: step P95
0.059 ms, snapshot 1.104 ms, checkpoint 0.885 ms, restore 102.525 ms. These are
engine-only timings, not browser-response predictions. Normal and stress final
state SHA-256 values match the baseline exactly.

### Cold open and budgets

Cold opens use 30 fresh browser contexts per run, but warm host/disk caches.
All three pairs are retained; no cold-start improvement is claimed.

| Production run                   | Baseline cold P95 | Optimized cold P95 |
| -------------------------------- | ----------------- | ------------------ |
| Initial normal comparison        | 177.7 ms          | 369.1 ms           |
| Stress run's fresh-context opens | 189.0 ms          | 167.8 ms           |
| Normal confirmation              | 204.6 ms          | 178.9 ms           |

The first optimized cold result is worse and must not be hidden by the later
runs. The two subsequent pairs do not reproduce that regression; they do not
establish statistical equivalence either. All normal-scenario budget checks pass:
hot response P95 ≤ 50 ms, chart callback CPU ≤ 16.7 ms, cold P95 ≤ 1500 ms. Stress
is separate unbudgeted evidence; its final response also lies below 50 ms.

## What changed

### 1. Replay mutates; snapshots are opt-in

`SimEngine.advance(context)` now contains the mutation path that used to live in
`onBar()`. `ReplaySession.step()` calls `advance()` for every instrument on the
shared timeline, so replay no longer builds and discards a full snapshot per
instrument per step. `onBar()` remains as `advance()` plus `snapshot()` for API
compatibility and for callers that need the returned state.

`tests/unit/sim-engine.spec.ts` asserts that `advance()` never calls `snapshot()`
and that the engine's bar/mark still advances; replay tests check the shared cursor.

### 2. Lightweight valuation and risk reads

`account()` still returns the public, fully populated account and still scans
reservations for buying power. Internally, the hot path now uses:

- `valuation()` for unrealized P&L, margin, and open contracts;
- `equity()` for `balance + unrealized`;
- `riskView()` for the three values risk evaluation needs;
- `RiskEngine.startBalance` / `dayStartEquity` scalar getters that do not clone
  the day ledger.

`onBar`, `recordFill`, `evaluateRisk`, and `riskLevels` use these instead of
`account()` plus `risk.state`. Money rounding and exposure checks are unchanged.

### 3. Live-order index

`visit()`, `reservations()`, `expireOrders()`, and protection lookups no longer
scan every order ever submitted. The engine maintains a `liveOrders` map alongside
the full historical `orders` map:

- submitted working/suspended orders and protective legs are indexed;
- release and modify keep membership; fill, cancel, expiry, and reject remove it;
- `visit()` and `reservations()` iterate live orders only;
- `exportState()` keeps the full historical order map and insertion order;
- `fromState()` rebuilds the index from persisted order status (suspended
  orders remain suspended until their release event);
- `prime()` leaves the index alone; an unfilled entry can coexist with a
  warmup mark.

Historical orders remain intact for tables, export, and restore. The index is
exercised by the order, bracket/OCO/ATM, session and restore suites; there is no
direct private-set invariant test.

### 4. Typed copy helpers instead of generic deep clones

`app/domain/sim/copy.ts` adds:

- `copyRows()` for flat scalar rows (fills, trades, events);
- `copyOrders()` for orders, deep-cloning only the nested bracket.

`snapshot()` and `exportState()` use these helpers. Mapped-type constraints on both
helpers fail compilation if a nested field is added outside `bracket`. Snapshot
isolation tests mutate fills, trades, events, orders, brackets, and position targets.

### 5. Run-local candle memo

`terminal.candlesFor()` caches the aggregated series per `run id + symbol + frame`.
It reuses the result when the tape array identity and revealed count are unchanged,
recomputes on growth, shrink, tape replacement, or run replacement, and clears on
install/new attempt. Multiple panes showing the same symbol/frame share one array
and one aggregation.

### 6. Chart series identity

`ChartEngine.setCandles(candles, visibleCount, seriesKey?)` treats a stable key as
the same series: pan/zoom/follow survive appends, and a key-only change resets the
viewport. Callers without a key keep the old array-identity behavior. The terminal
passes `run id : symbol : timeframe`; drawings clear when that identity changes.

### 7. Only render what is visible

- Narrow layouts aggregate only the active pane, not all configured panes.
- One `Intl.DateTimeFormat` is reused for the replay label.
- An empty analysis object is shared instead of allocated per tick.
- TA-off chart panes pass the local revealed count to the study control, avoiding
  a second full-prefix copy.
- `useExamAnalysis` avoids slicing when the count already covers the source.

### 8. Checkpoint coalescing that cannot strand a save

`queueCheckpoint()` stores a thunk, not a built checkpoint. A synchronous burst
collapses to the latest state. The drain clears itself and restarts when work was
queued during handoff; `flush()` waits for attempt creates and loops until no
drain, pending checkpoint, or newer write promise remains. A throwing export is
reported as `unavailable` and retried on the next step instead of rejecting the
drain. Regression tests cover the saved-status handoff, a throwing export, and a
delayed attempt create.

## Correctness evidence

- 866 tests / 43 files pass; typecheck and Prettier clean; Rust 10/10 pass.
- The final production build and its served entry assets are hashed in the raw
  evidence. The WASM artifact and lockfile are unchanged; existing
  160/60/70 KiB raw/brotli/gzip budgets pass.
- Replay/session, order priority, brackets/OCO/ATM, fees, risk, consistency,
  checkpoint round-trip, corrupt-state rejection, no-lookahead, and the full browser
  terminal check remain green.
- The normal and 2,481-trade compute runs produce the same final state hashes as
  the baseline (see the JSON artifact), so trading outcomes did not change.
- `check:terminal` 65 checks, smoke 18 flows, theme audit 5 routes × light/dark,
  WASM checks, and the existing analysis/execution checks pass against the final
  production build.
- The final gate logs are in
  [`terminal-optimization-logs/`](terminal-optimization-logs/); `verification.json`
  records command, working directory, exit code, duration and log hash. They were
  run serially after the provenance-verified benchmark runs, not interleaved with
  timed measurements.

## Measurement boundaries

- Production Chromium, 1440 × 1000 CSS px, DPR 2, normal motion, headless.
- The benchmark activates real toolbar elements with `HTMLElement.click()` and
  waits for the next animation frame after every pane's draw callback; this is
  not a guarantee that the compositor presented the pixels.
- `response` = event start → that frame. `syncWork` ends when `HTMLElement.click()`
  returns, before Vue microtasks or deferred checkpoint construction. Hot response
  does not explicitly await IndexedDB, but deferred export/write work can overlap
  its interval; it is not subtracted from the result.
- `flush` is one real step plus an awaited `terminal.flush()`; it includes deferred
  export and the IndexedDB commit. The table also lists the awaited flush alone,
  because the step's synchronous cost is measured separately.
- `restore` is navigation start → ready store plus a draw callback observed at
  the restored cursor on every pane.
- Heap uses CDP `Runtime.getHeapUsage` without forced GC; it is not a leak verdict.
- Stress results are intentionally unbudgeted evidence; the budget checks still use
  the normal scenarios.

- Compute step distributions contain 1,200 / 5,000 / 10,000 observations while
  history grows. Final snapshot/checkpoint/account probes use 50 samples after up
  to 10 warm-ups; restore and per-frame aggregation use 30 after warm-up.
- The browser workload uses deterministic synthetic tapes (`PERF_SEED`), not the
  optional private Yahoo pack. No claim is made for cold fetching or decoding of
  that pack, real networks, mobile hardware or live market data.

## Provenance and run order

[`terminal-optimization-raw/manifest.json`](terminal-optimization-raw/manifest.json)
contains checksums for 20 gzip archives: 11 final serial runs and nine retained,
**superseded** exploratory artifacts. Only the final roles referenced by
`terminal-optimization.json` contribute to this comparison.

The final source fingerprints are `0ebd7b298f56…` (baseline) and `d566ccee9984…`
(optimized); browser harness `aaebd4a58f32…`, compute harness `abc6ad240f54…`.
Each raw artifact includes full file manifests captured before and after the run.
Browser runs also compare served entry-asset bytes with the declared build.
Hashes detect edits during a run; they do not replace the requirement to build
that checkout before measuring it.

Run order was optimized normal → baseline normal → baseline stress → optimized
stress → serial compute probes → baseline confirmation → optimized confirmation.
No timing run overlapped another timing run or a build/test job. The order was not
randomized, so small differences are not treated as statistically significant.
The paired cold results above include the slower initial optimized run.

## Reproduce

```bash
# Offline engine probe (baseline and optimized)
PERF_OUTPUT=profile_output/terminal-compute-final.json bun scripts/bench-terminal-compute.ts
PERF_BARS=6000 PERF_STEPS=5000 PERF_TRADES_EVERY=2 \
  PERF_OUTPUT=profile_output/terminal-compute-stress-final.json bun scripts/bench-terminal-compute.ts

# Production browser run
bun run build
PORT=4173 HOST=127.0.0.1 node .output/server/index.mjs
PERF_OUTPUT=profile_output/terminal-ui-final.json bun scripts/bench-terminal.mjs --check
PERF_STRESS=1 PERF_OUTPUT=profile_output/terminal-ui-stress-final.json \
  bun scripts/bench-terminal.mjs --check
```

For the baseline, build `7efe627` in a separate worktree and serve it on another
port. Run the current browser script from this checkout with **both**
`BASE_URL=http://127.0.0.1:4174` and `PERF_APP_ROOT=/absolute/path/to/baseline` so
the source/build fingerprints identify the server's checkout, not the launcher's.
For offline compute, copy `scripts/bench-terminal-compute.ts` and
`scripts/perf-evidence.mjs` into that baseline worktree and run there. Use the same
Bun/Chrome versions and lockfile; install dependencies in each checkout (the local
run reused one dependency tree). Do not run timing jobs in parallel with one another,
builds, tests or audits. The scale probe uses `PERF_BARS=12000 PERF_STEPS=10000`.

## Instrumentation changelog

Profiling is isolated to standalone runners; no timing hooks ship in the app.

| File or directory                                                             | Change         | Purpose                                                                                                                |
| ----------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `scripts/bench-terminal.mjs`                                                  | Extended       | Deterministic seed, optional real-store stress workload, flush/restore/heap observations, source/build/HTTP provenance |
| `scripts/bench-terminal-compute.ts`                                           | Added          | Real replay engine, growing history, separate snapshot/checkpoint/restore probes and final-state hash                  |
| `scripts/perf-evidence.mjs`                                                   | Added          | Before/after source, harness and build manifests outside timed regions                                                 |
| `package.json`                                                                | Added command  | `bench:terminal:compute` runner                                                                                        |
| `profile_output/`                                                             | Local, ignored | Original runs and packaging scratch files; disposable after archiving                                                  |
| `docs/perf/terminal-optimization*.{md,json}` and `terminal-optimization-raw/` | Added          | Human report, structured comparison, original compressed samples and checksum manifest                                 |

App changes in the earlier sections are production optimizations, not profiling
instrumentation. Removing the runners later does not require reverting those changes.

## Limits

- No worker, binary ABI, TA windowing, or durability debounce was added. None was
  justified by the measured profile.
- The full ledger and historical orders are retained; no history pruning.
- The terminal still uses historical 5m OHLCV, simulated fills, and a weekly CME
  calendar without holidays or early closes.
- These numbers are local production-build evidence, not a hosted SLA.
