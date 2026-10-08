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
| 6 | YouTube rules: network (DNR) + cosmetic, verified in real DOM | done | 845fd74, 14c8e07 |
| 7 | Load unpacked in Chrome and verify a real ad video is blocked | in_progress | c638867 |

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

## Task 6 close-out (845fd74, 14c8e07)

The worker's report was substantially accurate, but two findings came from verifying it instead
of trusting it:

1. **The guard's document-safety was incidental.** Probing the list with an unrelated
   `||s.ytimg.com\^$document` rule showed the existing test only protected `get_midroll_info`
   (exact-shape comparison). A navigation-blocking rule on any other host would have shipped.
   Added a principled test — no compiled rule may carry `main_frame` — proven RED by injecting
   the bad rule and GREEN after removing it (6 rules tests now).
2. **The reported turbo cache risk was real.** `build` and `test` hashed only `src/**/*.ts`, so
   editing `packages/rules/lists/youtube.txt` replayed a cached run: the script itself picked the
   new rule up (verified directly), Turbo did not, and `dist/rules.json` stayed stale. Fixed by
   adding the lists to both tasks' inputs, verified by behaviour (list edit → new rule present in
   `dist`), not by trusting cache-hit log wording.

Rules shipped: 5 network (1 evidence-backed backstop `||youtube.com/get_midroll_info$xmlhttprequest`, 2 observed ad hosts, 2 general-knowledge hosts explicitly flagged
`NO VERIFICADO EN ESTA SESIÓN` in the list) + 5 cosmetics (only the `youtube-evidence.md` §3
selectors; the unverified in-player overlay/skip selectors stay out). Committed as one work unit
because `pnpm-lock.yaml` is shared by the list package and the app wiring: splitting it would
leave an intermediate state that is not `--frozen-lockfile` installable.

## Task 7 partial close-out (4e94242)

Proven against real YouTube **without** the extension loaded, by running the built
`dist/innertube.js` and `dist/cosmetics.css` through CDP in the MAIN world, with a no-patch
control run so the result is attributable:

- ad payload that schedules breaks (`adPlacements`, `playerAds`, `adSlots`) goes absent on every
  load once patched, while `adBreakHeartbeatParams` survives and playback keeps running.
- the two cosmetic selectors that exist on home (`ytd-ad-slot-renderer`, `#masthead-ad`) go
  `display: none`, and organic content cards stay 34 before / 34 after.

Needs Paul, because `chrome://extensions` cannot be reached programmatically: load
`apps/block-ads/dist` unpacked, then verify (a) the manifest-registered MAIN-world script runs at
`document_start`, (b) DNR actually blocks `/get_midroll_info` via `getMatchedRules` /
`declarativeNetRequestFeedback`, (c) no pre-roll plays while the video still starts. Also record
the in-player overlay and skip-button DOM during a real ad, which §4 left unverified.

## Task 7 partial close-out (c638867)

Loaded unpacked in Paul's Chrome. What the live data proved: `['core']` enabled, five rules
installed (`330000 − 329995 = 5`, because `getAvailableStaticRuleCount` is the *remaining global
budget*, not our own count), `ruleId 2`/`4` matched in `getMatchedRules`, and `getPlayerResponse()`
came back `placements ABSENT / playerAds ABSENT / heartbeat string / play OK`.

A pre-roll still played. Root cause, measured: on the initial watch load YouTube issues **zero**
requests to `/youtubei/v1/player`; the first player response is written into the HTML as
`var ytInitialPlayerResponse = {…}` (`configurable: false`, already carrying `adPlacements: 1`,
`playerAds: 1`, `adSlots: 8`). A fetch/XHR patch cannot see a response that never crosses the
network. The §7 verification in `odd/specs/youtube-evidence.md` used `loadVideoById()`, which is
the *video-switch* path — that is why it looked green.

Fix v1, `c638867`: shadow the carrier with a permanent accessor installed at `document_start`
(static content scripts run before the page's inline scripts), pruning at assignment time,
preserving `adBreakHeartbeatParams`, passing non-object values through, and publishing
`window.__blockAdsInnerTube` so a lost race is checkable instead of inferred.

**Fix v1 caused task 9.** In the real browser YouTube answered with the enforcement wall — *"Ad
blockers violate YouTube's Terms of Service"* — on the second video chosen from the home feed, with
`playabilityStatus.status: "ERROR"` and the dialog rendered inside the player
(`.ytp-mdx-popup-dialog`). Measured in `odd/specs/youtube-evidence.md` §10: the descriptor of
`window.ytInitialPlayerResponse` flips `data → accessor` exactly when the scriptlet is active, and
the classic `static.doubleclick.net/instream/ad_status.js` probe still loads, so it is not the
trigger. A permanent get/set on a page global is a one-call fingerprint.

Fix v2, `75688f7`: use the accessor as a **one-shot write trap**. On the first assignment it prunes
and restores the property to the shape a page's `var` produces — data, `writable: true`,
`enumerable: true`, `configurable: false` — so no fingerprint survives. Two behaviours the tests
pinned:

- If the page already declared the carrier, `var` leaves it *writable*, so the carrier is pruned by
  overwriting the value without touching the descriptor. The first version returned `false` there
  and did nothing; this was found by the RED run, not designed.
- The status surface is now `{ accessorInstalled, carrierPruned }`: it distinguishes "lost the
  race" from "pruned", which the old single flag conflated.

Known limitation, accepted: after the heal the property is a plain writable data property, so a
*second* page assignment is not pruned by the trap. Video switches go through
`/youtubei/v1/player`, where the fetch/XHR patch prunes the same object before the page sees it —
that path was measured green in §7.

**Task 10 result: the fix is correct but the hypothesis was wrong.** With the trap loaded, Paul's
browser reports `descriptor: data`, `configurable: false`, `scriptlet:
{accessorInstalled: true, carrierPruned: true}`, `placements: ABSENT` — and `status: ERROR`. No
accessor fingerprint survives, the wall is still there. §10's "the accessor is the tell" was a real
correlation with no causal proof; the shipped change is still worth keeping (a permanent get/set on a
page global is a free fingerprint and the writable-overwrite fallback prunes a carrier we used to
skip), but it did not close the bug.

What the combos actually leave standing (`odd/specs/youtube-evidence.md` §11):

| inline carrier pruned | DNR | result |
|---|---|---|
| NO (fetch/XHR only) | ON | no wall, **pre-roll plays** (task 7) |
| YES | OFF | no wall |
| YES | ON | **wall**, `playabilityStatus.status: ERROR` |

So the trigger is the *combination*, and two things are still unmeasured: which blocked request is
the tell, and whether `ERROR` is decided by the server (sticky per session) or by the player. The
first needs a URL per blocked request, which `getMatchedRules` cannot give (its `MatchedRule` is
`ruleId`/`rulesetId`/`tabId`/`timeStamp`, verified in `@types/chrome@0.3.4`); `onRuleMatchedDebug`
does carry `request.url` and `request.type`, so `1347914` adds a 60-entry deduped buffer in
`chrome.storage.session` with the matched filter text, readable from the service worker console.
The second needs the raw `/watch` HTML, which our pruning never touches. The measurement protocol,
with both console snippets and the decision table, is §11 of the evidence spec.

Still open for task 7, in the real Chrome after reloading the extension and the watch page:

1. `Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')` → `data`, `configurable:
   false`, identical to the same page with the extension disabled.
2. `__blockAdsInnerTube` → `{ accessorInstalled: true, carrierPruned: true }`.
3. No wall, and no pre-roll, on the first video *and* on the next one chosen from the home feed.
4. Task 8 (in-player overlay and skip button selectors) remains unverified and out of the rules.

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
