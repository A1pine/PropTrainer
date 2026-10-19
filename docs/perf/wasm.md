# WASM performance log

All numbers come from `bun run bench:wasm` on an Apple silicon laptop (Node/Bun JIT, single thread).
Re-run after any change to `wasm/` or to the load path.

## Baseline — 246 KiB artifact

| Metric                                 | Value                       |
| -------------------------------------- | --------------------------- |
| Raw artifact                           | 246.0 KiB                   |
| gzip -9                                | 89.8 KiB                    |
| brotli -11                             | 73.1 KiB (3.36× smaller)    |
| `WebAssembly.compile`                  | 0.46 ms (median of 7)       |
| `instantiate`                          | 0.08 ms                     |
| `prop_generate` (710 bars)             | 0.56 ms · 68.5 KiB JSON out |
| `prop_analyze` (710 bars)              | 0.62 ms · 90.9 KiB JSON out |
| `prop_simulate_plan` (300-bar horizon) | 0.15 ms                     |

### Where the bytes go

Compilation and execution are already sub-millisecond; the cost that users feel is **transfer + parse**, not compute.

| Response                                                      | Bytes    | Share |
| ------------------------------------------------------------- | -------- | ----- |
| `indicators` (12 series × 710 values, 15+ significant digits) | 77.8 KiB | 84%   |
| `flow.delta`                                                  | 6.9 KiB  | 7%    |
| `events`, `ict`, `trend`, `pa`, `bias`                        | 6.4 KiB  | 7%    |

Two problems were visible immediately:

1. The client plugin blocked hydration on a 246 KiB fetch, so first paint waited on the network.
2. Indicator series were serialized at full float precision (`20416.795217751063`), roughly 3× larger than the
   precision the chart can actually draw.

## After: `opt-level = "z"`, fat LTO, `wasm-opt -Oz`

| Metric                | Baseline  | Now       | Change   |
| --------------------- | --------- | --------- | -------- |
| Raw artifact          | 246.0 KiB | 144.8 KiB | −41%     |
| gzip -9               | 89.8 KiB  | 64.4 KiB  | −28%     |
| brotli -11            | 73.1 KiB  | 55.0 KiB  | −25%     |
| `WebAssembly.compile` | 0.46 ms   | 0.36 ms   | −22%     |
| `prop_generate`       | 0.56 ms   | 0.72 ms   | +0.16 ms |
| `prop_analyze`        | 0.62 ms   | 0.92 ms   | +0.3 ms  |
| `prop_simulate_plan`  | 0.15 ms   | 0.18 ms   | +0.03 ms |

Size-optimized code is slightly slower per call, but every operation is still **under 1 ms** while the download
dropped by 18 KiB brotli. Network dominates: 1 ms of compute is not worth 41% more bytes on a mobile connection.
If a future workload becomes compute-bound, switch the profile back to `opt-level = 3`; the benchmark makes that
trade-off measurable instead of guessed.

## Payload trim

The analysis report previously shipped 12 indicator series at 4-decimal precision. Only four are drawn (EMA 20/50/200,
VWAP) plus the Bollinger pair; RSI/MACD/ATR/ADX were duplicated in `latest` and never plotted. Removing the unused
series and rounding the drawn ones to the instrument's price precision cut the response from **90.9 KiB to 50.6 KiB**
(−44%) with no visual change. `flow.delta` is rounded to whole contracts.

## Column-oriented input

`prop_analyze` used to accept `{ candles: [{ time, open, high, low, close, volume }, …] }`, repeating six keys per bar.
It now accepts five numeric columns plus `startTime`, `step` and `precision`. For 710 bars the request drops from
**67.2 KiB to 22.4 KiB** (−67%); the module grows 3.6 KiB because it reconstructs the candle structs itself.

| Request shape | Bytes (710 bars) |
| ------------- | ---------------- |
| Keyed objects | 67,175           |
| Columns       | 22,437           |

## Transport

`nitro.compressPublicAssets` emits `.br` and `.gz` next to the artifact at build time, and `/wasm/**` is served with
`cache-control: public, max-age=31536000, immutable` (the URL carries the content hash). Verified with curl:

```
Content-Encoding: br
Content-Length: 56539        # 55.2 KiB instead of 145.2 KiB
cache-control: public, max-age=31536000, immutable
content-type: application/wasm
```

## Targets

| Target                          | Budget                                   |
| ------------------------------- | ---------------------------------------- |
| Hydration gating                | 0 ms — wasm must never block first paint |
| Artifact transfer               | ≤ 75 KiB brotli                          |
| `prop_analyze` response         | ≤ 25 KiB JSON                            |
| Analysis first open (warm core) | ≤ 50 ms end-to-end                       |
