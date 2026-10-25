# Terminal accounts

## Scope and data model

The replay terminal supports independent simulated 25K, 50K and 100K accounts. These are generic evaluation examples, not brokerage accounts or certified prop-firm rules. Each account is one pinned replay run: starting capital, rules, market tapes, replay cursor, orders, positions, fills, trades and risk ledger stay together. Existing run IDs and checkpoints remain unchanged. New attempts and rule-template changes create another account; they never reset an existing breached account.

Persist small account summaries alongside the existing IndexedDB `propdesk-replay-v1` records. Migrate legacy run/checkpoint pairs once, preserving their full history and active ID. List operations must not load every tape or export every ledger. Saving a checkpoint updates its summary in the same transaction, without changing the active account. Saving a deleted account must fail rather than recreate it.

Switching pauses playback, blocks trading during the transition, waits for all writes, validates the destination checkpoint, then changes the active pointer and installs the session. Saving retries hold the same transition lock, including while waiting for an older drain; switching cannot overtake a retry and abandon unsaved progress. A failed save blocks switching or creation. Confirmed deletion still settles all writers, but is allowed after a save failure: deleting an inactive account can free storage while keeping the current unsaved session and its warning intact; deleting the active account intentionally discards it. Deleting an active account clears the active selection; deleting the last account leaves an intentional empty state, also after reload. Deletion is explicit and irreversible, with confirmation. Renaming changes metadata only.

## UI design

Keep the existing Quiet Terminal palette, typography and chart priority. Add a compact account selector above the account metrics: account name, starting size, and a textual status badge are the primary context before placing orders. Management opens an existing accessible dialog, not a new page or dashboard.

The dialog presents a stable list of saved accounts with name, starting size, balance, equity and status. It supports switch, rename and confirmed delete. The creation form offers 25K / 50K / 100K and a name (1–60 trimmed characters). On a 390px viewport cards stack and the dialog scrolls; on desktop the list stays compact. All surfaces reuse theme tokens; breached status uses both a red badge and text, not color alone.

`breached` means a failed/blown account; `daily-lock` is a temporary daily lock and must not be labelled blown. Breached accounts remain selectable for history inspection and cannot resume trading by switching away and back. `target` is a completed target, and `active` is tradable subject to session/freshness rules.

## Boundaries and verification

Storage is local to this browser and origin, not cloud sync; clearing browser site data removes it. Account replay is intended for one terminal tab at a time; simultaneous editing of the same account in multiple tabs is not coordinated. No real money or live brokerage connection is introduced. Display preferences remain shared; account financial data and replay clocks are independent. No reset, history pruning or delayed risk calculation is used for performance.

Verify repository atomicity/migration/identity/isolation, account create/switch/delete/rename, save-failure guards, status persistence, empty-state reload, chart/ticket clearing on switch, keyboard/dialog behavior, three locales and light/dark/mobile layouts. Keep the existing trading, persistence, performance and exam regression suites green.

### Acceptance results

The multi-account implementation passed the following checks against a local production build:

- `bun run format:check`, `bun run typecheck` and `bun run build`.
- `bun run test`: **956 tests in 46 files**. Regression coverage includes save-retry/transition races, deletion after a quota failure, snapshot isolation and restoring an initial final-session candle without inventing a session close.
- `bun run check:accounts`: **63 browser checks** covering independent 25K/50K/100K accounts, exact state/clock restoration, rename/delete, persistent blown status, atomic legacy migration and intentionally empty catalogs. The 390×844 mobile checks assert a single dialog/title, 16px margins, reachable deletion and creation controls, one selected size, and reload/reopen behavior.
- `bun run check:terminal`: **65 browser checks**; smoke, theme, WASM loading, exam analysis and execution-marker checks also passed.
- English, Simplified Chinese and Japanese have **1,241 matching locale keys** each. The account dialog reuses existing light/dark tokens and keyboard/focus behavior.

The existing responsiveness harness also passed after adding accounts (Apple M5 Pro, headless Chrome 155, 1440×1000, DPR 2, local production server, deterministic synthetic data). Fresh-context cold-open P95 was **202.6 ms** over 30 samples. Each ordinary hot scenario had 30 samples: single pane TA off **30.3 ms**, three panes TA off **29.9 ms**, single pane TA on **30.3 ms**. With 1,000 completed round trips and 16 working orders, three-pane TA-off/on P95 was **30.1/30.0 ms**; the separate single-observation checkpoint flush and restore-to-draw timings were **22.2/122.3 ms**. The worst measured chart callback, including the single TA-on toolbar transition, was **5.3 ms**.

These measure programmatic DOM input through the following chart RAF, not physical input, browser paint or account-switch latency. Hot samples exclude asynchronous checkpoint draining, which is measured separately. This is a regression check, not a new before/after speedup claim or a guarantee for every machine. Reproduce with a production preview on port 4173:

```bash
BASE_URL=http://127.0.0.1:4173 bun run check:accounts
BASE_URL=http://127.0.0.1:4173 PERF_STRESS=1 bun run bench:terminal --check
```

The exact raw benchmark JSON is retained as [`../perf/terminal-accounts.json.gz`](../perf/terminal-accounts.json.gz), compressed without altering its contents. It records the worktree based on `8811eba` plus per-file source, build and harness hashes; these were unchanged throughout measurement and matched the final application tree. Source manifest SHA-256: `c4e75dcbfbe40310bae76971514803fbca65090efab0ab6bbfca62ab3332a8fd`. Decompressed JSON: 1,373,731 bytes, SHA-256 `dde52041d541a4af51c0a94ec0c2b7937917b7b9cc548804f2ef915578b298da`.
