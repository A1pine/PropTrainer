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

## Targets

| Target                          | Budget                                   |
| ------------------------------- | ---------------------------------------- |
| Hydration gating                | 0 ms — wasm must never block first paint |
| Artifact transfer               | ≤ 75 KiB brotli                          |
| `prop_analyze` response         | ≤ 25 KiB JSON                            |
| Analysis first open (warm core) | ≤ 50 ms end-to-end                       |
