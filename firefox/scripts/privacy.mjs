import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_DATA_COLLECTION = Object.freeze([
    'authenticationInfo',
    'personallyIdentifyingInfo',
    'browsingActivity',
    'websiteContent',
    'websiteActivity',
    'locationInfo',
    'searchTerms',
    'personalCommunications',
    'financialAndPaymentInfo',
]);

const reviewedChannelsHash =
    '187267ef3b3c3887a27f1544e43ab71d250822b7803991b29d3068ad80f65dbe';

export const disabledChannelTracker =
    'export async function updateClientChannelAssignments() { return []; }\n' +
    'export function init() {}\n';

export function stripDiagnosticHeader(source) {
    const normalized = source.replace(/\r\n/g, '\n');
    const pattern = /        if \(isRovalraApi && subdomain === 'apis'\) \{\n            normalizedHeaders\.set\(\n                'x-rovalra-user-agent',\n                getRovalraUserAgent\(\),\n            \);\n        \}\n/g;
    const matches = [...normalized.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error('Privacy review required: diagnostic header structure changed.');
    }
    const result = normalized.replace(pattern, '');
    if (/x-rovalra-user-agent/i.test(result)) {
        throw new Error('Privacy review required: additional diagnostic header use.');
    }
    return result;
}

export function disableChannelTelemetry(source) {
    const normalized = source.replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(normalized).digest('hex');
    if (hash !== reviewedChannelsHash) {
        throw new Error('Privacy review required: client channel tracker changed.');
    }
    return disabledChannelTracker;
}

export async function applyPrivacy(sourceDir) {
    const apiPath = path.join(sourceDir, 'src/content/core/api.js');
    const channelsPath = path.join(
        sourceDir,
        'src/content/core/utils/trackers/channels.js',
    );
    const [apiSource, channelsSource] = await Promise.all([
        readFile(apiPath, 'utf8'),
        readFile(channelsPath, 'utf8'),
    ]);
    const patchedApi = stripDiagnosticHeader(apiSource);
    const patchedChannels = disableChannelTelemetry(channelsSource);
    await writeFile(apiPath, patchedApi);
    await writeFile(channelsPath, patchedChannels);
    return {
        required: [...REQUIRED_DATA_COLLECTION],
        optional: [],
        disabled: ['diagnostic-user-agent-header', 'client-channel-reporting'],
    };
}
