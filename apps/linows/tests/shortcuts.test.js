import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as shortcuts from '../src/js/shortcuts.js';
import {
    CATALOG,
    configKeyFor,
    parseChord,
    chordLabel,
    chordMatches,
    load,
    loadMap,
    chordsOf,
    warnings,
    display,
    matches,
    actionFor,
    labelAll,
} from '../src/js/shortcuts.js';

// The slice of a KeyboardEvent the matcher reads.
const ev = (key, mods = '', code = null) => ({
    key,
    code: code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key),
    ctrlKey: mods.includes('c'),
    altKey: mods.includes('a'),
    shiftKey: mods.includes('s'),
    metaKey: mods.includes('m'),
});

beforeEach(() => load());

test('config keys follow macOS: dots and capitals become underscores', () => {
    assert.equal(configKeyFor('main.copy'), 'shortcut_main_copy');
    assert.equal(configKeyFor('main.clearPicks'), 'shortcut_main_clear_picks');
    assert.equal(configKeyFor('main.quickActionToggle'), 'shortcut_main_quick_action_toggle');
    assert.equal(configKeyFor('view.toggleLayout'), 'shortcut_view_toggle_layout');
});

test('chords parse in any spelling and label canonically', () => {
    assert.equal(chordLabel(parseChord('shift+ctrl+P')), 'Ctrl+Shift+P');
    assert.equal(chordLabel(parseChord('Ctrl + Alt + Enter')), 'Ctrl+Alt+Enter');
    assert.equal(chordLabel(parseChord('win+space')), 'Win+Space');
    assert.equal(chordLabel(parseChord('ctrl+,')), 'Ctrl+,');
    assert.equal(chordLabel(parseChord('f5')), 'F5');
    assert.equal(chordLabel(parseChord('ctrl+esc')), 'Ctrl+Esc');
    // A dotfile written on a Mac works: cmd is ctrl here, win is the Win key.
    assert.equal(chordLabel(parseChord('cmd+c')), 'Ctrl+C');
    assert.equal(chordLabel(parseChord('super+c')), 'Win+C');
});

test('a chord must be one a person could press without typing a letter', () => {
    assert.match(parseChord('p').error, /needs a modifier/);
    assert.match(parseChord('shift+p').error, /needs a modifier/);
    assert.match(parseChord('ctrl').error, /names no key/);
    assert.match(parseChord('ctrl+a+b').error, /more than one key/);
    assert.match(parseChord('ctrl+banana').error, /not a key/);
    assert.match(parseChord('f21').error, /not a key/);
    // Shift alone is enough for a key that types nothing, and F-keys stand alone.
    assert.equal(parseChord('shift+enter').error, undefined);
    assert.equal(parseChord('f13').error, undefined);
});

test('a chord matches only its own modifiers', () => {
    const copy = parseChord('ctrl+c');
    assert.ok(chordMatches(copy, ev('c', 'c')));
    assert.ok(chordMatches(copy, ev('C', 'c')), 'Caps Lock does not matter');
    assert.ok(!chordMatches(copy, ev('c', '')));
    assert.ok(!chordMatches(copy, ev('c', 'cs')), 'Ctrl+Shift+C is another chord');
    assert.ok(!chordMatches(copy, ev('c', 'ca')), 'Ctrl+Alt+C is another chord');
    assert.ok(!chordMatches(copy, ev('c', 'cm')));
    assert.ok(!chordMatches(copy, ev('d', 'c')));
});

test('the Shift latch stands in for a Shift the webview dropped', () => {
    const clear = parseChord('ctrl+shift+p');
    assert.ok(!chordMatches(clear, ev('p', 'c')));
    assert.ok(chordMatches(clear, ev('p', 'c'), true));
    assert.ok(!chordMatches(parseChord('ctrl+p'), ev('p', 'c'), true), 'a held Shift is not Ctrl+P');
});

test('letters follow the printed legend, falling back to the physical key off Latin layouts', () => {
    const reveal = parseChord('ctrl+f');
    // Dvorak: the physical F key types "u" and the legend says "u", so Ctrl+U is not Ctrl+F.
    assert.ok(!chordMatches(reveal, ev('u', 'c', 'KeyF')));
    assert.ok(chordMatches(reveal, ev('f', 'c', 'KeyY')), 'the printed f counts wherever it sits');
    // A Russian layout prints "а" on the F key: no ASCII letter, so the code decides.
    assert.ok(chordMatches(reveal, ev('а', 'c', 'KeyF')));
    assert.ok(!chordMatches(reveal, ev('а', 'c', 'KeyG')));
});

test('named and punctuation keys match by the key or the physical code', () => {
    assert.ok(chordMatches(parseChord('ctrl+enter'), ev('Enter', 'c', 'Enter')));
    assert.ok(chordMatches(parseChord('ctrl+enter'), ev('Enter', 'c', 'NumpadEnter')));
    assert.ok(chordMatches(parseChord('shift+enter'), ev('Enter', 's', 'Enter')));
    assert.ok(!chordMatches(parseChord('shift+enter'), ev('Enter', '', 'Enter')));
    // AZERTY: the comma sits on physical KeyM; Shift+Comma types "?".
    const comma = parseChord('ctrl+,');
    assert.ok(chordMatches(comma, ev(',', 'c', 'KeyM')));
    assert.ok(chordMatches(comma, ev('?', 'c', 'Comma')));
    assert.ok(chordMatches(parseChord('ctrl+5'), ev('5', 'c', 'Digit5')));
});

test('with nothing configured every action keeps its default', () => {
    assert.equal(display('main.copy'), 'Ctrl+C');
    assert.equal(display('main.openPicked'), 'Shift+Enter');
    assert.equal(display('main.clearPicks'), 'Ctrl+Shift+P');
    assert.equal(display('view.toggleLayout'), 'Ctrl+Shift+C');
    assert.deepEqual(warnings(), []);
    assert.equal(display('nope'), '');
    for (const { id } of CATALOG) assert.ok(chordsOf(id).length > 0, id);
});

test('a rebind replaces the default, and several chords are separated by |', () => {
    load([
        { key: 'shortcut_main_reveal', value: 'ctrl+r | alt+r' },
        { key: 'shortcut_main_quick_action_toggle', value: 'ctrl+shift+o' },
        { key: 'unrelated', value: 'x' },
    ]);
    assert.equal(display('main.reveal'), 'Ctrl+R');
    assert.equal(chordsOf('main.reveal').length, 2);
    assert.ok(matches(ev('r', 'a'), 'main.reveal'));
    assert.ok(!matches(ev('f', 'c'), 'main.reveal'), 'the old chord is gone');
    assert.ok(matches(ev('o', 'cs'), 'main.quickActionToggle'));
    assert.equal(display('main.copy'), 'Ctrl+C', 'what is not rebound is untouched');
    assert.deepEqual(warnings(), []);
});

test('a value that does not parse keeps the default and says why', () => {
    load([
        { key: 'shortcut_main_edit', value: 'ctrl+banana' },
        { key: 'shortcut_main_terminal', value: 'just-a-word' },
    ]);
    assert.equal(display('main.edit'), 'Ctrl+E');
    assert.equal(display('main.terminal'), 'Ctrl+T');
    assert.equal(warnings().length, 2);
    assert.match(warnings()[0], /shortcut_main_edit: "ctrl\+banana": "banana" is not a key/);
    // One good chord among bad ones is still a rebind.
    load([{ key: 'shortcut_main_edit', value: 'nonsense|ctrl+y' }]);
    assert.equal(display('main.edit'), 'Ctrl+Y');
    assert.equal(warnings().length, 1);
});

test('a chord claimed twice is reported, and the earlier action wins', () => {
    loadMap({ shortcut_main_reveal: 'ctrl+c' });
    assert.equal(actionFor(ev('c', 'c')), 'main.copy', 'copy comes first in the catalog');
    assert.equal(warnings().length, 1);
    assert.match(warnings()[0], /Ctrl\+C is bound to both main\.copy and main\.reveal/);
});

test('actionFor finds the action behind an event, or null', () => {
    assert.equal(actionFor(ev('e', 'c')), 'main.edit');
    assert.equal(actionFor(ev('p', 'cs')), 'main.clearPicks');
    assert.equal(actionFor(ev('p', 'c')), 'main.pick');
    assert.equal(actionFor(ev('Enter', 's', 'Enter')), 'main.openPicked');
    assert.equal(actionFor(ev('Enter', 'c', 'Enter')), 'main.webSearch');
    assert.equal(actionFor(ev('q', 'c')), null);
    assert.equal(actionFor(ev('e', '')), null, 'plain typing is never a shortcut');
    assert.equal(actionFor(ev('p', 's'), false), null);
    assert.equal(actionFor(ev('p', 'c'), true), 'main.clearPicks', 'latched Shift');
});

test('applyConfig loads, relabels and hands back the problems for one banner line', () => {
    const capsules = [{ dataset: { shortcut: 'main.edit' }, textContent: 'Ctrl+E' }];
    const root = { querySelectorAll: () => capsules };
    const problems = shortcuts.applyConfig(
        [
            { key: 'shortcut_main_edit', value: 'alt+e' },
            { key: 'shortcut_main_pick', value: 'ctrl+banana' },
            { key: 'shortcut_main_trash', value: 'also nonsense' },
        ],
        root,
    );
    assert.equal(capsules[0].textContent, 'Alt+E');
    assert.equal(problems.length, 2);
    assert.match(shortcuts.describeProblems(problems), /shortcut_main_pick.* \(and 1 more\)$/);
    assert.equal(shortcuts.describeProblems([]), null);
    assert.equal(shortcuts.describeProblems(['only one']), 'only one');
});

test('labelAll rewrites the capsules of the screens that list shortcuts', () => {
    load([{ key: 'shortcut_main_reveal', value: 'ctrl+r' }]);
    const capsules = [
        { dataset: { shortcut: 'main.reveal' }, textContent: 'Ctrl+F' },
        { dataset: { shortcut: 'main.copy' }, textContent: 'old' },
        { dataset: { shortcut: 'no.such' }, textContent: 'left alone' },
    ];
    labelAll({ querySelectorAll: () => capsules });
    assert.deepEqual(
        capsules.map((c) => c.textContent),
        ['Ctrl+R', 'Ctrl+C', 'left alone'],
    );
});
