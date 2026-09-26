import assert from 'node:assert/strict';
import test from 'node:test';
import {
    disableChannelTelemetry,
    disabledChannelTracker,
    stripDiagnosticHeader,
} from '../scripts/privacy.mjs';

const diagnosticHeader = `        if (isRovalraApi && subdomain === 'apis') {
            normalizedHeaders.set(
                'x-rovalra-user-agent',
                getRovalraUserAgent(),
            );
        }
`;

test('privacy transform removes diagnostic data and preserves functional headers', () => {
    const functional = "headers.set('User-Agent', 'RoValraExtension');\n";
    assert.equal(stripDiagnosticHeader(functional + diagnosticHeader), functional);
    assert.equal(
        stripDiagnosticHeader((functional + diagnosticHeader).replace(/\n/g, '\r\n')),
        functional,
    );
});

test('privacy transform rejects changed or duplicate diagnostic paths', () => {
    assert.throws(() => stripDiagnosticHeader(''), /Privacy review required/);
    assert.throws(
        () => stripDiagnosticHeader(diagnosticHeader + diagnosticHeader),
        /Privacy review required/,
    );
    assert.throws(
        () => stripDiagnosticHeader(diagnosticHeader + "headers.set('x-rovalra-user-agent', 'extra');"),
        /Privacy review required/,
    );
    assert.throws(
        () => disableChannelTelemetry('export function init() { fetch("/new-telemetry"); }'),
        /Privacy review required/,
    );
});

test('disabled channel module has no side effects and returns no assignments', async () => {
    const channel = await import(`data:text/javascript,${encodeURIComponent(disabledChannelTracker)}`);
    assert.equal(channel.init(), undefined);
    assert.deepEqual(await channel.updateClientChannelAssignments(), []);
});
