# Response-time optimization plan and measurements

## Scope and acceptance

The target is reproducible millisecond-scale **functional response**, not a claim that downloads on arbitrary networks take 1 ms. Preserve blind replay, dataset validation and tick rebasing, deterministic rounds, trading semantics, accessible themes, and the TypeScript fallback. Retain motion, but do not delay functionality to make a loading animation visible.

| Metric                                                                             | Budget         |
| ---------------------------------------------------------------------------------- | -------------- |
| Hot replay step, ten-bar burst, chart pointer, analysis step, cached sample change | P95 ≤ 50 ms    |
| Chart drawing CPU work                                                             | P95 ≤ 16.7 ms  |
| WASM public wrappers, 710 bars (including serialization and decoding)              | P95 ≤ 10 ms    |
| Cached local window preparation                                                    | P95 ≤ 10 ms    |
| Cold trainer / analysis usable, production localhost                               | P95 ≤ 1,000 ms |

1. Establish production browser and compute baselines with raw samples.
2. Optimize only measured data / computation hotspots; keep already-fast paths simple.
3. Remove avoidable waiting and repeated UI work; preserve chart behavior.
4. Re-measure, add structural regression guards, run the complete quality suite, commit each logical change.

## Reproduction

```sh
bun run build
PORT=4173 HOST=127.0.0.1 node .output/server/index.mjs
# Another terminal; local packs must have been fetched with bun run data:fetch.
bun run bench:compute
bun run bench:ui
PERF_CPU_RATE=4 PERF_OUTPUT=profile_output/ui-4x.json bun run bench:ui
bun run bench:compute --check
bun run bench:ui --check
```

Environment overrides: `BASE_URL`, `PERF_OUTPUT`, `PERF_SAMPLES` (compute: 200; UI: 40), `PERF_COLD_SAMPLES` (10), `PERF_CPU_RATE` (1), `PERF_SOURCES` (`synthetic,local`). Missing local data fails rather than silently benchmarking synthetic fallback. `profile_output/` is gitignored; selected evidence is retained beside this document.

### Measurement boundaries

- Production Nitro server; Chrome 155.0.8059.85, Apple M5 Pro / 24 GiB, macOS arm64; 1440×1000 viewport, DPR 2, full motion enabled. Fresh browser contexts isolate HTTP/storage caches for each cold navigation; browser process and OS caches are not reset.
- Browser probes wrap animation-frame callbacks externally. Chart CPU is callback duration when a connected canvas clears. It includes JS canvas command submission, **not GPU raster completion**. No test instrumentation is shipped with the app.
- Hot latency starts at DOM event dispatch and ends in the frame after a canvas draw that observes the changed state. This includes state updates, Vue flushing and frame scheduling, but not OS input delivery. A 60 Hz display adds frame-sized steps to these readings. It is a rendering proxy, not a hardware input-to-photon measurement.
- Samples do not include the decorative 200 ms candle animation's completion. The new bar/price must be functionally present first. Entry transitions and idle warm-up are allowed to finish before hot runs; cold runs include them as applicable.
- First attempt used a polling RAF followed by another RAF; that added an unnecessary frame to asynchronous sample changes. The corrected probe records presentation from the actual drawing RAF, and both before/after comparisons use that same probe. Trainer ten-bar bursts dispatch ten real `N` key events and assert exactly ten bars advanced (Shift+N is not an existing shortcut).
- Compute uses public domain wrappers, not just the raw WASM export: input packing, JSON encoding, memory copying, execution, output decoding and parsing are all included. 20 warmups precede 200 iterations. Validation is reported separately from JSON parsing; network and first local fetch are separate from cached work.

## Instrumentation changelog

| File                       | Type                  | Purpose                                                                                                      |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `scripts/bench-ui.mjs`     | New standalone runner | Cold context loads; event-to-frame latency; RAF drawing CPU; long tasks; resource transfer; explicit budgets |
| `scripts/bench-compute.ts` | New standalone runner | Public WASM wrapper, validation, rebased window, and repository preparation timings                          |
| `package.json`             | Commands              | `bench:ui`, `bench:compute`                                                                                  |
| `.gitignore`               | Output exclusion      | Ignore raw local profiling output                                                                            |

No application instrumentation is inserted. Remove the two scripts and their package commands if profiling is no longer needed.

## Baseline

Baseline application commit: `612df3016948c85eb4d9e1afee690c3967acdfa0`. Measurements dated 2026-10-22 UTC (2026-10-23 local). Selected raw data: `baseline-ui.json`, `baseline-compute.json`.

The expensive-looking Rust operations are not the bottleneck: complete WASM calls are below 1 ms P95; a 710-bar rebased data window is approximately 0.09 ms P95. Hot interactions already fit the 50 ms budget under the corrected measuring method. Trainer cold entry P95 is 788.9 ms (synthetic) / 729.9 ms (local), compared with analysis 111.6 / 127.7 ms: investigate the trainer's explicit 600 ms wait before touching the compute ABI. Analysis readiness now requires a non-null report, an enabled next-bar control, and a chart draw with that report; a heading alone is insufficient. Baseline normal-speed chart drawing is below 2 ms P95. An earlier 4× CPU slowdown diagnostic put cold trainer entry above one second; it is diagnostic only and not used for the final before/after comparison.

Further changes and their evidence are recorded after remeasurement; the baseline is not a claim of completed optimization.
