# Market data packs

Prop Desk trains on **simulated tape by default**. You can optionally practice on real
5-minute futures bars from a local pack. The pack is gitignored and safe to delete at any
time. When the app is built or deployed, Nitro copies `public/` (including any installed
pack) into the served output, so treat a deployed instance as serving those bars to its
visitors. Keep the pack on machines where that is acceptable, or strip
`public/data/market/` from a deployment artifact.

## Fetch

```bash
bun run data:fetch
# or target a subset
bun run data:fetch --symbols MNQ,MES --range 60d --interval 5m
```

The script writes:

```
public/data/market/manifest.json
public/data/market/MNQ.json
public/data/market/MES.json
...
```

Both are gitignored. A fresh clone has no pack, and that is a supported state: the app
reports “Not installed” and falls back to simulated bars.

Provider: Yahoo Finance’s undocumented chart endpoint, symbol `<ROOT>=F`
(`MNQ=F`, `MES=F`, …). It is free but unofficial and rate-limited. **Do not commit,
redistribute or resell the downloaded bars.** Use them for local evaluation only.

## Schema

Column-oriented JSON, one file per instrument:

```json
{
  "symbol": "MNQ",
  "source": "yahoo",
  "sourceSymbol": "MNQ=F",
  "timeframe": "5m",
  "timezone": "UTC",
  "license": "Yahoo Finance (unofficial) — local evaluation only, do not redistribute",
  "fetchedAt": "2026-10-20T04:12:00.000Z",
  "bars": 13548,
  "t": [1786...],
  "o": [29870.25],
  "h": [29880.0],
  "l": [29860.5],
  "c": [29875.25],
  "v": [412]
}
```

- `t` is the bar open time in integer Unix **seconds**, strictly increasing. Fractional
  values are rejected rather than rounded, because rounding `[1000.1, 1000.2]` would
  create two bars at the same second.
- `timeframe` must be one of `1m`, `5m`, `1h`, `4h`, `1d`, … (a positive integer followed
  by `s`, `m`, `h`, `d` or `w`). The default rounds require `5m`; another timeframe must
  be explicitly requested. A mismatch is rejected rather than relabelled, and the
  direct dataset scenario builder uses the pack’s timeframe when none is requested.
- `o/h/l/c` are in the contract’s native price grid.
- The loader rejects any file where arrays disagree, a timestamp repeats, a price is
  non-finite or non-positive, or `high < max(open, close)` / `low > min(open, close)`.
  A corrupt pack degrades to synthetic tape instead of poisoning the charts.

## How a round uses a pack

- `150` warm-up bars → the replay starts.
- `260` hidden bars → the round resolves.
- `300` reveal bars → context after the decision.

That is `710` bars per sample, and a pack with exactly `710` bars is usable (the only
valid window starts at 0). The fetched 60-day 5m pack holds ~13.5k bars per instrument,
so there are thousands of windows. Selection is seeded: the same seed, instrument
universe, pack contents and window policy produce the same slice. Refreshing a pack can
change what a replay link selects; the seed alone does not identify the downloaded data.
Manifest candidates are filtered for length and timeframe, then each loaded dataset is
checked again. A short, corrupt, or mismatched candidate is skipped for the next seeded
candidate; if none is usable, the round falls back to simulated tape instead of failing.

Blind presentation uses two boundaries; it is not an anti-cheat security boundary:

1. **Price rebasing.** The whole window is shifted by one tick-aligned constant so the
   first close sits near the instrument’s anchor level (for example ~19,450 for MNQ).
   The offset is chosen from the first candle and the visible warm-up only; it never
   scans the hidden future. For already tick-aligned prices, point deltas, ranges and
   ATR are preserved; all input prices are rounded to the instrument’s tick grid.
   Percentage returns are **not** invariant under an additive shift, so metrics are
   computed after rebasing. If the hidden tape falls further than the visible warm-up,
   translated prices can go below zero. Those bars are not clipped, because clipping
   would distort the moves; choosing an offset from their minimum would reintroduce
   look-ahead. Reveal shows the rebased chart, not restored absolute prices. The
   grader and broker treat a finite nonpositive price as a real quote (front-month
   crude settled below zero in 2020); they do not clamp it or reject the order.
2. **Visible-prefix rendering and analysis.** The full scenario is already in browser
   memory and passed to the chart with a `visibleCount` limit, initially the warm-up
   length. Rendering and plan validation use the visible prefix; the analysis lab sends
   only its visible slice to WASM. At submission/review, simulation walks future bars to
   score the plan. A user inspecting JavaScript state or downloaded JSON can see future
   bars and provenance; this is a local practice tool, not a secure competition server.

The local regime label (`uptrend`, `downtrend`, `range`, `expansion`) is **derived** from
the full window’s efficiency ratio and net change. It is a retrospective description,
not a prediction; full-window metrics must not be used as pre-decision signals.

## Settings

`Settings → Market data → Sample source`:

| Source     | Used by                                               |
| ---------- | ----------------------------------------------------- |
| Simulated  | Everything (default; fully offline and deterministic) |
| Local pack | Trainer, drill and analysis                           |

Daily challenge and PK always stay on generated tape so their baselines remain
reproducible across devices. If the pack is missing when a local round starts, the round
runs on simulated bars and the trainer shows a `Fallback` badge plus a one-time toast.

## Caching and refresh

Manifests and datasets are cached per normalized base URL (the dev server and a deployed
origin are separate caches). Successful loads stay cached until an explicit refresh.

- Refreshing from Settings forces the manifest and drops that base’s datasets too, so a
  newly generated pack is visible without a reload.
- Each base has a generation counter. An in-flight request that started before a refresh
  or clear may still resolve for its caller, but it cannot write its result back into the
  cache.
- Identical concurrent loads within one generation share one request. Each forced
  refresh starts a new generation.
- Missing or corrupt packs are cached for `30 s` (`LOCAL_NEGATIVE_CACHE_TTL_MS`) so a
  fallback round does not hammer a 404, then retried on the next round.

## Limitations

- Yahoo's root futures symbols do not identify an immutable expiry-specific tape or a
  documented roll-adjustment policy. Roll/session gaps are retained, not filtered.
- The downloader requests 60 days of 5-minute history by default. Availability and
  intraday retention limits are provider-controlled and can change. There is no tick or
  bid/ask data, so the order-flow panel remains an OHLCV proxy.
- Timestamps are integer Unix seconds. The chart axis and analysis sample date use UTC;
  some history/review dates use the browser’s local timezone. There is no universal
  `America/New_York` display policy.
- Futures volume from Yahoo is indicative, not exchange-certified.
- A fetched pack is served by the app. There is no service worker promising offline
  availability after a reload, and successful in-memory caches have no size-based eviction.

For longer history, Dukascopy offers index/commodity proxies, **not native CME futures**.
An exchange-data vendor such as Databento requires its own access and licensing checks.
Convert permitted data to this schema and keep vendor files out of git.

## Checks

```bash
bun run test                 # dataset parser, window selection, rebasing
bun run smoke                # end-to-end flow
bun run data:fetch           # refresh the pack
```
