import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Tauri compiles and registers the note storage commands used by the frontend', () => {
    const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
    const notes = readFileSync(new URL('../src-tauri/src/notes.rs', import.meta.url), 'utf8');
    const ipc = readFileSync(new URL('../src/js/ipc.js', import.meta.url), 'utf8');
    assert.match(main, /^mod notes;/m);
    for (const name of ['notes_list', 'notes_search', 'notes_save', 'notes_delete',
        'notes_record_open', 'notes_tag_colors', 'notes_set_tag_color']) {
        assert.ok(ipc.includes(`invoke('${name}'`), name);
        assert.match(notes, new RegExp(`#\\[tauri::command\\]\\s+pub fn ${name}\\(`));
        assert.ok(main.includes(`notes::${name},`), `${name} must be in the invoke handler`);
    }
});

test('every note, template, image and theme IPC command has a compiled Tauri handler', () => {
    const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
    const ipc = readFileSync(new URL('../src/js/ipc.js', import.meta.url), 'utf8');
    const names = [...ipc.matchAll(/invoke\('(notes_[a-z_]+|themes_list|theme_save|theme_delete)'/g)].map((m) => m[1]);
    assert.ok(names.includes('notes_save_image'));
    for (const name of names) {
        const handler = main.match(new RegExp(`(\\w+)::${name},`));
        assert.ok(handler, `${name} must be registered`);
        const module = handler[1];
        assert.ok(main.includes(`mod ${module};`), `${module} must be compiled`);
        const source = readFileSync(new URL(`../src-tauri/src/${module}.rs`, import.meta.url), 'utf8');
        assert.match(source, new RegExp(`#\\[tauri::command\\]\\s+pub fn ${name}\\(`));
    }
});
