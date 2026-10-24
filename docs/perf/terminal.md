# Replay terminal performance

The terminal adds two costs that the trainer did not have: aggregating a 5-minute
tape into a chart timeframe, and stepping eight pinned tapes through one replay
clock. Both are measured instead of assumed.

Reproduce against a local build:

```bash
bun scripts/bench-timeframes.ts           # aggregation parity + latency
bun run check:terminal                    # real browser, 19 checks
bun run check:wasm                        # first paint and single-fetch proof
```

## Aggregation (Rust vs TypeScript)

`bun scripts/bench-timeframes.ts` builds a 13,000-bar 5-minute tape, aggregates
it into 15m/30m/1h/4h/1D plus a custom 45m frame, and checks that the Rust
`prop_aggregate` path and the pure TypeScript reducer produce identical bars
before timing them. Artifact: `6f25df2fa549bae9`.

| Frame | P50  | P95  | P99  |
| ----- | ---- | ---- | ---- |
| all   | 3.74 | 4.67 | 5.69 |
| 15m   | 4.55 | 5.69 | 5.69 |
| 30m   | 3.93 | 4.67 | 4.67 |
| 1h    | 3.69 | 4.01 | 4.01 |
| 4h    | 3.43 | 4.19 | 4.19 |
| 1D    | 3.25 | 3.69 | 3.69 |
| 45m   | 3.70 | 4.53 | 4.53 |

Milliseconds, 60 samples after warm-up, budget P95 ≤ 10 ms. The TypeScript
oracle is faster (P95 0.67 ms) because it never crosses the ABI; WASM is kept for
the size of the working set and parity, and every non-base timeframe falls back
to the TS reducer if the export is missing or fails.

Base 5-minute charts bypass aggregation entirely — the revealed slice is drawn
as-is — so the common case costs nothing.

## Artifact budget

| Metric | Value     | Budget |
| ------ | --------- | ------ |
| raw    | 157.6 KiB | 160    |
| brotli | 58.8 KiB  | 60     |
| gzip   | 69.1 KiB  | 70     |

`tests/unit/wasm-budget.spec.ts` fails on size, compression ratio, a missing
export or a stale content hash. `prop_aggregate` is optional in the loader, so
an older artifact still boots the terminal with the TS path.

## Replay stepping

`check-terminal.mjs` drives the real page: one market order, four single-bar
steps, a timeframe switch, a chart-style switch and a mobile ticket, with no
console errors and no horizontal overflow. Playback is a 250 ms timer that
advances `speed × 0.5` bars per tick, so a 1× replay reveals two 5-minute bars
per second; the store clamps `stepBars` to 1..10000 and stops at the tape end.

There is no wall-clock dependency: the replay clock is the only clock the
engine, risk rules and order scheduling read, which is why the same action
script reproduces the same account state (see `tests/unit/sim-replay.spec.ts`).

## Limits

- These numbers are local production builds on one machine, not a CI gate.
- IndexedDB checkpoint writes are asynchronous and not part of the measured
  interaction path; a slow disk can delay the saved snapshot, never the fill.
- Historical replay only. Nothing here claims live-market latency.
