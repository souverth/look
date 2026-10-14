import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('all literal frontend IPC calls have compiled, registered Tauri commands', () => {
    const ipc = readFileSync(new URL('../src/js/ipc.js', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
    const handler = main.split('generate_handler![')[1];
    assert.ok(handler);
    const names = new Set([...ipc.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]));
    for (const name of names) {
        const match = handler.match(new RegExp(`(\\w+)::${name},`));
        assert.ok(match, `${name} is missing from the invoke handler`);
        const module = match[1];
        assert.match(main, new RegExp(`^mod ${module};`, 'm'));
        const source = readFileSync(new URL(`../src-tauri/src/${module}.rs`, import.meta.url), 'utf8');
        assert.match(source, new RegExp(`#\\[tauri::command(?:\\([^\\]]*\\))?\\]\\s+pub (?:async )?fn ${name}\\(`));
    }
});
