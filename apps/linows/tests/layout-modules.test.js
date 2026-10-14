import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    overlaps,
    inside,
    fits,
    findSpot,
    titleCase,
} from '../src/js/screens/layout-grid.js';
import { createHistory } from '../src/js/screens/layout-history.js';

const draft = {
    columns: 4,
    rows: 2,
    tiles: [
        { id: 'a', col: 0, row: 0, w: 2, h: 1 },
        { id: 'b', col: 2, row: 0, w: 1, h: 2 },
    ],
};

test('rectangles overlap only when they share a cell', () => {
    const a = { col: 0, row: 0, w: 2, h: 1 };
    assert.ok(overlaps(a, { col: 1, row: 0, w: 2, h: 1 }));
    assert.ok(!overlaps(a, { col: 2, row: 0, w: 1, h: 1 }), 'touching edges is not overlap');
    assert.ok(!overlaps(a, { col: 0, row: 1, w: 2, h: 1 }));
});

test('a rectangle is inside when it is real and wholly on the grid', () => {
    assert.ok(inside({ col: 0, row: 0, w: 4, h: 2 }, draft));
    assert.ok(!inside({ col: 3, row: 0, w: 2, h: 1 }, draft), 'runs off the right edge');
    assert.ok(!inside({ col: 0, row: 1, w: 1, h: 2 }, draft), 'runs off the bottom');
    assert.ok(!inside({ col: -1, row: 0, w: 1, h: 1 }, draft));
    assert.ok(!inside({ col: 0, row: 0, w: 0, h: 1 }, draft), 'no empty tiles');
});

test('a tile fits unless it lands on another, and may ignore itself', () => {
    assert.ok(fits({ col: 3, row: 0, w: 1, h: 2 }, draft));
    assert.ok(!fits({ col: 1, row: 0, w: 2, h: 1 }, draft));
    // Moving tile `a` one cell right would overlap only itself.
    assert.ok(fits({ col: 1, row: 0, w: 1, h: 1 }, draft, ['a']));
    assert.ok(!fits({ col: 1, row: 0, w: 2, h: 1 }, draft, ['a']), 'still hits b');
});

test('the first free spot reads left to right, then down', () => {
    assert.deepEqual(findSpot(draft, 1, 1), { col: 3, row: 0 }, 'row 0 has one free cell');
    assert.deepEqual(findSpot(draft, 2, 1), { col: 0, row: 1 }, 'too wide for row 0, so down');
    assert.deepEqual(findSpot(draft, 1, 2), { col: 3, row: 0 });
    assert.equal(findSpot(draft, 3, 1), null, 'nothing that wide is free');
    assert.deepEqual(findSpot({ columns: 2, rows: 1, tiles: [] }, 2, 1), { col: 0, row: 0 });
});

test('a custom tile with no title is named from its id', () => {
    assert.equal(titleCase('my-cool_tile'), 'My Cool Tile');
    assert.equal(titleCase('--x'), 'X');
});

test('undo and redo walk the draft back and forth', () => {
    const h = createHistory(10);
    assert.ok(!h.canUndo() && !h.canRedo());
    assert.equal(h.undo('now'), null);

    h.record('v1'); // edited away from v1
    h.record('v2'); // edited away from v2; the draft is now v3
    assert.ok(h.canUndo() && !h.canRedo());
    assert.equal(h.undo('v3'), 'v2');
    assert.equal(h.undo('v2'), 'v1');
    assert.equal(h.undo('v1'), null);
    assert.ok(h.canRedo());
    assert.equal(h.redo('v1'), 'v2');
    assert.equal(h.redo('v2'), 'v3');
    assert.equal(h.redo('v3'), null);
});

test('a new edit ends the redo trail, and the history is capped', () => {
    const h = createHistory(3);
    ['a', 'b', 'c'].forEach((v) => h.record(v));
    h.undo('d');
    assert.ok(h.canRedo());
    h.record('c2');
    assert.ok(!h.canRedo());

    const capped = createHistory(2);
    ['a', 'b', 'c'].forEach((v) => capped.record(v));
    assert.equal(capped.undo('d'), 'c');
    assert.equal(capped.undo('c'), 'b');
    assert.equal(capped.undo('b'), null, 'the oldest step fell off');

    capped.record('x');
    capped.clear();
    assert.ok(!capped.canUndo() && !capped.canRedo());
});
