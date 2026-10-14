import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outline, landmarks, readJump, readKind, offsetOfLine } from '../src/js/screens/commands/note-outline.js';

const note = '# Title\ntext\n## Intro\n```\n# not a heading\n```\n### Deep one ###\n\n## Outro';

test('the outline lists headings with their line and level, and skips code', () => {
    assert.deepEqual(outline(note), [
        { line: 0, level: 1, title: 'Title' },
        { line: 2, level: 2, title: 'Intro' },
        { line: 6, level: 3, title: 'Deep one' },
        { line: 8, level: 2, title: 'Outro' },
    ]);
    assert.deepEqual(outline('#nospace\n#\n'), []);
});

test('a number is a line, held to the lines there are; words filter the headings', () => {
    const items = outline(note);
    assert.deepEqual(readJump('3', items, 9), { line: 2 });
    assert.deepEqual(readJump(':5', items, 9), { line: 4 });
    assert.deepEqual(readJump('0', items, 9), { line: 0 });
    assert.deepEqual(readJump('9999', items, 9), { line: 8 });
    assert.deepEqual(readJump('o', items, 9).headings.map((h) => h.title), ['Outro', 'Intro', 'Deep one'], 'a title that starts with it first');
    assert.deepEqual(readJump('', items, 9).headings.length, 4, 'nothing typed lists them all');
    assert.deepEqual(readJump('zzz', items, 9).headings, []);
});

test('the start of a line, as an offset', () => {
    assert.equal(offsetOfLine('ab\ncd\nef', 0), 0);
    assert.equal(offsetOfLine('ab\ncd\nef', 2), 6);
    assert.equal(offsetOfLine('ab\ncd', 9), 5, 'past the end is the end');
});

const mixed = [
    '# Plan', '', '- [ ] buy milk #home', '- [x] call Bo', '', '> a quote', '> still the same quote', '',
    '> [!TIP] remember', '', '| Name | Qty |', '| --- | --- |', '| a | 1 |', '',
    '![cat|200](pics/cat.png) and [docs](https://x.io/docs) or https://y.io/#top', '', '```ts', 'const a = 1;', '```', '<!-- todo later -->',
].join('\n');

test('landmarks finds every kind, once, in order', () => {
    const got = landmarks(mixed).map((l) => `${l.line}:${l.kind}:${l.title}`);
    assert.deepEqual(got, [
        '0:heading:Plan',
        '2:task:buy milk #home',
        '2:tag:#home',
        '3:task:call Bo',
        '5:quote:a quote',
        '8:alert:Tip  remember',
        '10:table:Name | Qty',
        '14:image:cat',
        '14:link:docs',
        '14:link:https://y.io/#top',
        '16:code:ts  const a = 1;',
        '19:comment:todo later',
    ]);
    assert.equal(landmarks(mixed).find((l) => l.title === 'call Bo').done, true);
});

test('code is code: nothing inside a block is read as anything else', () => {
    const got = landmarks('```\n# not a heading\n- [ ] not a task #nottag\n```\n## real');
    assert.deepEqual(got.map((l) => l.kind), ['code', 'heading']);
});

test('a kind word picks the kind; the rest narrows it; no kind and no words is the headings', () => {
    const all = landmarks(mixed);
    const titles = (q) => readJump(q, all, 20).items.map((i) => i.title);
    assert.deepEqual(titles(''), ['Plan']);
    assert.deepEqual(titles('task'), ['buy milk #home', 'call Bo']);
    assert.deepEqual(titles('done'), ['call Bo']);
    assert.deepEqual(titles('tasks milk'), ['buy milk #home']);
    assert.deepEqual(titles('tag'), ['#home']);
    assert.deepEqual(titles('img'), ['cat']);
    assert.deepEqual(titles('links'), ['docs', 'https://y.io/#top']);
    assert.deepEqual(titles('code'), ['ts  const a = 1;']);
    assert.deepEqual(titles('table'), ['Name | Qty']);
    assert.deepEqual(titles('quote'), ['a quote']);
    assert.deepEqual(titles('alert'), ['Tip  remember']);
    assert.deepEqual(titles('comment'), ['todo later']);
    assert.deepEqual(titles('h1'), ['Plan']);
    assert.deepEqual(titles('h2'), []);
    // No kind but some words: everything is searched.
    assert.deepEqual(titles('milk'), ['buy milk #home']);
    // Two letters that start two kinds (ta: task, table, tag) are not a kind.
    assert.equal(readKind('ta').kind, null);
    assert.equal(readKind('tab').kind, 'table');
});
