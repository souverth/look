import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toneOf, windowName, tokens, noteTitle } from '../src/js/components/superactions-format.js';

test('a quota turns warn at 60 and danger at 85', () => {
    assert.equal(toneOf(0), null);
    assert.equal(toneOf(59.9), null);
    assert.equal(toneOf(60), 'warn');
    assert.equal(toneOf(84.9), 'warn');
    assert.equal(toneOf(85), 'danger');
    assert.equal(toneOf(100), 'danger');
});

test('windows get the short name a bar wears', () => {
    assert.equal(windowName('5-hour limit'), '5h');
    assert.equal(windowName('5 hour limit'), '5h');
    assert.equal(windowName('Weekly limit'), 'Week');
    assert.equal(windowName('Weekly limit (Opus)'), 'Opus');
    assert.equal(windowName('Weekly limit (Sonnet)'), 'Sonnet');
    assert.equal(windowName('Daily limit'), 'Day');
    assert.equal(windowName('Monthly spend limit'), 'Monthly spend');
    assert.equal(windowName(''), 'Quota');
    assert.equal(windowName(), 'Quota');
});

test('token counts are compact', () => {
    assert.equal(tokens(0), '0');
    assert.equal(tokens(999), '999');
    assert.equal(tokens(1000), '1K');
    assert.equal(tokens(148_000), '148K');
    assert.equal(tokens(1_234_567), '1.2M');
});

test('a note is headed by its title, else its first line, else Untitled', () => {
    assert.equal(noteTitle({ title: '  Plan ', body: 'x' }), 'Plan');
    assert.equal(noteTitle({ title: '', body: '\n\n  buy milk\nmore' }), 'buy milk');
    assert.equal(noteTitle({ title: '', body: '' }), 'Untitled');
    assert.equal(noteTitle({ title: '', body: 'x'.repeat(100) }).length, 60);
});
