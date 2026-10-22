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

| File                                           | Type                  | Purpose                                                                                                                      | Lines                   |
| ---------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `scripts/bench-ui.mjs`                         | New standalone runner | Cold context loads; event-to-frame latency; RAF drawing CPU; long tasks; resource transfer; explicit budgets                 | 1–288                   |
| `scripts/bench-compute.ts`                     | New standalone runner | Public WASM wrapper, validation, rebased window, and repository preparation timings                                          | 1–112                   |
| `scripts/check-wasm-load.mjs`                  | Strengthened guard    | Hold the actual WASM download, step the trainer, verify real analysis report, enforce one request on navigation/direct entry | 1–92                    |
| `package.json`                                 | Commands              | `bench:ui`, `bench:compute`                                                                                                  | 28–29                   |
| `.gitignore`                                   | Output exclusion      | Ignore raw local profiling output                                                                                            | `profile_output/` entry |
| `docs/perf/{baseline,after}-{ui,compute}.json` | Saved evidence        | Raw samples, environment and summaries from selected serial runs                                                             | Whole files             |
| `docs/perf/response.md`                        | New report            | Plan, budgets, measurement boundaries, before/after and limitations                                                          | Whole file              |

No application instrumentation is inserted. Local diagnostic scripts and intermediate results remain ignored under
`profile_output/`; they are not shipped. The two benchmark scripts and their package commands can be removed when
profiling is no longer needed; keep the functional WASM load guard. Run timing benchmarks serially, not alongside
builds/tests, to avoid measuring test-runner CPU contention.

## Baseline

Baseline application commit: `612df3016948c85eb4d9e1afee690c3967acdfa0`. Measurements dated 2026-10-22 UTC (2026-10-23 local). Selected raw data: `baseline-ui.json`, `baseline-compute.json`.

The expensive-looking Rust operations are not the bottleneck: complete WASM calls are below 1 ms P95; a 710-bar rebased data window is approximately 0.09 ms P95. Hot interactions already fit the 50 ms budget under the corrected measuring method. Trainer cold entry P95 is 788.9 ms (synthetic) / 729.9 ms (local), compared with analysis 111.6 / 127.7 ms: investigate the trainer's explicit 600 ms wait before touching the compute ABI. Analysis readiness now requires a non-null report, an enabled next-bar control, and a chart draw with that report; a heading alone is insufficient. Baseline normal-speed chart drawing is below 2 ms P95. An earlier 4× CPU slowdown diagnostic put cold trainer entry above one second; it is diagnostic only and not used for the final before/after comparison.

## Final measurements

Final application commit: `ae2c13050bd34368f2f690da5d29f4306aff4cf7`. The saved runs are
`after-ui.json` and `after-compute.json`, captured serially on the same machine and production server setup.
The UI run uses 40 samples per hot action (12 for ten-bar bursts) and 10 fresh-context loads per source/route;
compute uses 200 samples following 20 warmups. Both `--check` commands passed. These are local measurements, not an internet latency SLA.

### Cold functional readiness

Times are milliseconds. Analysis readiness includes a real report and its chart draw, not just a heading.

| Source     | Route    | Before P50 | Before P95 | After P50 | After P95 |
| ---------- | -------- | ---------: | ---------: | --------: | --------: |
| Synthetic  | Trainer  |      719.0 |      788.9 |      94.6 |     169.0 |
| Local pack | Trainer  |      718.1 |      729.9 |     115.8 |     124.2 |
| Synthetic  | Analysis |      106.3 |      111.6 |      90.7 |     112.1 |
| Local pack | Analysis |      121.0 |      127.7 |     110.3 |     117.8 |

The clear improvement is trainer startup: P95 decreased by approximately **79% / 83%** for synthetic / local data.
Removing the fixed `sleep(600)` explains most of this improvement. Analysis was already fast; its small differences
are not evidence of a significant speedup.

### Hot response and chart work

The numbers below include the next-frame observation boundary. At 60 Hz, one or two frame intervals dominate
these measurements; they must not be presented as CPU computation time.

| Action                        | Synthetic P95 before → after | Local P95 before → after |
| ----------------------------- | ---------------------------: | -----------------------: |
| Trainer pointer               |               34.0 → 34.6 ms |           34.1 → 35.0 ms |
| Trainer single bar            |               18.2 → 18.9 ms |           17.9 → 18.6 ms |
| Trainer ten-bar burst         |               33.8 → 35.1 ms |           34.2 → 35.3 ms |
| Analysis pointer              |               33.9 → 34.8 ms |           33.9 → 34.7 ms |
| Analysis single bar           |               17.8 → 18.8 ms |           17.9 → 18.6 ms |
| Analysis cached new sample    |               34.2 → 34.9 ms |           33.8 → 35.3 ms |
| Analysis pointer after reveal |               33.7 → 34.8 ms |           33.7 → 34.6 ms |

All measured hot actions remain below the **50 ms P95** budget; there is no measured end-to-end hot-path speedup
in this run. The optimizations remove unnecessary work and fix synchronization, rather than eliminating the browser's
frame cadence. Chart callback CPU P95 is **0.4–1.3 ms**, below the **16.7 ms** budget. No ≥50 ms long tasks were
recorded in the four measured hot windows; this does not claim the app never produces a long task.

### Complete compute calls

Times are milliseconds. These are the public wrappers including their JS/JSON boundary, not export-only timings.

| Operation                 | Before P50 | Before P95 | After P50 | After P95 |
| ------------------------- | ---------: | ---------: | --------: | --------: |
| WASM generate             |      0.514 |      0.572 |     0.528 |     0.764 |
| WASM analyze              |      0.535 |      0.794 |     0.523 |     0.661 |
| WASM simulate             |      0.221 |      0.253 |     0.214 |     0.236 |
| TypeScript generate       |      0.148 |      0.162 |     0.145 |     0.160 |
| Local pack validation     |      0.176 |      0.254 |     0.176 |     0.227 |
| Local 710-bar window      |      0.066 |      0.085 |     0.064 |     0.075 |
| Cached repository prepare |      0.001 |      0.013 |     0.002 |     0.007 |

The final first repository preparation took **12.66 ms** including localhost fetch/JSON parsing. It is a single
cold observation, not a P95 or a WAN download benchmark. The three WASM operations and cached window pass the
**10 ms P95** budget comfortably. Small sub-millisecond differences, including slower generate P95, do not justify
claims of universal improvement or a Worker/binary-ABI rewrite.

## Implemented changes and correctness guards

- **`f1eaebb`, local packs:** validated datasets remain cached; refresh/clear uses per-base generations so stale
  requests cannot overwrite newer entries; concurrent requests coalesce; failures expire after 30 seconds.
  Timeframes and integer timestamps are checked, exactly 710 bars is sufficient, and unsuitable candidates fall
  back safely. Rebasing uses only the warm-up, not hidden future lows. Successful caches are not size-bounded.
- **`fc42b1d`, WASM:** retain explicit timestamps for irregular bars instead of manufacturing continuous sessions.
  Regular tapes keep the compact encoding. Six timestamp cases plus three Rust tests cover gap/length handling;
  the artifact version is verified against the actual bytes.
- **`5fdc442`, chart:** reuse the number formatter and avoid temporary bounds/volume arrays; skip unchanged
  overlays. Invalidate geometry before hit testing and synchronize live options. Correct the animation target and
  visible-range shrink behavior. Keep the existing single canvas and RAF coalescing; no speculative layer rewrite.
- **`0eaac4e`, stores/UI:** remove the 600 ms wait, use shallow/raw immutable scenarios, reuse visible-prefix swings,
  skip thesis-only/no-op validation, stabilize overlay/log row identities, and reject stale asynchronous starts.
  Regression tests also protect decision-time grading, broker marks after waiting, session accounting and
  generated daily/PK samples.
- **`0369f67`, motion:** number ticking honors both app and OS reduced-motion settings.
- **`ae2c130`, loading:** preload only direct SSR analysis visits. The functional guard holds the actual WASM
  download, proves trainer stepping still works, then verifies a real analysis report and a single core request
  across client navigation; a separate direct-entry check preserves the SSR preload.

## Verification and remaining limits

- **238 tests across 21 files** passed, including local-cache races, timestamp parity, store response invariants,
  chart behavior and artifact budgets; **3 Rust tests** passed.
- Typecheck, production build, production smoke, and theme audit passed. Theme auditing samples `/`, `/trainer`,
  `/analysis` and `/settings` in both modes; it is not an exhaustive accessibility certification.
- Timing checks passed with both synthetic and the installed local pack. The local timing fixture uses **MNQ**,
  not a performance claim for every contract or arbitrary imported dataset. Browser seeds are normally generated,
  not identical fixed tapes across runs; exact raw samples and environment are retained.
- The measured workload is 710 bars. A full symbol JSON file is still fetched and validated on first use; no
  streaming format, worker or size-based cache eviction was introduced. Larger packs and slow/mobile devices
  require separate measurements. Negative caches recover after 30 seconds or explicit refresh.
- Blindness is presentation, not access control: full tapes are in browser memory. Additive rebasing does not
  preserve percentage returns and can yield negative future prices rather than inspect/clip hidden values.
  See `../data/market-data.md` for provenance, deployment and timestamp limitations.
- No vendor data is committed. Installed `public/data/market/` packs are copied into a local production build;
  do not publish that output without checking data rights. Fresh-context tests do not clear OS/server caches,
  and neither localhost results nor a browser rendering proxy establish network or hardware input-to-photon SLAs.
