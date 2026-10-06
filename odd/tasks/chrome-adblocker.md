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
| 4 | core: compiler IR -> DNR ruleset, enforcing Chrome limits | done | 9ec85a8, b11ee24 |
| 5 | apps/block-ads: MV3 manifest, service worker, popup, esbuild pipeline | done | d02e526 |
| 6 | YouTube rules: network (DNR) + cosmetic, verified in real DOM | in progress | — |
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

## Task 5 close-out (d02e526)

The `gentle-ai-worker` run died with "assistant returned no final report" after writing ~950
lines. Nothing it produced counted as verified; the parent ran every check itself. Two defects
were found and fixed before commit:

1. `ruleset.ts` invented the `updateEnabledRulesets` payload (`enableRulesets`/`disableRulesets`).
   The real `UpdateRulesetOptions` (Chrome 87+, confirmed in `@types/chrome` 0.3.4) is
   `enableRulesetIds`/`disableRulesetIds`. `tsc` caught it because `@types/chrome` is installed —
   that dependency is what makes invented Chrome shapes fail loudly instead of at runtime.
2. The XHR wrapper computed the pruned payload for `responseType === "json"` and then only
   shadowed `responseText`, leaving `response` untouched — i.e. the patch silently blocked
   nothing on that path. Fixed by extracting the decision into `xhrShadows()` (pure, DOM-free)
   and covering it with 3 tests; binary `responseType` now reports "cannot prune" instead of
   pretending.

Verified by the parent: 35 extension tests + 145 core tests, `typecheck` clean, Biome clean,
`pnpm check:ci` exit 0, `build.mjs` exits 0 on the good fixture and 1 on the non-ASCII fixture
(proving the fail-closed ruleset gate), generated manifest carries `world: "MAIN"` +
`run_at: "document_start"`, and `dist/` contains 7 artifacts.

Still unproven, by design: everything that needs real Chrome (that the InnerTube prune actually
kills the pre-roll without breaking playback, and the in-player ad overlay selectors).

## Notes for the next session

Task 4 landed: `packages/core/src/dnr.ts` exposes `compileToDnrRules(filters)` →
`{ rules, report }`, pure and deterministic, 55 tests. Chrome facts (limits, `priority`
semantics, resource-type enum, `urlFilter` tokens) are cited in `odd/specs/dnr-compiler.md`.
Two invariants worth keeping: exceptions compile to `allow` + `priority: 2` so a whitelist
always beats our blocks, and any invalid rule sets `report.ok = false` so the build fails
instead of shipping a ruleset Chrome would silently trim.

Task 5 is the MV3 shell in `apps/block-ads`: manifest with `declarative_net_request.rule_resources`,
a service worker that owns the enabled rulesets, a popup toggle, and an esbuild pipeline that
emits `rules.json` from `@block-ads/rules` through the compiler. Chrome rejects a ruleset whose
rule ids collide or exceed the budget at load time, so the build must run the compiler and fail
on `report.ok === false`.

Task 3 landed: `@block-ads/core` has the filter IR (`src/rules.ts`) and a pure parser
(`src/parser.ts`, `parseFilterLine` / `parseFilterList`). Design history and the closed
semantics are in `odd/specs/filter-ir.md` (rondas 2 and 3 removed over-blocking traps:
`popup` no longer maps to `document`, scriptlet exceptions are preserved, procedural
cosmetics no longer leak into the network path).

Run `pnpm check:ci` before considering anything done. `pnpm install` needs
`pnpm approve-builds --all` once in a fresh clone (pnpm 12 blocks esbuild/lefthook builds).
