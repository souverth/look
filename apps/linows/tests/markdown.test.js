import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, parseFenceInfo, escapeHtml } from '../src/js/markdown.js';
import { agentLogo } from '../src/js/agent-logos.js';

test('a fence with line=N shows the file and numbers lines from N', () => {
    assert.deepEqual(parseFenceInfo('ts index.ts line=1'), { lang: 'ts', path: 'index.ts', line: 1 });
    assert.deepEqual(parseFenceInfo('tsx filename="src/app.tsx" line=5'), {
        lang: 'tsx',
        path: 'src/app.tsx',
        line: 5,
    });
    assert.deepEqual(parseFenceInfo('ts line=3'), { lang: 'ts', path: '', line: 3 });
    const html = renderMarkdown('```ts index.ts line=7\na\nb\n```');
    assert.ok(html.includes('<b>index.ts</b>'));
    assert.ok(html.includes('md-code-nums" aria-hidden="true">7\n8<'));
    assert.ok(!renderMarkdown('```ts\na\n```').includes('md-code-nums'));
});

test('user text is escaped before any markup is added', () => {
    const html = renderMarkdown('<script>alert(1)</script> & "quotes"');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;') && html.includes('&amp;'));
    assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('headings, emphasis, inline code and rules', () => {
    assert.equal(renderMarkdown('# Title'), '<h1>Title</h1>');
    assert.equal(renderMarkdown('###### Deep'), '<h6>Deep</h6>');
    assert.ok(renderMarkdown('**bold** and *em* and ~~gone~~').includes('<strong>bold</strong>'));
    assert.ok(renderMarkdown('**bold** and *em* and ~~gone~~').includes('<em>em</em>'));
    assert.ok(renderMarkdown('~~gone~~').includes('<del>gone</del>'));
    assert.ok(renderMarkdown('---').includes('<hr>'));
    // Markup inside inline code is not interpreted.
    assert.ok(renderMarkdown('`**not bold**`').includes('<code>**not bold**</code>'));
});

test('only http(s) links become links, and the url never reaches an attribute raw', () => {
    assert.ok(renderMarkdown('[site](https://example.com)').includes('class="md-link"'));
    const bad = renderMarkdown('[x](javascript:alert(1))');
    assert.ok(!bad.includes('md-link'));
    assert.ok(!/href=/i.test(renderMarkdown('[x](https://a.com)')));
});

test('lists nest by indent, number, and carry task state with their source line', () => {
    const html = renderMarkdown('- a\n  - b\n1. one\n');
    assert.ok(html.includes('<ul>') && html.includes('<ol>'));
    assert.ok(html.includes('md-d1'));

    const tasks = renderMarkdown('intro\n\n- [ ] open\n- [x] done\n- [X] shouted');
    assert.deepEqual(
        [...tasks.matchAll(/data-line="(\d+)"/g)].map((m) => Number(m[1])),
        [2, 3, 4],
    );
    assert.equal((tasks.match(/md-done/g) || []).length, 2);
});

test('a task inside a quote keeps the line it came from', () => {
    const html = renderMarkdown('text\n> - [ ] quoted task');
    assert.ok(html.includes('<blockquote>'));
    assert.ok(html.includes('data-line="1"'));
});

test('a fenced block becomes a code box with a header, and its code is escaped', () => {
    const html = renderMarkdown('```ts:src/a.ts\nconst a = 1 < 2;\n```');
    assert.ok(html.includes('class="md-code"'));
    assert.ok(html.includes('<b>a.ts</b>') && html.includes('md-code-dir">src/'));
    assert.ok(html.includes('md-code-lang">ts<'));
    assert.ok(html.includes('data-lang="ts"') && html.includes('1 &lt; 2'));
    assert.ok(html.includes('md-copy'));
});

test('an unclosed fence runs to the end instead of swallowing nothing', () => {
    const html = renderMarkdown('```js\nlet x');
    assert.ok(html.includes('let x') && html.includes('md-code'));
});

test('fence info: language, path forms and Windows drives', () => {
    const cases = {
        ts: { lang: 'ts', path: '' },
        'ts:src/app.ts': { lang: 'ts', path: 'src/app.ts' },
        'ts title="a/b/c.ts"': { lang: 'ts', path: 'a/b/c.ts' },
        'js file=x.js': { lang: 'js', path: 'x.js' },
        'python main.py': { lang: 'python', path: 'main.py' },
        'src/js/app.js': { lang: 'js', path: 'src/js/app.js' },
        "ts:'my dir/a.ts'": { lang: 'ts', path: 'my dir/a.ts' },
        'C:\\proj\\a.rs': { lang: 'rs', path: 'C:\\proj\\a.rs' },
        'c++': { lang: 'c++', path: '' },
        '': { lang: '', path: '' },
    };
    for (const [info, want] of Object.entries(cases)) {
        assert.deepEqual(parseFenceInfo(info), want, JSON.stringify(info));
    }
});

test('agent logos: known agents get their mark, unknown ones a neutral chip', () => {
    for (const id of ['claude', 'codex', 'gemini', 'cursor', 'copilot', 'opencode', 'aider']) {
        assert.ok(agentLogo(id, 14).startsWith('<svg'), id);
    }
    assert.ok(agentLogo('claude').includes('#D97757'));
    assert.ok(agentLogo('gemini').includes('linearGradient'));
    assert.ok(agentLogo('something-new').includes('<rect'));
    assert.ok(agentLogo('claude', 22).includes('width="22"'));
});
