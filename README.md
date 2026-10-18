# Prop Desk

A blind-replay trading trainer for prop-firm instruments (MNQ, NQ, MES, ES, MYM, M2K, MGC, MCL, and crypto perps).

Prices, symbol, and date are hidden while candles print one at a time. You size the trade like a futures trader,
place bracketed orders, and manage risk against real prop-firm rules: profit target, trailing drawdown, daily loss limit.
The decision drill scores the part most traders skip — state, thesis, and a plan with structurally placed stop and target.

> **Simulated data.** All price series are deterministically generated from seeded regimes. No live market feed is
> used, and no statement in the app is financial advice.

## Stack

- Nuxt 4 · Vue 3 · TypeScript (strict)
- Tailwind CSS v4 with the Claude Design System (CDS) token port from [open-claude-ui](https://github.com/Caho1/open-claude-ui)
- Reka UI primitives in shadcn-style wrappers
- Pinia · `@nuxtjs/i18n` (English default, 简体中文, 日本語) · Vitest
- Custom canvas charting engine (no chart dependency)

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run test       # unit tests
npm run typecheck  # vue-tsc
npm run build      # production build
```

## Architecture

```
app/
  domain/        pure TypeScript business core (no Vue imports)
    instruments/ contract specs + registry factory
    market/      seeded PRNG, regime generator, scenario factory
    trading/     broker, account, orders, prop-firm rules
    drill/       plan validation + grading
    stats/       analytics aggregations
  components/    ui kit, layout shell, chart, feature panels
  stores/        Pinia orchestration (session lifecycle, settings, history)
  pages/         routes
i18n/locales/    en, zh-CN, ja
```

Design decisions and the visual spec live in [`docs/design/ui-spec.md`](docs/design/ui-spec.md).

## Disclaimer

Prop Desk is a training tool. Evaluations, payouts, and leaderboards shown in the demo are local and simulated.
