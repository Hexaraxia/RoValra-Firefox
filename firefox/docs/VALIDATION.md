# Validation on 2026-09-26

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
