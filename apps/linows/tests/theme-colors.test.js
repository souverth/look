import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LOOK_COLORS, NOTE_COLORS, namesOf, parseColor, toHex, normalizeColor, withAlpha, encodeColors, decodeColors, contrast,
} from '../src/js/theme-colors.js';

test('colours are read from every form CSS or a browser gives them', () => {
    assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseColor('#1e1e2e'), { r: 30, g: 30, b: 46, a: 1 });
    assert.equal(Math.round(parseColor('#00000080').a * 255), 128);
    assert.deepEqual(parseColor('rgb(49, 50, 68)'), { r: 49, g: 50, b: 68, a: 1 });
    assert.deepEqual(parseColor('rgba(49, 50, 68, 0.5)'), { r: 49, g: 50, b: 68, a: 0.5 });
    assert.deepEqual(parseColor('rgb(0 0 0 / 40%)'), { r: 0, g: 0, b: 0, a: 0.4 });
    const mixed = parseColor('color(srgb 0.152941 0.27451 0.258824 / 0.5)');
    assert.deepEqual([mixed.r, mixed.g, mixed.b].map(Math.round), [39, 70, 66]);
    assert.equal(mixed.a, 0.5);
    for (const bad of ['', 'red', 'var(--x)', 'linear-gradient(red, blue)', '#12', '#ggg', null, undefined]) {
        assert.equal(parseColor(bad), null, String(bad));
    }
});

test('colours are written as hex, with the opacity only when there is some to say', () => {
    assert.equal(toHex({ r: 30, g: 30, b: 46, a: 1 }), '#1e1e2e');
    assert.equal(toHex({ r: 0, g: 0, b: 0, a: 0.5 }), '#00000080');
    assert.equal(normalizeColor('rgba(255, 255, 255, 0.1)'), '#ffffff1a');
    assert.equal(normalizeColor('  #ABC  '), '#aabbcc');
    assert.equal(normalizeColor('nope'), null);
    assert.equal(withAlpha('#89b4fa', 0.5), '#89b4fa80');
    assert.equal(withAlpha('#89b4fa80', 1), '#89b4fa');
});

test('a set of colours goes into one config line and comes back, and only known colours do', () => {
    const colors = { '--accent-color': '#89b4fa', '--panel-fill': 'rgba(49, 50, 68, 0.5)', '--not-a-var': '#fff', '--font-muted': 'banana' };
    const line = encodeColors(colors, LOOK_COLORS);
    assert.equal(line, '--accent-color:#89b4fa;--panel-fill:#31324480');
    assert.ok(!line.includes(' '), 'no spaces: a # after one would start a comment in the config file');
    assert.deepEqual(decodeColors(line, LOOK_COLORS), { '--accent-color': '#89b4fa', '--panel-fill': '#31324480' });
    assert.deepEqual(decodeColors('--accent-color:#zzz;junk;;--color-danger:#f00', LOOK_COLORS), { '--color-danger': '#ff0000' });
    assert.deepEqual(decodeColors('', LOOK_COLORS), {});
    assert.deepEqual(decodeColors(undefined, NOTE_COLORS), {});
});

test('the catalogs list each variable once', () => {
    for (const catalog of [LOOK_COLORS, NOTE_COLORS]) {
        const names = namesOf(catalog);
        assert.equal(new Set(names).size, names.length);
        assert.ok(names.every((n) => /^--[a-z0-9-]+$/.test(n)));
    }
    assert.ok(namesOf(NOTE_COLORS).includes('--tok-h6') && namesOf(NOTE_COLORS).includes('--lv5'));
    assert.ok(namesOf(LOOK_COLORS).includes('--accent-color'));
});

test('contrast tells readable from not', () => {
    assert.ok(contrast('#000000', '#ffffff') > 20);
    assert.ok(contrast('#777777', '#808080') < 1.5);
    assert.equal(contrast('x', '#fff'), null);
});
