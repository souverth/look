import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    noteResult,
    taskResult,
    taskDayLabel,
    placeMemoRows,
    MEMO_ROWS_AFTER,
    classifyResultId,
    isSyntheticResultId,
    isPrefixedQuery,
    prefixSuggestionResults,
    NOTES_PREFIX,
} from '../src/js/catalog.js';

const noteHit = (over = {}) => ({
    id: 'n1',
    title: 'Trip',
    snippet: 'book the train',
    tags: ['travel'],
    score: 6000,
    updated_at_unix_s: 1,
    ...over,
});

test('a note row names the line it matched on and its tags', () => {
    const row = noteResult(noteHit());
    assert.equal(row.title, 'Trip');
    assert.equal(row.subtitle, 'Note  ·  book the train  ·  #travel');
    assert.equal(row.path, 'Trip', 'Ctrl+C copies the title');
    assert.equal(noteResult(noteHit({ snippet: '', tags: [] })).subtitle, 'Note');
});

test('note and task rows classify as memo rows, so actions skip them', () => {
    const note = noteResult(noteHit({ id: 'abc:1' }));
    assert.deepEqual(classifyResultId(note.id), { kind: 'memo', target: 'note', id: 'abc:1' });
    const hit = { id: 't9', name: 'Pay rent', due_date: '2026-10-13', score: 1 };
    const task = taskResult(hit, '2026-10-13', '2026-10-14');
    assert.deepEqual(classifyResultId(task.id), { kind: 'memo', target: 'task', id: 't9' });
    assert.ok(isSyntheticResultId(note.id) && isSyntheticResultId(task.id));
});

test('a task is labelled by its day relative to today', () => {
    const today = '2026-10-13';
    const tomorrow = '2026-10-14';
    assert.equal(taskDayLabel('2026-10-13', today, tomorrow), 'today');
    assert.equal(taskDayLabel('2026-10-14', today, tomorrow), 'tomorrow');
    assert.equal(taskDayLabel('2026-10-20', today, tomorrow), 'Oct 20');
    assert.equal(taskDayLabel('2026-10-11', today, tomorrow), 'Oct 11, late');
    const hit = { id: 't', name: 'Pay rent', due_date: today, score: 1 };
    const row = taskResult(hit, today, tomorrow);
    assert.equal(row.subtitle, 'Task  ·  today');
});

test('notes sit below the best local matches, never above them', () => {
    const local = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    const memo = [{ id: 'm1' }, { id: 'm2' }];
    const placed = placeMemoRows(memo, local).map((r) => r.id);
    assert.deepEqual(placed.slice(0, MEMO_ROWS_AFTER), ['a', 'b', 'c']);
    assert.deepEqual(placed, ['a', 'b', 'c', 'm1', 'm2', 'd', 'e']);
    // Fewer local rows than the slot: notes follow them; none: notes alone.
    assert.deepEqual(placeMemoRows(memo, [{ id: 'a' }]).map((r) => r.id), ['a', 'm1', 'm2']);
    assert.deepEqual(placeMemoRows(memo, []).map((r) => r.id), ['m1', 'm2']);
    assert.equal(placeMemoRows([], local), local);
});

test('n" is a listed prefix and gates web suggestions like the others', () => {
    assert.equal(NOTES_PREFIX, 'n"');
    assert.ok(isPrefixedQuery('n"trip'));
    assert.ok(prefixSuggestionResults('"note').some((r) => r.title.startsWith('n"')));
});
