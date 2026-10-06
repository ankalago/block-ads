# Chrome ad blocker (MV3) — feature tasks

Status document for ODD. One row per task; commit SHAs are the evidence that a task
actually closed. Branch: `feat/chrome-adblocker`.

## Scope

MVP: a Chrome MV3 extension that blocks ads, focused on YouTube. News sites deferred.
Three layers for YouTube: network blocking (declarativeNetRequest), InnerTube
scriptlets (MAIN world, prune ad keys from player/next JSON), cosmetic CSS.

Non-goals for MVP: filter-list subscription/updating, Edge/Firefox builds, custom
scriptlet engine beyond what YouTube needs, UI options beyond enable/disable.

## Tasks

| # | Task | Status | Commit |
|---|---|---|---|
| 1 | Recon YouTube: ad endpoints, InnerTube player keys, DNR limits | done | research, no artifact |
| 2 | Scaffold: git, pnpm workspace, turbo, strict tsconfig, Biome, Vitest, Lefthook, commitlint | done | 89d320c |
| 3 | core: rule IR + parser for the ABP filter subset | done | 0527501 |
| 4 | core: compiler IR -> DNR ruleset, enforcing Chrome limits | pending | — |
| 5 | apps/block-ads: MV3 manifest, service worker, popup, esbuild pipeline | pending | — |
| 6 | YouTube rules: network (DNR) + cosmetic, verified in real DOM | pending | — |
| 7 | Load unpacked in Chrome and verify a real ad video is blocked | pending | — |

## Decisions

- **Monorepo**: `apps/*` holds extensions, `packages/*` holds shared logic. The repo is a
  hub for several extensions (ad blocker now, translations later), so shared code must not
  live inside one app.
- **Packages**: `@block-ads/core` (pure domain: filter IR, parser, DNR compiler, no Chrome
  APIs) and `@block-ads/rules` (rule data). The extension is `apps/block-ads`.
- **InnerTube patching**: inject in MAIN world, intercept fetch/XHR, delete `adPlacements`,
  `adSlots`, `playerAds` from `/youtubei/v1/player` and `/next`.
- **Playback safety**: never delete `adBreakHeartbeatParams` — removing it leaves the player
  in an unplayable state. Conservative pruning only.
- **DNR limits**: 30,000 static rules guaranteed, 1,000 regex rules, RE2 engine only (no
  backreferences, no lookahead). The compiler must validate against these.

## Notes for the next session

Task 3 landed: `@block-ads/core` has the filter IR (`src/rules.ts`) and a pure parser
(`src/parser.ts`, `parseFilterLine` / `parseFilterList`) with 90 Vitest tests. Design
history and the closed semantics are in `odd/specs/filter-ir.md` (rondas 2 and 3 were
corrections that removed over-blocking traps: `popup` no longer maps to `document`, scriptlet
exceptions are preserved, procedural cosmetics no longer leak into the network path).

Task 4 (DNR compiler) consumes the IR and never re-reads filter text. It must validate
against Chrome limits: 30,000 static rules, 1,000 regex rules, RE2 only (no lookahead, no
backreferences), and `urlFilter` length/anchoring rules. Filters the parser marked
`unsupported` stay visible in the build report instead of being dropped silently.

Run `pnpm check:ci` before considering anything done. `pnpm install` needs
`pnpm approve-builds --all` once in a fresh clone (pnpm 12 blocks esbuild/lefthook builds).
