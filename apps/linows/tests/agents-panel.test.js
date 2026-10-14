import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const elements = new Map();
globalThis.document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
        innerHTML: '', hidden: false, addEventListener() {}, classList: { toggle() {} },
    });
    return elements.get(id);
} };
let fail = true;
globalThis.window = { __TAURI__: {
    core: { invoke: async (cmd) => {
        if (cmd === 'get_config') return { entries: [] };
        if (cmd === 'agents_status') {
            if (fail) throw new Error('Command agents_status not found');
            return [{ id: 'codex', name: 'Codex', installed: true, meters: [], windows: [] }];
        }
        throw new Error(cmd);
    } }, event: { listen: async () => () => {} },
} };
const agents = await import('../src/js/screens/commands/agents.js');

test('a scan failure stays visible and a retry recovers', async () => {
    agents.init();
    try {
        agents.enter();
        await new Promise(setImmediate);
        assert.match(elements.get('cmd-agents-list').innerHTML, /Couldn't read agents.*agents_status not found/);
        assert.match(elements.get('cmd-agents-count').innerHTML, /Scan failed/);
        assert.equal(elements.get('cmd-agents-refresh-btn').disabled, false);
        fail = false;
        agents.handleKey({ key: 'r', preventDefault() {} });
        await new Promise(setImmediate);
        assert.match(elements.get('cmd-agents-count').innerHTML, /1 detected/);
        assert.match(elements.get('cmd-agents-list').innerHTML, /Codex/);
    } finally { agents.exit(); }
});

test('Tauri compiles and registers the agent scan command', () => {
    const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
    assert.match(main, /^mod agents;/m);
    assert.ok(main.includes('agents::agents_status,'));
});
