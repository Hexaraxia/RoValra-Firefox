# Validation

## Upstream compatibility repair on 2026-10-06

The two scheduled runs after the version-format repair passed. The next failure began when upstream published 2.6.15: the authenticated-user helper already contained the readiness fix, so the legacy patch anchor no longer existed. The transform now verifies the ready-state helper and accepts that corrected cold-start path unchanged, while retaining the fix for older sources. Tests exercise both source fixtures when DOMContentLoaded has fired, is pending, or fires during the storage read, and reject unexpected helper/path changes.

Upstream also added a global Firefox compatibility shim. Its fetch/event/response modifications overlap this port's adapters, and its new `proxyFetch` and `fetchImageAsDataUrl` background handlers do not preserve the maintained fetch restrictions. The build removes that sole entry import and both handlers. The removed handler block is guarded by its reviewed SHA-256; changed or partial entry points stop the build for review. Upstream's separate Firefox packaging script is not invoked. The existing extension ID and update feed are preserved.

All 35 regression tests pass. Source 34435e7912dd8d7b9ac6857f985e1fc462b45f9a builds as 2.6.15.3. Manifest permission/injection surfaces and privacy transforms remain unchanged. Mozilla lint reports zero errors and the same 265 warnings. Firefox 157.0.1 loaded the temporary build in a disposable profile, initialized 339 settings and rules 999/1000, and showed onboarding on the logged-out Roblox charts page with no fatal extension errors. Four upstream unreachable-code warnings remain. Authenticated Roblox features are not covered.

## Update repair on 2026-10-05

The scheduled workflow failed at release discovery because upstream published `v2.6.14.1` and the parser accepted only three-part versions. The tagged source also keeps `2.6.14` in its manifest. Release discovery now accepts stable three- and four-part tags, and manifest validation accepts an exact match or the matching three-part base of a hotfix tag. Other mismatches still fail.

Firefox version `2.6.14.103` encodes upstream `2.6.14.1` plus port revision 3. The add-on ID and update-feed URL are unchanged. Tests cover release discovery, rejected draft/prerelease/malformed tags, manifest mismatches, component limits, and ordering across both upstream hotfixes and port corrections. All 28 tests pass.

The new source builds successfully. Permission, host, and content-script surfaces are unchanged, and the existing privacy/compatibility transforms still apply. Mozilla lint reports zero errors and 265 warnings (264 upstream HTML assignment warnings and one Android-version warning). Firefox 157.0 loaded the new temporary build in a disposable profile, initialized 331 settings and rules 999/1000, and displayed the onboarding dialog on the logged-out Roblox charts page with no fatal extension errors. Four upstream unreachable-code warnings remain. Authenticated Roblox features were not tested.

[Workflow 37360401793](https://github.com/Hexaraxia/RoValra-Firefox/actions/runs/37360401793) passed build, signing, and publication of [firefox-v2.6.14.103](https://github.com/Hexaraxia/RoValra-Firefox/releases/tag/firefox-v2.6.14.103). A subsequent release check correctly reports that this version is already published.

The published XPI SHA-256 is `a9e2a754600f41223738db9a58083f71e19614928824307d4fc91cedd1d0a4e1`. The published feed hash matches. In a disposable Firefox 157.0 profile, the old signed 2.6.13.3 XPI was installed non-temporarily, then Firefox's native `findUpdates` with `UPDATE_WHEN_PERIODIC_UPDATE` discovered, downloaded, and installed 2.6.14.103 using the standard update prompt handler. The updated extension remained active, signed (`signedState: 2`), and non-temporary. No permission intervention was needed. The report is `artifacts/signed-update-validation.json` in the development workspace. The browser's elapsed periodic timer and authenticated Roblox features were not tested, and the user's existing browser profile was untouched.

## Published release 2.6.13.3

- [Workflow 36259664426](https://github.com/Hexaraxia/RoValra-Firefox/actions/runs/36259664426) passed build, signing recovery, and publication. The release is [firefox-v2.6.13.3](https://github.com/Hexaraxia/RoValra-Firefox/releases/tag/firefox-v2.6.13.3).
- All 24 regression tests pass. The additional test accepts manifest JSON formatting and key-order changes, while rejecting changed values, extra fields, type changes, and reordered arrays. All other signed payload files must match the tested package byte for byte.
- Mozilla normalizes manifest JSON before signing, as shown in its [upload processing source](https://github.com/mozilla/addons-server/blob/b8e7d6002f9b8e01fd548fb7970d6837ee72bd7a/src/olympia/files/tasks.py#L80-L91). The original byte comparison blocked publication after successful signing. The corrected comparison recovered the existing approved version without resubmitting it or changing its payload.
- The published HTTPS update feed and XPI were downloaded and checked for matching add-on ID, version, update URL, and SHA-256. XPI SHA-256: `52ebbcb690c36f62b43cde68f0ea211778b905d301ffc6e6a447c35115b2c048`.
- Firefox 156.0.1 accepted the published XPI in a disposable profile as an active, non-temporary add-on with `signedState: 2`. The report is `artifacts/signed-install-validation.json` in the development workspace.
- An update between two signed versions and authenticated Roblox features have not been tested. The user's existing Firefox profile was not modified.

## Earlier build checks

Version 2.6.13.3 changes the installed name to `RoValra Personal Port`: Mozilla's submission API rejected `Firefox` in the add-on name. The 2.6.13.2 build and native GitHub smoke test passed before that submission rejection; no 2.6.13.2 signed release was published.

Firefox 2.6.13.2 fixes an intermittent fresh-profile startup race: user lookup now uses the existing ready-state-aware DOM helper instead of waiting for an event that may already have fired. Three new regressions cover complete, loading, and storage-read timing. All 23 tests pass. The local Firefox 156.0.1 smoke test confirms the onboarding dialog appears and has no fatal extension errors. The CI check now waits up to 45 seconds for that dialog and preserves diagnostics on failure. GitHub actions use Node 24-compatible v7 releases and the Ubuntu 24.04 runner.

Built upstream release v2.6.13, commit `813c2bc02caf70c8590f53778ea4dea10c8f03dc`, as Firefox 2.6.13.1.

- Twenty regression tests pass, including mixed browser API calls, cross-compartment header serialization, allowed proxy destinations, sender checks, cookie handling, binary responses, typed launch inputs, privacy transforms, version ordering, and signed-payload comparison.
- `web-ext` 10.7.0 validates the self-hosted package with zero errors. It reports 261 upstream dynamic HTML assignment warnings plus one Android minimum-version warning. The target and runtime validation are desktop Firefox; the warnings are preserved in the build artifact rather than treated as proof of safety.
- Firefox 156.0.1 in a disposable headless profile loaded the temporary add-on, initialized 311 settings and dynamic rules 999/1000, loaded its popup, and completed a background message round trip.
- The logged-out public Roblox charts page displayed 957 RoValra-marked elements and had zero fatal extension script errors. Four upstream unreachable-code warnings were recorded.
- The extension and corresponding prepared source were packaged locally. The installable signed XPI and real Firefox update path require Mozilla credentials and a published release.
- Rebuilding the extracted source ZIP with a fresh dependency installation reproduced all 60 extension files byte for byte, with no missing or extra files. The comparison is recorded in `artifacts/source-reproduction.json`.

The checks do not validate authenticated Roblox actions, actual game launching, every avatar/environment asset, OAuth, payments, or persistent behavior across every upstream change. No account login or personal browser profile was used. Generic media redirects fail safely when Firefox does not reveal their destination; standard avatar asset resolution uses Roblox's v2 location API.

Generated reports are `artifacts/build-info.json`, `artifacts/firefox-lint.json`, and `artifacts/firefox-smoke.json`. Live public-page checks are part of the scheduled workflow; a network or compatibility failure keeps the previous release available.
