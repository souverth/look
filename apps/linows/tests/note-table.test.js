import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableEnter, tableTab, tableMove } from '../src/js/screens/commands/note-table.js';

const apply = (text, r) => text.slice(0, r.from) + r.insert + text.slice(r.to);
const at = (text, r) => [text.slice(0, r.select[0]) + '^' + text.slice(r.select[0]), r];

test('Enter on a typed header builds the table, fitted to its content', () => {
    const text = 'intro\n|column 1| column 2|';
    const r = tableEnter(text, text.length, text.length);
    const out = apply(text, r);
    assert.equal(
        out,
        'intro\n| column 1 | column 2 |\n| -------- | -------- |\n|          |          |',
    );
    // the caret lands in the first cell of the new row
    assert.equal(r.select[0], out.lastIndexOf('\n') + 1 + 2);
});

test('Enter on a filled row re-fits the columns and opens a row under it', () => {
    const text = '| column 1 | column 2 |\n| -------- | -------- |\n|   dev    | dev   |';
    const r = tableEnter(text, text.length, text.length);
    assert.equal(
        apply(text, r),
        '| column 1 | column 2 |\n| -------- | -------- |\n| dev      | dev      |\n|          |          |',
    );
});

test('a column grows to its widest cell', () => {
    const text = '| a | b |\n| - | - |\n| a much longer cell | x |';
    const out = apply(text, tableEnter(text, text.length, text.length));
    assert.match(out, /^\| a {17} \| b {2} \|$/m);
    assert.match(out, /^\| -{18} \| -{3} \|$/m);
});

test('Enter on an empty body row leaves the table', () => {
    const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n|   |   |';
    const r = tableEnter(text, text.length, text.length);
    assert.equal(apply(text, r), '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n');
    assert.equal(r.select[0], apply(text, r).length);
});

test('Enter elsewhere is left alone', () => {
    assert.equal(tableEnter('plain', 5, 5), null);
    assert.equal(tableEnter('| a | b |', 3, 3), null, 'caret not at the end of the row');
    assert.equal(tableEnter('| a | b |\n| - | - |', 3, 3), null);
});

test('alignment colons survive a re-layout', () => {
    const text = '| a | b |\n| :-: | --: |\n| 1 | 2 |';
    const out = apply(text, tableEnter(text, text.length, text.length));
    assert.match(out, /\| :-: \| --: \|/);
});

test('Tab steps cell to cell, re-fits, and adds a row at the end', () => {
    const text = '| a | b |\n| --- | --- |\n| longer | 2 |';
    const first = tableTab(text, 24, 24);
    const [shown] = at(text, first);
    assert.ok(apply(text, first).includes('| longer | 2   |') || apply(text, first).includes('| longer | 2 |'));
    assert.ok(first.select[0] > 0);
    const end = text.length;
    const last = tableTab(text, end - 2, end - 2);
    assert.equal(apply(text, last).split('\n').length, 4, 'a new row was added');
    const back = tableTab(text, 25, 25, true);
    assert.ok(back, 'Shift+Tab moves back');
    assert.equal(tableTab('no table here', 3, 3), null);
});

test('Alt+Arrows walk the cells and rows, and stay put at an edge', () => {
    const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const at = (pos, dir) => tableMove(text, pos, pos, dir);
    const cellOf = (r) => r.select[0];
    const out = (r) => text.slice(0, r.from) + r.insert + text.slice(r.to);
    const first = text.indexOf('1');
    const right = at(first, 'right');
    assert.equal(out(right)[cellOf(right)], '2');
    const down = at(first, 'down');
    assert.equal(out(down)[cellOf(down)], '3');
    const up = at(first, 'up');
    assert.equal(out(up)[cellOf(up)], 'a', 'up skips the separator row');
    assert.equal(at(text.indexOf('a'), 'up'), null, 'nothing above the header');
    assert.equal(at(text.lastIndexOf('4'), 'down'), null, 'nothing below the last row');
    assert.equal(at(text.indexOf('2'), 'left') && out(at(text.indexOf('2'), 'left'))[cellOf(at(text.indexOf('2'), 'left'))], '1');
});
