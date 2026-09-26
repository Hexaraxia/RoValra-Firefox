import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { root, readJson, writeJson } from './common.mjs';

process.env.SE_CACHE_PATH = path.join(root, '.cache/selenium');
process.env.SE_AVOID_STATS = 'true';
await fs.mkdir(process.env.SE_CACHE_PATH, { recursive: true });
const config = await readJson(path.join(root, 'firefox.config.json'));
const manifest = await readJson(path.join(root, 'dist/firefox/manifest.json'));
const options = new firefox.Options().addArguments('-headless');
const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
const binary = process.env.FIREFOX_BINARY || (process.platform === 'win32' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : null);
if (binary) options.setBinary(binary);
options.setPreference('browser.shell.checkDefaultBrowser', false);
options.setPreference('browser.startup.homepage', 'about:blank');
let driver;
try {
    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
    await driver.manage().setTimeouts({ script: 20000, pageLoad: 45000 });
    await driver.setContext('chrome');
    await driver.executeScript(function () {
        Services.console.reset();
    });
    await driver.setContext('content');
    const id = await driver.installAddon(path.join(root, 'dist/firefox'), true);
    assert.equal(id, config.addonId);
    await driver.setContext('chrome');
    const extension = await driver.executeScript(function (addonId) {
        const policy = WebExtensionPolicy.getByID(addonId);
        return { active: policy.active, url: policy.getURL('') };
    }, id);
    assert.equal(extension.active, true);
    await driver.setContext('content');
    const windows = await driver.getAllWindowHandles();
    await driver.switchTo().window(windows[0]);
    await driver.get(extension.url + manifest.action.default_popup);
    await driver.wait(async () => driver.executeAsyncScript(function (done) {
        browser.storage.local.get(null).then((settings) => done(Object.keys(settings).length > 20));
    }), 10000, 'Background settings did not initialize');
    const state = await driver.executeAsyncScript(function (done) {
        Promise.all([
            browser.storage.local.get(null),
            browser.runtime.sendMessage({ action: 'getLatestPresence' }),
            browser.declarativeNetRequest.getDynamicRules(),
        ]).then(([settings, presence, rules]) => done({ settingsCount: Object.keys(settings).length, presence, rules: rules.map((rule) => rule.id), manifest: browser.runtime.getManifest().version }), (error) => done({ error: String(error) }));
    });
    let livePage;
    if (process.env.ROVALRA_LIVE_SMOKE === '1') {
        await driver.get('https://www.roblox.com/discover/');
        const started = Date.now();
        try {
            await driver.wait(async () => {
                livePage = await driver.executeScript(function () {
                    return {
                        url: location.href,
                        title: document.title,
                        readyState: document.readyState,
                        rovalraElements: document.querySelectorAll('[id*="rovalra"], [class*="rovalra"]').length,
                        onboardingDialog: Boolean(document.querySelector('.rovalra-global-overlay .rovalra-overlay-content[role="dialog"]')),
                        robloxNavigation: Boolean(document.querySelector('#navigation')),
                        bodyLength: document.body?.textContent.length ?? 0,
                    };
                });
                return livePage.onboardingDialog;
            }, 45000, 'RoValra UI did not appear within 45 seconds', 500);
        } catch (error) {
            livePage = { ...livePage, readinessError: error.message };
            await fs.writeFile(path.join(root, 'artifacts/firefox-page.html'), await driver.getPageSource());
            await fs.writeFile(path.join(root, 'artifacts/firefox-page.png'), await driver.takeScreenshot(), 'base64');
        }
        livePage.elapsedMs = Date.now() - started;
        await driver.executeAsyncScript(function (done) { setTimeout(done, 1000); });
    }
    await driver.setContext('chrome');
    const errors = await driver.executeScript(function () {
        return Services.console.getMessageArray().flatMap((message) => {
            try {
                const error = message.QueryInterface(Ci.nsIScriptError);
                return error.sourceName?.startsWith('moz-extension:') ? [{ message: error.errorMessage, source: error.sourceName, line: error.lineNumber, flags: error.flags }] : [];
            } catch { return []; }
        });
    });
    const fatal = errors.filter((error) => error.flags === 0);
    const report = { browser: (await driver.getCapabilities()).get('browserVersion'), version: manifest.version, temporaryInstall: true, background: state, livePage, errors, scope: 'Fresh headless Firefox profile: temporary install, popup, background defaults, message round trip, and dynamic rules. No authenticated Roblox feature or signed update test.' };
    await writeJson(path.join(root, 'artifacts/firefox-smoke.json'), report);
    console.log(JSON.stringify(report, null, 2));
    assert.equal(state.error, undefined, JSON.stringify(state));
    assert.equal(state.manifest, manifest.version);
    assert.ok(state.settingsCount > 20, `Background defaults not initialized: ${JSON.stringify(state)}`);
    assert.ok(state.rules.includes(999), 'Firefox background header rules did not initialize');
    if (process.env.ROVALRA_LIVE_SMOKE === '1') assert.equal(livePage?.readinessError, undefined, JSON.stringify(livePage));
    if (process.env.ROVALRA_LIVE_SMOKE === '1') assert.ok(livePage?.onboardingDialog, 'RoValra onboarding did not initialize on the public Roblox page');
    assert.deepEqual(fatal, [], 'Firefox extension raised script errors');
} finally {
    if (driver) await driver.quit();
}
