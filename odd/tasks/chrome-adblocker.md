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
- **InnerTube patching**: inject in MAIN world, intercept fetch/XHR and the inline carrier, and
  **neutralize** `adPlacements`, `adSlots`, `playerAds`, `adBreakHeartbeatParams` on
  `/youtubei/v1/player` and `/next` (keep the key, empty value of its own kind) rather than
  deleting them.
- **Playback safety**: superseded by measurement. The old "never delete `adBreakHeartbeatParams`"
  line was a recon assumption; deleting ad keys outright produced `playabilityStatus.status = ERROR`
  with an empty `video.currentSrc`, i.e. the wall. Neutralisation is the current rule, and it is
  what the next measurement has to confirm or kill. Conservative pruning only.
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

**Task 10 closed by measurement (`odd/specs/youtube-evidence.md` §12).** The probe answered both
open questions in one reload: the raw `/watch` HTML says `playabilityStatus: OK` while the player on
screen says `ERROR`, so the wall is a **client-side decision**, not a sticky server flag; and that
same HTML had `adPlacements: 0, playerAds: 0`, so there was nothing to prune — **carrier pruning was
not the tell either**. The blocked-request dump named the culprit: rule `||doubleclick.net^` was
killing `static.doubleclick.net/instream/ad_status.js`, the classic ad-block canary (it only sets
`window.google_ad_status = 1`), measured dead in the same session as `google_ad_status: "undefined"`.

Fix: one exception scoped to that resource and to YouTube as initiator, leaving every other
`doubleclick.net` request blocked (`googleads.g.doubleclick.net/pagead/id` stays blocked, and it is a
real ad request). `@@||static.doubleclick.net/instream/ad_status.js$domain=youtube.com` compiles to
`{ id: 1, priority: 2, action: allow, initiatorDomains: ["youtube.com"] }`, which outranks the five
`priority: 1` blocks. Work unit commit: `fd0b0ea` (`Tests 7 passed` in `packages/rules`, RED seen
before the list edit; core 145, extension 60, `pnpm check:ci` exit 0, `dist/` rebuilt with a forced
cache miss and verified by artifact content).

**Task 14 result: the canary was a tell, not the tell.** With `fd0b0ea` loaded, `google_ad_status`
went from `"undefined"` to `"number"` (Chrome now reports the `allow` rule as the winner, `ruleId 1`)
and the wall is still up. See §13. While chasing that, `git log -S` showed `__blockAdsInnerTube` — the
page-readable telemetry global — arrived in the *same* commit as inline-carrier pruning (`c638867`),
so every wall measurement since has had two variables moving at once, and the "no global" baseline was
measured before the global existed. `c0f351c` stops publishing it unless the URL carries
`blockadsdebug`; the status is still returned for tests.

Still open for task 7, in the real Chrome after reloading the extension and the watch page:

1. `Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')` → `data`, `configurable:
   false`, identical to the same page with the extension disabled.
2. `__blockAdsInnerTube` → `{ accessorInstalled: true, carrierPruned: true }`.
3. No wall, and no pre-roll, on the first video *and* on the next one chosen from the home feed.
4. Task 8 (in-player overlay and skip button selectors) remains unverified and out of the rules.

## Wall investigation close-out (fd0b0ea -> c0f351c -> cfe56d4)

The ad-blocker enforcement wall ("Ad blockers violate YouTube's Terms of Service", playback blocked) was chased
one variable at a time in the human's real Chrome. Full measurements in `odd/specs/youtube-evidence.md` §12-§14.

Candidates refuted by direct measurement:

| Candidate | Status | Evidence |
|---|---|---|
| permanent accessor left on `ytInitialPlayerResponse` | refuted | descriptor is `data`, `configurable: false`, wall remains (75688f7) |
| `ad_status.js` canary blocked (sets `window.google_ad_status`) | refuted as the *only* tell | canary allowed, `google_ad_status: number`, wall remains (fd0b0ea) |
| our own page-readable global `window.__blockAdsInnerTube` | refuted | `fingerprint_en_window: false`, wall remains (c0f351c) |
| network layer (DNR) | **required for the wall** | with the ruleset disabled and pruning active, no wall |

Crossing that with the older truth table leaves one request killed in the walled session:
`googleads.g.doubleclick.net/pagead/id`, hit by `||doubleclick.net^` — the rule our own list flagged *NOT
VERIFIED IN THIS SESSION*. uBlock Origin neutralises a failing `/pagead/id` with `redirect=nooptext` (uAssets
`filters.txt`, seen at `domain=windowsreport.com`), which declarativeNetRequest cannot do: it cannot fake a
response body. So the only MV3-pure option is to stop killing the request.

`cfe56d4` adds `@@||googleads.g.doubleclick.net/pagead/id$domain=youtube.com`. Compiled ruleset: 7 rules, 5 blocks,
2 exceptions. The new test pins a group property, not an exact list: **no `allow` rule may be a bare host anchor**,
it must name a path, otherwise a future exception could re-open an entire advertising host. Proven by hand — adding
`@@||doubleclick.net^$domain=youtube.com` fails with `reglas allow que reabren un host entero: ||doubleclick.net^`.
rules 8, core 145, extension 66, `pnpm check:ci` exit 0.

### Lesson recorded so we do not repeat it

An unverified "general knowledge" network rule over a Google host was enough to break playback while the ad media
endpoints stayed blocked. Broad host-anchor rules marked unverified must be treated as suspects for any playback
bug, not as innocent background. **When a new blocking rule goes into the list, it needs the evidence line that
justifies it, or it does not go in.**

Also: a wall detector keyed on a guessed CSS class silently returned "no wall" while the wall was on screen. The
wall text nodes have no usable class. Detect the wall by its text and by an empty `video.currentSrc`.

### Still to measure with `cfe56d4` loaded

1. Does the wall drop? (the experiment's actual question)
2. **If it does: does a pre-roll play anyway?** `pagead/id` is an identity ping, not ad media, and the inline
   carrier plus `/player` responses are pruned, so the expectation is no pre-roll. If a pre-roll does appear, the
   wall and the pre-roll are coupled and the remaining hypothesis is the pruned-response inconsistency:
   `adBreakHeartbeatParams` non-empty with `adPlacements` absent — measured for the first time in a walled session
   (`heartbeat: no-vacio`, `placements: ABSENT`). Testing that variant means revisiting the `extension-shell.md`
   §6 decision to always preserve the heartbeat, so it needs an explicit decision from Paul.
3. Cosmetic ads in home/search and in-player overlay selectors (task 8) are still unverified.

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

## Wall investigation close-out (cfe56d4 -> neutralisation)

The fresh-load pair settled it. With the extension reloaded and a brand-new tab:

```text
carrier_en_window ABSENT | live_adPlacements ABSENT | live_playerAds ABSENT | live_adSlots ABSENT
heartbeat "len 8" | status ERROR | video.currentSrc "" | dnrBlocked []
```

Four hypotheses died in one measurement: network rules (zero DNR matches in that load, so neither the
canary nor `/pagead/id` ever ran), the permanent accessor, the `window.__blockAdsInnerTube` fingerprint,
and both allow exceptions. What was left is the shape of the object we hand the player: three ad keys
**deleted** while `adBreakHeartbeatParams` stays a non-empty string. That reads to the player as "an ad
blocker removed my scheduled ad break", not as "no ad break scheduled".

Changed `fix(extension): neutralize ad keys in place instead of deleting them`:

- `PRUNED_KEYS` + `PROTECTED_KEYS` -> `NEUTRALIZED_KEYS`; a matched key stays present with the empty value
  of its own runtime kind (`[]`, `{}`, `""`). `number`/`boolean`/`null` still drop, documented and pinned by
  a test.
- `adBreakHeartbeatParams` moved into the neutralised set. This **reverses `extension-shell.md` §6**, whose
  "deleting it makes the player unplayable" line was a recon assumption, never a measurement. Recorded in
  the spec with the decision tree for the next measurement.
- `pruneAdKeys` -> `neutralizeAdKeys`; the one-shot carrier trap, the install order and the
  `blockadsdebug` gate are untouched.
- extension tests 66 -> 69, `pnpm check:ci` exit 0 (145 core, 8 rules).

Verification beyond the suite: loaded the built `apps/block-ads/dist/innertube.js` in a Node `vm` with a
fake `window`, both through the write trap and with the carrier pre-existing. `adPlacements` ends as `[]`,
`adBreakHeartbeatParams` as `""`, nested `onResponseReceivedActions[0].adPlacements` too, `videoDetails`
and `streamingData.formats` intact, descriptor `data` + `configurable: false`, and telemetry absent without
the token. `grep -c PROTECTED_KEYS dist/innertube.js` -> 0.

Not yet measured: whether neutralisation lifts the wall. The decision tree is in `youtube-evidence.md` §15.

## Network telemetry close-out (neutralisation -> opt-in `__blockAdsNetwork`)

Neutralisation is committed but not yet measured in Chrome, and the previous measurement left one
question open: the inline carrier came back patched (`heartbeat ""`) while the *live* player response
still carried 7 `adPlacements` and `playerAds`. Two readings fit that pair, and they need opposite
fixes:

1. the fetch/XHR patch never saw the request (clean-realm bypass: the page keeps a pristine `fetch`
   from an iframe `contentWindow`), or
2. the patch saw it and the reconstruction did not reach the player.

Counting is the only way to tell them apart from the console, so `innertube.ts` now records per
transport, behind the same `blockadsdebug` token:

- `seen` — requests that went through the patched `window.fetch` / `XMLHttpRequest.send`, counted at
  send time so one request is counted exactly once.
- `matched` — of those, the ones on a pruned endpoint, with the last `MAX_MATCHED_PATHS` (8) route
  paths, query stripped.
- `neutralized` — of those, the ones whose payload was actually rebuilt (`pruned !== response`, and
  for XHR only when a shadow was really applied, so a binary `responseType` cannot inflate it).

Bypass signature: `seen > 0` and `matched === 0` while page resource timing shows real
`/youtubei/v1/player` calls. Dead patch: `seen === 0`. Extension tests 69 -> 77,
`pnpm check:ci` exit 0 (145 core, 8 rules).

Artifact check, running the built `dist/innertube.js` in a Node `vm` with a fake `window`, `fetch`,
`Response` and `XMLHttpRequest`: four patched calls (player, next, browse, one XHR) plus one call on
the **pre-patch `fetch` reference** to simulate the bypass. Result
`{ seen: 4, matched: 3, neutralized: 3, matchedPaths: [player, next, player] }` — the bypassed call is
invisible to the counter, which is exactly the signal we are looking for in Chrome. Carrier still ends
`adPlacements: []`, `adBreakHeartbeatParams: ""`, `videoDetails` intact, descriptor
`data` + `configurable: false`.

Still open: task 7. The measurement in real Chrome decides between the two readings above.

## Wall closed, efficacy still open (0cd2f77 -> this unit)

Paul's three fresh loads (§17 of `youtube-evidence.md`) settle two things at once:

- **The wall is gone.** Same scriptlet, same rules, only the response *shape* changed (delete -> neutralise):
  `carrier 0/0/0`, `readyState 4`, `currentSrc` a `blob:`, no enforcement message. The §15 hypothesis was
  right and the §12/§13/§14 canary hunt was chasing a symptom.
- **There is no clean-realm bypass.** A real `/youtubei/v1/player` call went through the patched
  `window.fetch` and came back reconstructed: `matched 1`, `neutralized 1`.

`endpoints_que_la_pagina_pidio: {}` is a probe artifact, not evidence: `performance.getEntriesByType`
buffers 250 resource entries and a watch page overflows it, so the earliest entries (the load-time player
call) are gone by the time the probe runs. Recorded so nobody re-reads that probe as "no request".

What task 7 still lacks is proof of *efficacy*: `adPlacements: []` looks identical whether we killed a
pre-roll or the video never had one. Added in this unit, counted **before** emptying:

- `countAdKeys(payload, keys)` -> weight per ad key (array length, object key count, non-empty string = 1),
  nested occurrences included, zero-weight keys omitted.
- `adsFound` on `NetworkStatus`, accumulated by `markAdsFound` on every response we actually rebuild
  (fetch and XHR both), reported only under `blockadsdebug` like the rest.
- `neutralizationKeysFor(url)` so the counter uses the endpoint's own key set instead of a global guess.
- extension tests 77 -> 84, `pnpm check:ci` exit 0 (145 core, 8 rules).

Artifact check against the rebuilt `dist/innertube.js` in a Node `vm`: three patched player/next responses
carrying one ad each report `adsFound { adPlacements: 3, adSlots: 3, playerAds: 3, adBreakHeartbeatParams: 3 }`
with `seen 4, matched 3, neutralized 3`, the pre-patch `fetch` reference still invisible to the counter, and
the carrier descriptor still `data` + `configurable: false`.

Next: one ad-bearing video, three runs with the new probe. `adsFound.adPlacements > 0` with `muro false` and
playback = blocking works and task 7 closes. `adsFound` absent = wrong video, no ad break scheduled.
