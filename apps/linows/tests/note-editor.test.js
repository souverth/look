import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as settings from '../src/js/screens/commands/note-settings.js';
import { highlightLines, inlineHtml } from '../src/js/screens/commands/note-syntax.js';
import { SNIPPETS, GROUPS, filter, arrange } from '../src/js/screens/commands/note-slash.js';
import * as ops from '../src/js/screens/commands/note-format-ops.js';
import { renderMarkdown } from '../src/js/markdown.js';

// Applies an op's answer the way the editor does, so tests read as before/after.
function run(text, [start, end], op) {
    const r = op(text, start, end);
    const next = text.slice(0, r.from) + r.insert + text.slice(r.to);
    return { text: next, selected: next.slice(r.select[0], r.select[1]), select: r.select };
}

// --- settings ---

test('with nothing configured the note settings are the defaults', () => {
    assert.deepEqual(settings.parse([]), settings.DEFAULTS);
    assert.deepEqual(settings.parseMap({}), settings.DEFAULTS);
    assert.equal(settings.DEFAULTS.defaultView, 'edit');
});

test('note settings read what is configured and ignore what is not valid', () => {
    const parsed = settings.parseMap({
        note_default_view: 'Split',
        note_line_numbers: 'false',
        note_word_wrap: ' FALSE ',
        note_syntax_highlight: 'maybe',
        note_editor_theme: 'monokai',
        note_text_size: 'huge',
        unrelated: 'x',
    });
    assert.deepEqual(parsed, {
        defaultView: 'split',
        lineNumbers: false,
        wrap: false,
        highlight: true, // "maybe" is not a boolean: the default stays
        theme: 'monokai',
        size: 'normal', // "huge" is not a size
    });
    assert.equal(settings.parseMap({ note_editor_theme: 'nope' }).theme, 'look');
    assert.equal(settings.parseMap({ note_default_view: '' }).defaultView, 'edit');
});

test('settings turn back into config lines, and only the ones given', () => {
    assert.deepEqual(settings.toUpdates({ theme: 'vs-dark', lineNumbers: false }), {
        note_editor_theme: 'vs-dark',
        note_line_numbers: 'false',
    });
    assert.deepEqual(settings.toUpdates({}), {});
    // What is written is what is read back.
    const all = { ...settings.DEFAULTS, defaultView: 'preview', wrap: false, size: 'large' };
    assert.deepEqual(settings.parseMap(settings.toUpdates(all)), all);
    assert.ok(settings.THEMES.length >= 8 && settings.THEMES[0].id === 'look');
});

// --- syntax colouring ---

const textOf = (html) =>
    html
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

test('colouring never changes the text, only wraps it', () => {
    const doc = [
        '# Title with `code` and **bold**',
        '',
        'plain & <b>tags</b> "quoted"',
        '- [ ] a task with *italic* and ~~gone~~',
        '1. numbered with [a link](https://example.com/x?y=1&z=2)',
        '> [!WARNING]',
        '> careful with ==this==',
        '---',
        '```tsx filename="src/app.tsx"',
        'const a = <div>{"x"}</div>; // **not bold**',
        '```',
        'after the fence _emphasis_ and snake_case_name',
        '',
    ].join('\n');
    const lines = highlightLines(doc);
    assert.equal(lines.length, doc.split('\n').length, 'one entry per source line');
    doc.split('\n').forEach((line, i) => {
        assert.equal(textOf(lines[i]), line, `line ${i + 1}`);
    });
});

test('a bare heading marker is colored before the space is typed', () => {
    const [h, tag] = highlightLines('##\n#tag');
    assert.equal(h, '<span class="tok-marker">##</span>');
    assert.doesNotMatch(tag, /tok-marker/);
});

test('headings, markers, tasks and rules get their own tokens', () => {
    const [h, t, n, hr] = highlightLines('## Hi\n- [x] done\n12. step\n***');
    assert.match(h, /<span class="tok-marker">##<\/span> <span class="tok-heading">Hi<\/span>/);
    assert.match(t, /tok-marker">-<\/span> <span class="tok-task">\[x\]<\/span> done/);
    assert.match(n, /tok-marker">12\.<\/span> step/);
    assert.match(hr, /tok-hr/);
});

test('a fenced block is code until it closes, and its text is left alone', () => {
    const lines = highlightLines('```js\n# not a heading\n**not bold**\n```\n# heading');
    assert.match(lines[0], /tok-fence">```<\/span><span class="tok-info">js/);
    assert.match(lines[1], /tok-codeblock/);
    assert.ok(!lines[1].includes('tok-heading') && !lines[2].includes('tok-bold'));
    assert.match(lines[3], /tok-fence/);
    assert.match(lines[4], /tok-heading/, 'colouring resumes after the fence');
    // An unclosed fence stays code to the end instead of breaking later lines.
    assert.match(highlightLines('```\n# x')[1], /tok-codeblock/);
});

test('alerts and quotes are told apart', () => {
    const [a, q] = highlightLines('> [!TIP]\n> just a quote');
    assert.match(a, /tok-alert tok-alert-tip">\[!TIP\]/);
    assert.match(q, /tok-quote">just a quote/);
});

test('inline marks colour what they enclose, and not what only looks like one', () => {
    assert.match(inlineHtml('a `b` c'), /tok-code">`b`/);
    assert.match(inlineHtml('**b** __c__'), /tok-bold">\*\*b\*\*.*tok-bold">__c__/);
    assert.match(inlineHtml('==hi=='), /tok-mark">==hi==/);
    assert.match(inlineHtml('[t](https://x.y)'), /tok-link">\[t\]<\/span><span class="tok-url">\(https:\/\/x\.y\)/);
    assert.match(inlineHtml('*em* and _em_'), /tok-italic">\*em\*.*tok-italic">_em_/);
    for (const plain of ['snake_case_name', '2*3*4', 'a * b * c']) {
        assert.ok(!inlineHtml(plain).includes('tok-italic'), plain);
    }
    assert.equal(inlineHtml('<script>&'), '&lt;script&gt;&amp;');
});

// --- the "/" menu ---

test('the menu offers the basic blocks and the five GitHub alerts, in two groups', () => {
    assert.deepEqual(
        GROUPS.map((g) => g.label),
        ['Basic Formatting', 'GitHub Alerts'],
    );
    const labels = (group) => SNIPPETS.filter((s) => s.group === group).map((s) => s.label);
    assert.deepEqual(labels('alerts'), [
        'Caution Alert',
        'Important Alert',
        'Note Alert',
        'Tip Alert',
        'Warning Alert',
    ]);
    for (const wanted of ['Codeblock', 'Heading 1', 'Heading 4', 'Horizontal Rule', 'Ordered List', 'Task List']) {
        assert.ok(labels('basic').includes(wanted), wanted);
    }
    for (const s of SNIPPETS) {
        assert.ok(s.icon.startsWith('<svg'), `${s.label} has an icon`);
        assert.ok(String(typeof s.text === 'function' ? s.text() : s.text).length > 0);
    }
});

test('an alert types its marker and leaves the caret in the quote', () => {
    const caution = SNIPPETS.find((s) => s.key === 'caution');
    assert.equal(caution.hint, '> [!CAUTION]');
    assert.equal(caution.text, '> [!CAUTION]\n> |');
    assert.equal(caution.tone, 'caution');
    assert.equal(SNIPPETS.find((s) => s.key === 'h4').text, '#### |');
});

test('typing after the slash narrows by key, alias or label', () => {
    const keys = (q) => filter(q).map((s) => s.key);
    assert.equal(filter('').length, SNIPPETS.length);
    assert.deepEqual(keys('h4'), ['h4']);
    assert.ok(keys('head').includes('h1') && keys('head').length === 4);
    assert.deepEqual(keys('hr'), ['divider']);
    assert.ok(keys('alert').length === 5, 'the word alert finds all five');
    assert.deepEqual(keys('tip'), ['tip']);
    assert.ok(keys('ol').includes('number'));
    assert.deepEqual(keys('zzz'), []);
});

test('the menu arranges items group by group, with Up/Down indexes that match', () => {
    const { ordered, rows } = arrange(filter('') );
    const items = rows.filter((r) => r.type === 'item');
    assert.deepEqual(
        items.map((r) => r.index),
        ordered.map((_, i) => i),
    );
    assert.deepEqual(
        rows.filter((r) => r.type === 'group').map((r) => r.label),
        ['Basic Formatting', 'GitHub Alerts'],
    );
    // A search that only reaches alerts shows only that group's header.
    const onlyAlerts = arrange(filter('warn'));
    assert.deepEqual(
        onlyAlerts.rows.map((r) => r.type),
        ['group', 'item'],
    );
    // Items given out of order are shown in group order.
    const mixed = arrange([SNIPPETS.find((s) => s.key === 'tip'), SNIPPETS.find((s) => s.key === 'h1')]);
    assert.deepEqual(
        mixed.ordered.map((s) => s.key),
        ['h1', 'tip'],
    );
});

// --- selection toolbar edits ---

test('bold wraps the selection and a second press takes it off', () => {
    const wrapped = run('make bold here', [5, 9], (t, s, e) => ops.toggleInline(t, s, e, '**'));
    assert.equal(wrapped.text, 'make **bold** here');
    assert.equal(wrapped.selected, 'bold', 'the word stays selected');
    const unwrapped = run(wrapped.text, wrapped.select, (t, s, e) => ops.toggleInline(t, s, e, '**'));
    assert.equal(unwrapped.text, 'make bold here');
    // Selecting the marks too takes them off as well.
    assert.equal(run('a **b** c', [2, 7], (t, s, e) => ops.toggleInline(t, s, e, '**')).text, 'a b c');
    // No selection: an empty pair, caret between.
    const empty = run('ab', [1, 1], (t, s, e) => ops.toggleInline(t, s, e, '`'));
    assert.deepEqual([empty.text, empty.select], ['a``b', [2, 2]]);
});

test('every inline tool uses its own marks', () => {
    const on = (marks) => run('word', [0, 4], (t, s, e) => ops.toggleInline(t, s, e, ...marks)).text;
    assert.equal(on(['*']), '*word*');
    assert.equal(on(['~~']), '~~word~~');
    assert.equal(on(['==']), '==word==');
    assert.equal(on(['`']), '`word`');
});

test('a link selects the url to type over; a pasted url becomes the target', () => {
    const link = run('see docs now', [4, 8], ops.toLink);
    assert.equal(link.text, 'see [docs](url) now');
    assert.equal(link.selected, 'url');
    const bare = run('https://example.com', [0, 19], ops.toLink);
    assert.equal(bare.text, '[](https://example.com)');
    assert.deepEqual(bare.select, [1, 1], 'caret in the empty label');
    assert.equal(run('', [0, 0], ops.toLink).text, '[text](url)');
});

test('list tools work on every selected line and toggle off', () => {
    const lines = 'one\ntwo\n\nthree';
    const all = [0, lines.length];
    const bullets = run(lines, all, (t, s, e) => ops.toggleLinePrefix(t, s, e, 'bullet'));
    assert.equal(bullets.text, '- one\n- two\n\n- three');
    assert.equal(
        run(bullets.text, [0, bullets.text.length], (t, s, e) => ops.toggleLinePrefix(t, s, e, 'bullet')).text,
        lines,
    );
    const ordered = run(lines, all, (t, s, e) => ops.toggleLinePrefix(t, s, e, 'ordered'));
    assert.equal(ordered.text, '1. one\n2. two\n\n3. three', 'numbers skip blank lines');
    const tasks = run(lines, all, (t, s, e) => ops.toggleLinePrefix(t, s, e, 'task'));
    assert.equal(tasks.text, '- [ ] one\n- [ ] two\n\n- [ ] three');
    // Switching kinds replaces the mark rather than stacking a second one.
    const switched = run(bullets.text, [0, bullets.text.length], (t, s, e) =>
        ops.toggleLinePrefix(t, s, e, 'ordered'),
    );
    assert.equal(switched.text, '1. one\n2. two\n\n3. three');
    const quoted = run(lines, all, (t, s, e) => ops.toggleLinePrefix(t, s, e, 'quote'));
    assert.equal(quoted.text, '> one\n> two\n\n> three');
    assert.equal(run('  - item', [4, 4], (t, s, e) => ops.toggleLinePrefix(t, s, e, 'task')).text, '  - [ ] item');
});

test('only the lines the selection touches change', () => {
    const text = 'a\nb\nc\nd';
    assert.equal(run(text, [2, 3], (t, s, e) => ops.toggleLinePrefix(t, s, e, 'bullet')).text, 'a\n- b\nc\nd');
    // A selection ending at the very start of a line does not reach that line.
    assert.equal(run(text, [0, 4], (t, s, e) => ops.toggleLinePrefix(t, s, e, 'bullet')).text, '- a\n- b\nc\nd');
    assert.deepEqual(ops.lineRange(text, 2, 2), [2, 3]);
});

test('the heading tool steps through H1, H2, H3 and back to plain', () => {
    let text = 'Title';
    const seen = [];
    for (let i = 0; i < 4; i++) {
        text = run(text, [0, text.length], (t, s, e) => ops.cycleHeading(t, s, e)).text;
        seen.push(text);
    }
    assert.deepEqual(seen, ['# Title', '## Title', '### Title', 'Title']);
    assert.equal(run('#### deep', [0, 8], (t, s, e) => ops.cycleHeading(t, s, e)).text, 'deep');
});

test('a code block wraps whole lines and comes off again', () => {
    const fenced = run('x = 1\ny = 2', [2, 8], ops.toggleFence);
    assert.equal(fenced.text, '```\nx = 1\ny = 2\n```');
    assert.equal(run(fenced.text, [0, fenced.text.length], ops.toggleFence).text, 'x = 1\ny = 2');
});

test('an alert quotes the lines under a marker, and pressing again changes its kind', () => {
    const alert = run('one\n\ntwo', [0, 8], (t, s, e) => ops.toggleAlert(t, s, e));
    assert.equal(alert.text, '> [!NOTE]\n> one\n>\n> two');
    const next = run(alert.text, [0, alert.text.length], (t, s, e) => ops.toggleAlert(t, s, e));
    assert.equal(next.text.split('\n')[0], '> [!TIP]');
    assert.equal(next.text.split('\n').slice(1).join('\n'), '> one\n>\n> two');
    // After CAUTION it goes round to NOTE again.
    let text = '> [!CAUTION]\n> x';
    text = run(text, [0, text.length], (t, s, e) => ops.toggleAlert(t, s, e)).text;
    assert.equal(text.split('\n')[0], '> [!NOTE]');
    assert.equal(run('x', [0, 1], (t, s, e) => ops.toggleAlert(t, s, e, 'WARNING')).text, '> [!WARNING]\n> x');
});

test('clearing formatting takes the marks off and keeps the words', () => {
    const messy = '## **bold** and *em* and ~~gone~~ and ==hi== and `code` and [a link](https://x.y)';
    assert.equal(
        run(messy, [0, messy.length], ops.clearFormatting).text,
        'bold and em and gone and hi and code and a link',
    );
    const list = '- [ ] task\n> quoted\n1. numbered';
    assert.equal(run(list, [0, list.length], ops.clearFormatting).text, 'task\nquoted\nnumbered');
    // Code is left as it is: the fence lines and what is inside them, even when
    // the selection starts below the opening fence.
    const fenced = '**a**\n```\n**x** and - not a list\n```\n**b**';
    assert.equal(
        run(fenced, [0, fenced.length], ops.clearFormatting).text,
        'a\n```\n**x** and - not a list\n```\nb',
    );
    const inside = '```\n**x**\n- y\n```';
    const from = inside.indexOf('**x**');
    assert.equal(run(inside, [from, from + 5], ops.clearFormatting).text, inside);
});

// --- GitHub alerts and highlights in the preview ---

test('a quote starting with [!KIND] renders as a coloured alert', () => {
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
        const html = renderMarkdown(`> [!${kind}]\n> body **text**`);
        assert.match(html, new RegExp(`class="md-alert md-alert-${kind.toLowerCase()}"`), kind);
        assert.match(html, /<svg/);
        assert.match(html, new RegExp(`<span>${kind[0]}${kind.slice(1).toLowerCase()}</span>`));
        assert.match(html, /<div class="md-alert-body"><p>body <strong>text<\/strong><\/p><\/div>/);
    }
    // Lower case works too, and an ordinary quote stays a quote.
    assert.match(renderMarkdown('> [!note]\n> x'), /md-alert-note/);
    assert.match(renderMarkdown('> not an alert'), /^<blockquote>/);
    assert.ok(!renderMarkdown('> [!BOGUS]\n> x').includes('md-alert'));
});

test('a task inside an alert still points at its own source line', () => {
    const html = renderMarkdown('intro\n\n> [!TIP]\n> - [ ] ship it');
    assert.match(html, /<li class="md-d0 md-task" data-line="3">/);
});

test('==text== is highlighted, and the text is still escaped', () => {
    assert.match(renderMarkdown('a ==hi== b'), /<mark>hi<\/mark>/);
    assert.equal(renderMarkdown('==<b>=='), '<p><mark>&lt;b&gt;</mark></p>');
});
