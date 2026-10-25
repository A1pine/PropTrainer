# Terminal optimization raw evidence

These gzip files contain the **original JSON bytes** from the measurement runs,
including samples, environment/configuration, state checks and errors where recorded.
Nothing was filtered or resampled. They are compressed to keep the repository small;
`profile_output/` remains a disposable, gitignored workspace.

[`manifest.json`](manifest.json) records each filename, role, original byte length
and SHA-256 of the **decompressed** contents. There are 20 archives:

- **11 final serial runs**, referenced by role in
  [`terminal-optimization.json`](../terminal-optimization.json): five offline
  compute probes, baseline/optimized browser normal and stress pairs, and a second
  normal pair retained to check the initial cold-open variability.
- **Nine superseded exploratory artifacts**, retained for transparency but not
  used for the final comparison. Some early compute runs overlapped other jobs;
  those timings are not final evidence.

Both final compute baselines came from the untouched `7efe627` app tree, with
only the same standalone harness/helper copied into that worktree. The 10,000-step
scale artifact has no paired baseline and is a scale probe only.

The final browser harness ran from the main workspace against port 4173
(optimized) or 4174 (baseline). `PERF_APP_ROOT` identifies the server's checkout.
The artifacts include full source/harness/build file manifests before and after
each run, plus the hash of served entry assets checked against the build. Final
source fingerprints are `0ebd7b298f56…` (baseline) and `d566ccee9984…` (optimized).
All 11 final runs have `evidence.verified: true`; browser and compute harnesses
are each identical across their comparisons. A matching manifest does not prove
source-to-build correspondence by itself: the recorded workflow built the
respective checkout before serving it.

Read one final artifact without changing it:

```bash
gzip -dc docs/perf/terminal-optimization-raw/terminal-compute-baseline-serial.json.gz
```

Verify every archive (standard-library Python only):

```bash
python3 - <<'PY'
from pathlib import Path
import gzip, hashlib, json
root = Path('docs/perf/terminal-optimization-raw')
manifest = json.loads((root / 'manifest.json').read_text())
for item in manifest['artifacts']:
    raw = gzip.decompress((root / item['file']).read_bytes())
    assert len(raw) == item['bytes'], item['file']
    assert hashlib.sha256(raw).hexdigest() == item['sha256'], item['file']
    result = json.loads(raw)
    if not item['role'].startswith('superseded'):
        assert result['evidence']['verified'] is True, item['file']
        for key in ('source', 'harness', 'build'):
            before = result['evidence']['before'].get(key)
            after = result['evidence']['after'].get(key)
            assert (before or {}).get('sha256') == (after or {}).get('sha256'), item['file']
print('All raw evidence archives verified.')
PY
```

The [comparison report](../terminal-optimization.md) explains measurement
boundaries, serial run order, cold-open variability, and unmeasured cases. The
first optimized normal run had a worse cold P95; it is included, not replaced by
the faster confirmation run. This evidence does not establish a hosted SLA,
physical input latency or statistical significance.
