# prop_core

Rust/WebAssembly compute core for Prop Desk. The module has no wasm-bindgen dependency: it exposes a tiny C ABI
over JSON so the server (sync `WebAssembly.Module`) and the browser (async `WebAssembly.instantiate`) can load
exactly the same bytes.

## Exports

| Export | Input JSON | Output JSON |
| --- | --- | --- |
| `prop_generate` | `{ seed, anchorPrice, volatility, tickSize, regime, bars, startPrice, startTime, timeframeMinutes, replayStart, baseVolume }` | `{ candles, metrics }` |
| `prop_find_swings` | `{ candles, strength }` | `{ swings }` |
| `prop_simulate_plan` | `{ plan, candles, instrument, horizonBars }` | plan outcome |
| `prop_alloc` / `prop_dealloc` | request buffer | — |
| `prop_result_ptr` / `prop_result_len` | — | last JSON result |

Memory contract: allocate a request buffer, copy UTF-8 JSON, call a function, read the result buffer, then free
the request. The module is single-threaded and keeps one reusable result buffer.

## Build

```bash
rustup target add wasm32-unknown-unknown
bun run wasm:build
```

The script writes `public/wasm/prop_core.wasm`, which is committed so the app runs without Rust.

## Parity

`tests/unit/wasm.spec.ts` runs generation, swing detection and plan simulation through both the Rust core and the
TypeScript reference implementation and asserts deep equality. The algorithms intentionally mirror each other,
including the PRNG call order and conservative stop-first fills.

## Scope

Rust owns the O(n) batch paths. Broker state transitions, sizing, grading, formatting and canvas rendering stay in
TypeScript: they are O(1) or render-bound, and crossing the wasm boundary would add latency without reducing real
work.
