import { test } from 'node:test';
import assert from 'node:assert/strict';

// components/snippets.js reaches Tauri through ipc.js, which reads the bridge
// when it loads. A recording stand-in lets the paste flow run under node.
const calls = [];
const answers = {
    get_clipboard_history: () => [{ text: 'NEWEST', payload: null }, { text: 'older' }],
    snippets_expand: ({ id }) => `expanded:${id}`,
    copy_to_clipboard: () => null,
    clipboard_paste_blocker: () => null,
    paste_into_focused_app: () => null,
};
globalThis.window = {
    __TAURI__: {
        core: {
            invoke: async (cmd, args) => {
                calls.push([cmd, args]);
                const answer = answers[cmd];
                if (!answer) throw new Error(`unexpected command ${cmd}`);
                return answer(args);
            },
        },
        event: { listen: async () => () => {} },
    },
};

const snippets = await import('../src/js/components/snippets.js');
const {
    snippetResult,
    snippetsProblemRows,
    classifyResultId,
    isSyntheticResultId,
    isPrefixedQuery,
    prefixSuggestionResults,
    SNIPPETS_PREFIX,
} = await import('../src/js/catalog.js');

const names = () => calls.map(([cmd]) => cmd);
const reset = () => {
    calls.length = 0;
    answers.clipboard_paste_blocker = () => null;
    answers.get_clipboard_history = () => [{ text: 'NEWEST', payload: null }, { text: 'older' }];
};

test('the context carries the local date, time, weekday, clipboard and id', () => {
    const ctx = snippets.contextFor(new Date(2026, 9, 13, 14, 5), 'clip', 'uuid-1');
    assert.deepEqual(ctx, {
        date: '2026-10-13',
        time: '14:05',
        weekday: 'Tuesday',
        clipboard: 'clip',
        uuid: 'uuid-1',
    });
    assert.equal(snippets.contextFor(new Date(2026, 0, 5, 9, 0), '', 'u').date, '2026-01-05');
    assert.equal(snippets.contextFor(new Date(2026, 0, 5, 9, 0), '', 'u').time, '09:00');
});

test('expanding asks core with the newest clip, a labelled clip by its value', async () => {
    reset();
    assert.equal(await snippets.expand('sig'), 'expanded:sig');
    const [, args] = calls.find(([cmd]) => cmd === 'snippets_expand');
    assert.equal(args.id, 'sig');
    assert.equal(args.context.clipboard, 'NEWEST');
    assert.match(args.context.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(args.context.uuid.length > 8);

    reset();
    answers.get_clipboard_history = () => [{ text: '2+2 = 4', payload: '4' }];
    await snippets.expand('sig');
    assert.equal(calls.find(([cmd]) => cmd === 'snippets_expand')[1].context.clipboard, '4');
});

test('a clipboard history that cannot be read expands with an empty clipboard', async () => {
    reset();
    answers.get_clipboard_history = () => {
        throw new Error('history off');
    };
    assert.equal(await snippets.expand('sig'), 'expanded:sig');
    assert.equal(calls.find(([cmd]) => cmd === 'snippets_expand')[1].context.clipboard, '');
});

test('pasting copies first, then checks it can type, then types', async () => {
    reset();
    await snippets.paste('sig');
    assert.deepEqual(names().filter((n) => n !== 'get_clipboard_history'), [
        'snippets_expand',
        'copy_to_clipboard',
        'clipboard_paste_blocker',
        'paste_into_focused_app',
    ]);
    assert.equal(calls.find(([cmd]) => cmd === 'copy_to_clipboard')[1].text, 'expanded:sig');
});

test('a refused paste leaves the text copied and types nothing', async () => {
    reset();
    answers.clipboard_paste_blocker = () => 'No way to type here';
    await snippets.paste('sig');
    assert.ok(names().includes('copy_to_clipboard'));
    assert.ok(!names().includes('paste_into_focused_app'));
});

test('a snippet that cannot be expanded copies and pastes nothing', async () => {
    reset();
    answers.snippets_expand = () => {
        throw 'no snippet named "gone"';
    };
    await snippets.paste('gone');
    assert.ok(!names().includes('copy_to_clipboard'));
    assert.ok(!names().includes('paste_into_focused_app'));
    answers.snippets_expand = ({ id }) => `expanded:${id}`;
});

test('copying only copies', async () => {
    reset();
    await snippets.copy('sig');
    assert.ok(names().includes('copy_to_clipboard'));
    assert.ok(!names().includes('clipboard_paste_blocker'));
    assert.ok(!names().includes('paste_into_focused_app'));
});

test('a snippet row names its keyword and previews its text', () => {
    const row = snippetResult({
        id: 'sig',
        name: 'Email signature',
        keyword: 'sig',
        preview: 'Best regards, Ethan',
        score: 3000,
    });
    assert.equal(row.title, 'Email signature');
    assert.equal(row.subtitle, 'sig  ·  Best regards, Ethan');
    assert.deepEqual(classifyResultId(row.id), { kind: 'snippet', id: 'sig' });
    assert.ok(isSyntheticResultId(row.id), 'no Ctrl+K file actions for it');

    // A snippet named like its keyword does not say it twice.
    const same = snippetResult({ id: 'date', name: 'date', keyword: 'date', preview: '{date}', score: 0 });
    assert.equal(same.subtitle, '{date}');
});

test('s" is a listed prefix that keeps web suggestions away', () => {
    assert.equal(SNIPPETS_PREFIX, 's"');
    assert.ok(isPrefixedQuery('s"sig'));
    assert.ok(prefixSuggestionResults('"snippet').some((r) => r.title.startsWith('s"')));
});

test('a window row names its app and says when it is minimized', async () => {
    const { windowResult, WINDOWS_PREFIX } = await import('../src/js/catalog.js');
    const row = windowResult(
        { id: 'hwnd:4242', title: 'Inbox - Gmail', app: 'Google Chrome', exe_path: 'C:\\c.exe', minimized: true },
        0,
        3,
    );
    assert.equal(row.title, 'Inbox - Gmail');
    assert.equal(row.subtitle, 'Google Chrome  ·  minimized');
    assert.equal(row.path, 'C:\\c.exe', 'the exe is where the row icon comes from');
    assert.deepEqual(classifyResultId(row.id), { kind: 'window', id: 'hwnd:4242' });
    assert.ok(isSyntheticResultId(row.id));
    assert.ok(isPrefixedQuery(`${WINDOWS_PREFIX}chrome`));

    // A UWP window has no separate app name; the title says it all.
    const uwp = windowResult({ id: 'hwnd:7', title: 'Settings', app: '', exe_path: null, minimized: false }, 1, 3);
    assert.equal(uwp.subtitle, 'Window');
    assert.equal(uwp.path, '');
    assert.ok(row.score > uwp.score, 'front to back is the order they arrived in');
});

test('switching reports a window that closed in the meantime', async () => {
    reset();
    answers.activate_running_app = () => true;
    const finder = await import('../src/js/components/windowfinder.js');
    assert.equal(await finder.switchTo('hwnd:1'), true);
    const [, args] = calls.find(([cmd]) => cmd === 'activate_running_app');
    assert.deepEqual(args, { pid: 0, desktopId: 'hwnd:1', exec: null });

    answers.activate_running_app = () => false;
    assert.equal(await finder.switchTo('hwnd:1'), false);
    answers.activate_running_app = () => {
        throw new Error('backend down');
    };
    assert.equal(await finder.switchTo('hwnd:1'), false);
});

test('a broken file shows its warnings as rows that repeat them when picked', () => {
    const rows = snippetsProblemRows(['[snippets.a] has no `text`']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'snippets.toml has a problem');
    assert.equal(rows[0].subtitle, '[snippets.a] has no `text`');
    assert.equal(classifyResultId(rows[0].id).kind, 'quick');
    assert.deepEqual(snippetsProblemRows([]), []);
});
