import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandTemplate, firstLine } from '../src/js/screens/commands/note-templates.js';

const wed = new Date(2026, 9, 14, 15, 7); // Wednesday 14 October 2026, 15:07

test('variables are filled in and the first {{cursor}} is where the caret lands', () => {
    const { text, caret } = expandTemplate('# {{title}}\n{{weekday}} {{date}} {{time}}\n- {{cursor}}\n- {{cursor}}', { title: 'Plan', now: wed });
    assert.equal(text, '# Plan\nWednesday 2026-10-14 15:07\n- \n- ');
    assert.equal(caret, text.indexOf('- ') + 2, 'caret after the first dash');
    assert.equal(text.slice(0, caret).split('\n').length, 3);
});

test('no {{cursor}} puts the caret at the end; unknown words stay as written', () => {
    assert.deepEqual(expandTemplate('hello {{this}}', { now: wed }), { text: 'hello {{this}}', caret: 14 });
    assert.equal(expandTemplate('{{datetime}}', { now: wed }).text, '2026-10-14 15:07');
    assert.equal(expandTemplate('{{ Date }}', { now: wed }).text, '2026-10-14', 'case and spaces are forgiven');
    assert.equal(expandTemplate('# {{title}}', { now: wed }).text, '# ', 'no title yet is nothing');
});

test('a preview line is the first one with words, without its # or caret mark', () => {
    assert.equal(firstLine('\n# Meeting notes\nmore'), 'Meeting notes');
    assert.equal(firstLine('{{cursor}}\nsecond'), 'second');
    assert.equal(firstLine(''), '');
    assert.equal(firstLine('# {{title}}\n\n## What happened\n{{cursor}}'), 'What happened', 'a line of only variables is passed over');
    assert.equal(firstLine('{{weekday}}, {{date}}'), '{{weekday}}, {{date}}', 'unless nothing else is there');
});
