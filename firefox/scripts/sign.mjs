import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Client, { JwtApiAuth, signAddon } from 'web-ext/util/submit-addon';
import { root, cleanGenerated, sha256 } from './common.mjs';
import { releaseContext, validateArchive, validateSignedArchive } from './release.mjs';

export function existingVersionState(details, version) {
    if (!details) return 'missing';
    if (details.version !== version || details.channel !== 'unlisted') throw new Error('AMO version does not match the requested unlisted release');
    if (details.is_disabled || details.file?.status === 'disabled') throw new Error('AMO disabled or rejected this version. Resolve the review or increment portRevision after fixing it.');
    return details.file?.status === 'public' ? 'approved' : 'pending';
}

export async function signRelease() {
    const apiKey = process.env.WEB_EXT_API_KEY;
    const apiSecret = process.env.WEB_EXT_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET from your Mozilla developer account');
    const { info } = await releaseContext();
    const artifacts = path.join(root, 'artifacts');
    const unsignedPath = path.join(artifacts, `rovalra-firefox-${info.version}-unsigned.zip`);
    const sourcePath = path.join(artifacts, `rovalra-firefox-${info.version}-source.zip`);
    const unsigned = await fs.readFile(unsignedPath);
    validateArchive(unsigned, info);
    await fs.access(sourcePath);
    await cleanGenerated('artifacts/signed');
    const downloadDir = path.join(artifacts, 'signed');
    await fs.mkdir(downloadDir, { recursive: true });
    const baseUrl = new URL('https://addons.mozilla.org/api/v5/');
    const client = new Client({ baseUrl, apiAuth: new JwtApiAuth({ apiKey, apiSecret }), downloadDir });
    const lookup = new URL(`addons/addon/${encodeURIComponent(info.addonId)}/versions/${info.version}/`, baseUrl);
    const response = await client.fetch(lookup);
    if (!response.ok && response.status !== 404) throw new Error(`AMO version lookup failed with ${response.status}`);
    const existing = response.status === 404 ? null : await response.json();
    const state = existingVersionState(existing, info.version);
    if (state !== 'missing' && !existing.source) await client.doFormDataPatch({ source: client.fileFromSync(sourcePath) }, encodeURIComponent(info.addonId), existing.id);
    if (state === 'pending') throw new Error(`AMO is still reviewing ${info.version}. The next scheduled run will check again without resubmitting it.`);
    if (state === 'approved') {
        const fileUrl = new URL(existing.file.url);
        if (fileUrl.origin !== 'https://addons.mozilla.org') throw new Error('Unexpected AMO signed download origin');
        await client.downloadSignedFile(fileUrl, info.addonId);
    } else {
        await signAddon({
            apiKey,
            apiSecret,
            amoBaseUrl: baseUrl.href,
            id: info.addonId,
            xpiPath: unsignedPath,
            downloadDir,
            channel: 'unlisted',
            savedIdPath: path.join(downloadDir, '.web-extension-id'),
            savedUploadUuidPath: path.join(downloadDir, '.amo-upload-uuid'),
            submissionSource: sourcePath,
            validationCheckTimeout: 300000,
            approvalCheckTimeout: 900000
        });
    }
    const files = (await fs.readdir(downloadDir)).filter((name) => name.endsWith('.xpi'));
    if (files.length !== 1) throw new Error('AMO did not return exactly one signed XPI');
    const signed = await fs.readFile(path.join(downloadDir, files[0]));
    validateSignedArchive(signed, unsigned, info);
    if (existing?.file.hash && existing.file.hash !== `sha256:${sha256(signed)}`) throw new Error('Downloaded XPI differs from the AMO SHA-256');
    console.log(`Signed and checked Firefox ${info.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        await signRelease();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
