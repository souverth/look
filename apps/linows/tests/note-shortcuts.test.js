import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, chordsOf, filterShortcuts } from '../src/js/screens/commands/note-shortcuts.js';
import { setHeading, toggleBlockComment } from '../src/js/screens/commands/note-lines.js';
import { findCommentBlocks, renderMarkdown } from '../src/js/markdown.js';
import { landmarks } from '../src/js/screens/commands/note-outline.js';
import { foldRegions } from '../src/js/screens/commands/note-folds.js';
import { highlightLines } from '../src/js/screens/commands/note-syntax.js';

test('no entry of the shortcut list is there twice', () => {
    const seen = new Set();
    for (const { group, items } of SHORTCUTS) {
        for (const item of items) {
            // The same chord may mean something in each place (Enter on an item, in a table),
            // so what is told apart is the chord with what it does.
            for (const chord of chordsOf(item)) {
                const key = `${group}|${chord}|${item[1]}`;
                assert.ok(!seen.has(key), `${chord} (${item[1]}) is listed twice in ${group}`);
                seen.add(key);
            }
        }
    }
    assert.ok(seen.size > 80);
});

test('every key the editor answers to is in the list', () => {
    const listed = new Set(SHORTCUTS.flatMap((g) => g.items.flatMap(chordsOf)));
    const wanted = [
        // format
        'Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Ctrl+Shift+X', 'Ctrl+Shift+M', 'Ctrl+`', 'Ctrl+K',
        // blocks and levels
        'Ctrl+Shift+7', 'Ctrl+Shift+8', 'Ctrl+Shift+9', 'Ctrl+Shift+.', 'Ctrl+Shift+B', 'Ctrl+]', 'Ctrl+[', 'Tab', 'Shift+Tab',
        // lines and comments
        'Alt+Up', 'Alt+Down', 'Alt+Enter', 'Shift+Alt+Up', 'Shift+Alt+Down', 'Ctrl+Shift+K', 'Ctrl+Enter',
        'Ctrl+Shift+Enter', 'Ctrl+J', 'Ctrl+L', 'Ctrl+/', 'Alt+Shift+A',
        // tables
        'Alt+Left', 'Alt+Right',
        // go to and fold
        'Ctrl+G', 'Ctrl+Shift+O', 'Ctrl+Shift+[', 'Ctrl+Shift+]', 'Alt+Shift+[', 'Alt+Shift+]',
        // the note
        'Ctrl+S', 'Ctrl+E', 'Ctrl+\\', 'Ctrl+N', 'F1', 'Esc', 'Home', 'End',
    ];
    const missing = wanted.filter((chord) => ![...listed].some((l) => l === chord || l.split(' ').includes(chord)));
    assert.deepEqual(missing, []);
});

test('every entry has keys and a description, and the groups are all there', () => {
    assert.deepEqual(SHORTCUTS.map((g) => g.group), [
        'Format', 'Blocks', 'Lists and levels', 'Lines', 'Comments', 'Tables', 'Go to and fold', 'Code blocks',
        'Complete', 'Edit', 'Pictures', 'Note', 'Notes list', 'Templates', 'Go to box',
    ]);
    for (const { items } of SHORTCUTS) for (const [keys, what] of items) assert.ok(keys.trim() && what.trim());
});
test('searching the list narrows it by keys, description or group', () => {
    const names = (q) => filterShortcuts(q).map((g) => g.group);
    assert.equal(filterShortcuts('').length, SHORTCUTS.length);
    assert.ok(names('fold').includes('Go to and fold'));
    assert.ok(names('ctrl+g').includes('Go to and fold'));
    assert.ok(names('table').includes('Tables'));
    assert.deepEqual(filterShortcuts('zzzz'), []);
    assert.ok(filterShortcuts('move').flatMap((g) => g.items).some(([keys]) => keys.includes('Alt+Up')));
});

test('Ctrl+Shift+1..6 sets the level, changes another, and takes it off again', () => {
    const run = (text, level, pos = 0) => {
        const r = setHeading(text, pos, pos, level);
        return text.slice(0, r.from) + r.insert + text.slice(r.to);
    };
    assert.equal(run('Title', 2), '## Title');
    assert.equal(run('# Title', 3), '### Title');
    assert.equal(run('## Title', 2), 'Title', 'again to remove');
    assert.equal(run('a\nb', 1), '# a\nb', 'one line, the caret line');
    const two = setHeading('a\n\nb', 0, 4, 1);
    assert.equal('a\n\nb'.slice(0, two.from) + two.insert + 'a\n\nb'.slice(two.to), '# a\n\n# b');
});

test('a comment over several lines: found, wrapped, taken off, hidden in the preview', () => {
    const note = 'a\n<!--\nhidden\nmore\n-->\nb\n```\n<!--\nnot a comment\n```\n<!-- open';
    assert.deepEqual(findCommentBlocks(note.split('\n')), [{ start: 1, end: 4 }], 'fenced and unclosed ones do not count');
    assert.equal(renderMarkdown(note.split('\n').slice(0, 6).join('\n')), '<p>a</p><p>b</p>');
    assert.ok(landmarks(note).some((l) => l.kind === 'comment' && l.line === 1 && l.title.includes('hidden')));
    assert.ok(foldRegions(note).some((r) => r.kind === 'comment' && r.start === 1 && r.end === 4));
    const lines = highlightLines(note);
    assert.ok([1, 2, 3, 4].every((i) => /tok-quote/.test(lines[i])), 'every line of it is coloured as a comment');
});

test('Alt+Shift+A wraps lines in one comment and takes it off again', () => {
    const run = (text, a, b = a) => {
        const r = toggleBlockComment(text, a, b);
        return text.slice(0, r.from) + r.insert + text.slice(r.to);
    };
    assert.equal(run('one\ntwo\nthree', 0, 7), '<!--\none\ntwo\n-->\nthree');
    assert.equal(run('  keep indent', 3), '  <!--\n  keep indent\n  -->');
    // the whole comment selected, or just the lines between its markers
    assert.equal(run('<!--\nx\ny\n-->', 0, 12), 'x\ny');
    assert.equal(run('<!--\nx\ny\n-->\nafter', 5, 8), 'x\ny\nafter');
    const r = toggleBlockComment('one\ntwo', 0, 7);
    assert.equal('one\ntwo'.slice(0, r.from) + r.insert, '<!--\none\ntwo\n-->');
    assert.equal(r.select[0], 5, 'the commented lines stay selected');
});