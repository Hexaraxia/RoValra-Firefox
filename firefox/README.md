# RoValra Firefox automatic updates

This builds a personal Firefox port directly from published [RoValra releases](https://github.com/NotValra/RoValra/releases), applies maintained compatibility fixes, checks it, obtains Mozilla signing, and publishes an update feed. It does not wait for the separate rav4 port.

The initial source is RoValra 2.6.13, commit `813c2bc02caf70c8590f53778ea4dea10c8f03dc`. The port version is `2.6.13.3`, named `RoValra Personal Port`. Desktop Firefox 140 or newer is required.

The signed [2.6.13.3 installer](https://github.com/Hexaraxia/RoValra-Firefox/releases/download/firefox-v2.6.13.3/rovalra-firefox-2.6.13.3.xpi) is published and verified as a permanent installation in Firefox 156.0.1. This fork's signing secrets and scheduled workflow are configured. Install using Firefox, disable the old port, and leave automatic updates enabled. If Firefox saves the file instead of offering installation, open `about:addons`, use the gear menu's **Install Add-on From File**, and select the downloaded XPI.

## One-time setup

1. Enable GitHub Actions in [your fork](https://github.com/Hexaraxia/RoValra-Firefox/actions). The workflow and this folder must be on the default branch for scheduled runs.
2. Sign in to [Mozilla Add-on Developer Hub](https://addons.mozilla.org/developers/), accept the developer agreement if prompted, and generate [API credentials](https://addons.mozilla.org/developers/addon/api/key/).
3. Add two [GitHub Actions repository secrets](https://github.com/Hexaraxia/RoValra-Firefox/settings/secrets/actions): `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`. Store the values only in GitHub Secrets, never in source files or chat.
4. Run the Firefox workflow from the Actions tab. It builds, tests, signs an unlisted add-on, and publishes a release. Mozilla may hold a submission for review; the next run checks that submission instead of assigning a new add-on ID.
5. Download the signed `.xpi` from [Releases](https://github.com/Hexaraxia/RoValra-Firefox/releases/latest) using Firefox and approve installation. Disable the old RoValra port to prevent two copies from changing the same pages.

After the first signed installation, leave automatic extension updates enabled. The workflow checks every six hours and Firefox checks the signed HTTPS update feed periodically. This is not instantaneous: GitHub scheduling, Mozilla review, and Firefox's update interval can add delay.

You can select `build_only` when manually running the workflow to check the pipeline before adding Mozilla credentials. That run creates preview/source artifacts without signing or publishing.

The permanent update feed is `https://github.com/Hexaraxia/RoValra-Firefox/releases/latest/download/updates.json`. Keep the repository name and `firefox.config.json` add-on ID stable. This is a separate add-on from rav4's port and does not migrate its settings automatically.

## Local build and verification

Run these commands inside this folder with Node.js 22 or newer:

```powershell
npm ci --ignore-scripts
npm run build
npm test
npm run lint:firefox
npm run smoke:firefox
npm run package
```

`dist/firefox` contains the extension. `artifacts` contains the unsigned preview, complete corresponding source, build provenance, and Firefox smoke-test report. The unsigned ZIP is for temporary development installation through `about:debugging`, not permanent installation. Temporary installs disappear when Firefox restarts.

The smoke test starts a separate headless Firefox profile; it does not use your existing profile or Roblox login. It checks extension loading, popup initialization, background settings, messaging, and dynamic rules. CI also checks content startup on Roblox's public logged-out page; set `ROVALRA_LIVE_SMOKE=1` to include that check locally. Authenticated Roblox features such as game joining, OAuth, purchases, and avatar rendering still require manual testing. The first release's Mozilla signature, permanent installation, published update feed, and download hash are verified. An update between two signed versions has not yet been exercised.

`FIREFOX_BINARY` can override the browser executable. The default on Windows is `C:\Program Files\Mozilla Firefox\firefox.exe`.

To inspect the latest upstream release locally:

```powershell
npm run check-upstream
npm run build -- --lock .cache/candidate.json
```

The checked-in lock remains the reproducible starting version. Automation resolves a published release tag to an immutable commit, rather than building untagged upstream changes. A fourth numeric version component is reserved for port corrections; increase `portRevision` before releasing a changed port of the same upstream version.

## Compatibility and release behavior

- Firefox event-page background replaces Chrome's service worker.
- A compatibility adapter handles callback and Promise extension APIs, cross-compartment event data, allowed cross-origin requests, optional permission user gestures, typed game-launch commands, and avatar-renderer transport.
- Exact patch anchors and the upstream permission/content-script baseline stop builds when upstream changes need review. They cannot prove that every future upstream feature works. Failed runs leave the existing signed release available.
- Build execution has no Mozilla signing secrets. Signing and publication happen in separate jobs. Signed payloads must match the checked unsigned package before the update feed is generated. Manifest JSON is compared by values because Mozilla reformats it during signing; every other payload file must match byte for byte.
- Each release includes the corresponding prepared source and SHA-256 provenance. Restricted upstream logo, contributor, and donor-tier artwork is replaced with original geometric artwork.
- Mozilla's linter currently reports upstream dynamic HTML assignment warnings and an Android minimum-version warning, with no validation errors. They are retained in `artifacts/firefox-lint.json`; a successful build is not a full security audit.
- See [privacy declarations](docs/PRIVACY.md) for retained data flows and removed diagnostic reporting. Firefox consent declarations cover upstream features; this is not a claim that upstream services have been independently audited.

## Maintenance

For a compatibility failure, inspect the failed workflow, update the relevant transform and regression checks, and increase `portRevision`. Permission or injection-surface changes require a deliberate update to `upstream-surface.json` after inspection. Do not bypass failing checks to publish an update.

GitHub may disable scheduled workflows in inactive public repositories; enable them again if this occurs. A signing review or rejected version needs attention in Mozilla Developer Hub. The workflow cannot override Mozilla's decisions or automatically repair arbitrary upstream redesigns.

References: [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [Firefox update manifests](https://extensionworkshop.com/documentation/manage/updating-your-extension/), [Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

Source and modifications are GPL-3.0-only. Upstream attribution is preserved in distributed source and packages.
