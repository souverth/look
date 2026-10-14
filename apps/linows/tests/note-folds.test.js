import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldRegions, layout, toSource, toDisplay, applyDisplayEdit, shiftFolds, foldsTouched } from '../src/js/screens/commands/note-folds.js';

const note = [
    '# One', //        0
    'intro', //        1
    '', //             2
    '## Two', //       3
    '- a', //          4
    '  - b', //        5
    '  - c', //        6
    '- d', //          7
    '', //             8
    '```ts', //        9
    '# not a heading', // 10
    '```', //          11
    '', //             12
    '# Three', //      13
    '> q1', //         14
    '> q2', //         15
    '', //             16
    '| h |', //        17
    '| - |', //        18
    '| x |', //        19
].join('\n');

const regions = (text) => foldRegions(text).map((r) => `${r.start}-${r.end}:${r.kind}`);

test('what can fold: headings, code, list items with children, quotes, tables, details', () => {
    assert.deepEqual(regions(note), [
        '0-11:heading',
        '3-11:heading',
        '4-6:list',
        '9-11:code',
        '13-19:heading',
        '14-15:quote',
        '17-19:table',
    ]);
});

test('a heading folds up to the next of its level or higher, not through blank lines at its end', () => {
    const r = foldRegions('# A\nx\n\n## B\ny\n\n# C\nz');
    assert.deepEqual(r.map((x) => [x.start, x.end]), [[0, 4], [3, 4], [6, 7]]);
    assert.deepEqual(foldRegions('# only a heading'), []);
    assert.deepEqual(foldRegions('```\nunclosed\ncode').map((x) => [x.start, x.end]), [[0, 2]]);
    assert.deepEqual(foldRegions('<details>\nbody\n</details>').map((x) => [x.start, x.end]), [[0, 2]]);
});

test('with folds the display leaves their lines out', () => {
    const map = layout(note, new Set([4, 9]));
    const shown = map.display.split('\n');
    assert.equal(shown.length, 20 - 4);
    assert.ok(shown.includes('- a') && !shown.includes('  - b') && !shown.includes('# not a heading'));
    assert.deepEqual([...map.effective], [[4, 6], [9, 11]]);
});

test('a fold inside a fold is not in force; one with no region is ignored', () => {
    const map = layout(note, new Set([3, 9, 99]));
    assert.deepEqual([...map.effective.keys()], [3]);
    assert.equal(map.display.split('\n').length, 12);
});
test('offsets round-trip on every shown line', () => {
    const map = layout(note, new Set([4, 9, 14]));
    for (const row of map.visible) {
        for (const col of [0, Math.floor(row.length / 2), row.length]) {
            assert.equal(toSource(map, toDisplay(map, row.src + col)), row.src + col);
            assert.equal(toDisplay(map, toSource(map, row.disp + col)), row.disp + col);
        }
    }
});

test('an edit on a shown line is carried into the note and every hidden line survives', () => {
    const folded = new Set([4, 9]);
    const map = layout(note, folded);
    const lines = map.display.split('\n');
    // typing on "intro", which is a shown line
    const at = map.display.indexOf('intro');
    const after = map.display.slice(0, at + 5) + ' there' + map.display.slice(at + 5);
    const edit = applyDisplayEdit(note, map, after);
    assert.equal(edit.source, note.replace('intro', 'intro there'));
    assert.equal(edit.delta, 0);
    // adding a line (Enter) shifts the folds below it
    const enter = map.display.slice(0, at + 5) + '\n' + map.display.slice(at + 5);
    const e2 = applyDisplayEdit(note, map, enter);
    assert.equal(e2.delta, 1);
    assert.equal(e2.source.split('\n').length, note.split('\n').length + 1);
    assert.deepEqual([...shiftFolds(folded, e2.line, e2.delta)].sort((a, b) => a - b), [5, 10]);
    for (const hidden of ['- a', '  - b', '  - c', '# not a heading']) assert.ok(e2.source.includes(hidden));
    assert.ok(lines.length > 5);
});

test('removing whole shown lines keeps the hidden ones, and an edit that would span a hidden line is refused', () => {
    const map = layout(note, new Set([4]));
    const keep = map.display.split('\n').filter((l) => l !== 'intro').join('\n');
    const ok = applyDisplayEdit(note, map, keep);
    assert.ok(ok && !ok.source.includes('intro') && ok.source.includes('  - b') && ok.source.includes('- d'));
    // from the middle of "- a" to the middle of "- d": the folded "  - b" and "  - c" are between
    const start = map.display.indexOf('- a') + 1;
    const end = map.display.indexOf('- d') + 1;
    assert.equal(applyDisplayEdit(note, map, map.display.slice(0, start) + map.display.slice(end)), null);
});

test('the folds an edit would touch: the lines its range is on, and a delete reaches the break around it', () => {
    const map = layout(note, new Set([4]));
    const at = (needle) => map.display.indexOf(needle);
    const touched = (a, b = a) => foldsTouched(map, map.display, a, b);
    assert.deepEqual(touched(at('- a') + 1), [4], 'typing on its line');
    assert.deepEqual(touched(at('- d')), [], 'typing at the start of the line after is safe');
    assert.deepEqual(touched(at('- d') - 1, at('- d') + 1), [4], 'backspace at the start of the line after reaches the fold line');
    assert.deepEqual(touched(at('## Two') + 6), [], 'typing at the end of the line before is safe');
    assert.deepEqual(touched(at('## Two') + 6, at('## Two') + 7), [4], 'delete at the end of the line before reaches the fold line');
    assert.deepEqual(touched(at('intro')), [], 'two lines up is safe');
    assert.deepEqual(touched(at('intro'), at('- d')), [4], 'a selection across it');
});

test('carets after an edit are found in the edited note', () => {
    const map = layout(note, new Set([4]));
    const at = map.display.indexOf('intro') + 2;
    const after = map.display.slice(0, at) + 'XYZ' + map.display.slice(at);
    const edit = applyDisplayEdit(note, map, after);
    // before the edit, inside it, after it (the later line "- d" lies past the fold)
    assert.equal(edit.source.slice(edit.toNewSource(1), edit.toNewSource(1) + 3), '# O'.slice(1) + 'n', 'before the edit');
    assert.equal(edit.toNewSource(at + 3), edit.source.indexOf('inXYZtro') + 2 + 3, 'right after what was typed');
    const dAt = after.indexOf('- d');
    assert.equal(edit.source.slice(edit.toNewSource(dAt), edit.toNewSource(dAt) + 3), '- d', 'a line below the fold');
    assert.equal(edit.source.slice(edit.toNewSource(after.length)), '', 'the end is the end');
});

test('random edits on shown lines never lose a line that is hidden at the time', () => {
    let seed = 7;
    const rand = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
    };
    // The lines the display leaves out, as a count of each text.
    const hiddenNow = (source, map) => {
        const shown = new Set(map.visible.map((r) => r.line));
        const counts = new Map();
        source.split('\n').forEach((line, i) => {
            if (!shown.has(i)) counts.set(line, (counts.get(line) || 0) + 1);
        });
        return counts;
    };
    const countIn = (source, line) => source.split('\n').filter((l) => l === line).length;
    for (let round = 0; round < 400; round++) {
        let source = note;
        let folded = new Set([4, 9, 14]);
        for (let step = 0; step < 8; step++) {
            const map = layout(source, folded);
            const row = map.visible[rand(map.visible.length)];
            // never on a fold line: those open first
            if (map.effective.has(row.line)) continue;
            const at = row.disp + rand(row.length + 1);
            const kind = rand(3);
            let after;
            if (kind === 0) after = map.display.slice(0, at) + 'xy' + map.display.slice(at);
            else if (kind === 1) after = map.display.slice(0, at) + '\n' + map.display.slice(at);
            else after = at > row.disp ? map.display.slice(0, at - 1) + map.display.slice(at) : map.display;
            const edit = applyDisplayEdit(source, map, after);
            assert.ok(edit, 'an edit on one shown line is always carried');
            for (const [line, n] of hiddenNow(source, map)) {
                assert.ok(countIn(edit.source, line) >= n, `"${line}" kept (round ${round}, step ${step})`);
            }
            source = edit.source;
            folded = shiftFolds(folded, edit.line, edit.delta);
        }
    }
});