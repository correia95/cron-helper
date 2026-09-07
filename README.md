# cron-helper

Cron Expression Helper — paste a standard 5-field cron expression and get a
plain-English description plus the next seven run times in your local timezone.
Handles `*`, ranges, steps, lists and `JAN`/`SUN` names, and the day-of-month vs
day-of-week "either matches" rule. Entirely client-side; the expression is only
put in the page URL so it can be shared.

**Live:** https://cron-helper.correia95.workers.dev/

## Stack

- React 18 + TypeScript + Vite, no runtime deps beyond React
- Static-assets Cloudflare Worker

## Engine

[`src/cron.ts`](src/cron.ts):

- `parseCron(expr)` → per-field `{ values, raw, all }`, with clear per-field errors.
- `nextRuns(cron, from, n)` — minute-stepping search with month/day fast-forwards;
  applies the POSIX rule that a restricted dom **and** dow means "run when either
  matches".
- `describe(cron)` — builds a readable sentence, detecting `*/n` steps, contiguous
  ranges, weekdays/weekends and hour windows.

Not supported: `@macros`, a seconds field, and the Quartz `L` / `W` / `#`
characters (documented in the page).

## Develop / deploy

```bash
npm install
npm run dev
npm run deploy
```
