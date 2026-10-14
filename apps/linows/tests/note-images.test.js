import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, findImages, withImageWidth, splitImageAlt } from '../src/js/markdown.js';
import { highlightLines } from '../src/js/screens/commands/note-syntax.js';

test('an image is drawn from a web address, a data URI or a local file; other sources show their alt', () => {
    const web = renderMarkdown('![logo](https://x.io/a_b_c.png)');
    assert.ok(web.includes('<img class="md-img" alt="logo" src="https://x.io/a_b_c.png"'), 'underscores in the URL stay as they are');
    assert.ok(web.includes('class="md-img-handle"'));
    assert.ok(renderMarkdown('![p](data:image/png;base64,AAAA)').includes('src="data:image/png;base64,AAAA"'));
    assert.ok(renderMarkdown('![l](C:\\pics\\cat.png)').includes('data-local="C:\\pics\\cat.png"'));
    assert.ok(renderMarkdown('![l](file:///C:/pics/cat.png)').includes('data-local="C:/pics/cat.png"'));
    assert.ok(renderMarkdown('![l](/home/me/cat.png)').includes('data-local="/home/me/cat.png"'));
    const missing = renderMarkdown('![nope](pics/cat.png)');
    assert.ok(missing.includes('md-img-missing') && !missing.includes('<img'));
    assert.ok(!renderMarkdown('![x](javascript:alert(1))').includes('<img'));
    assert.ok(!renderMarkdown('![x](data:text/html;base64,AAAA)').includes('<img'));
});

test('a width after | in the alt text sizes the image and stays out of the alt', () => {
    assert.deepEqual(splitImageAlt('logo|300'), { alt: 'logo', width: '300px', height: '' });
    assert.deepEqual(splitImageAlt('logo|50%'), { alt: 'logo', width: '50%', height: '' });
    assert.deepEqual(splitImageAlt('logo|300x200'), { alt: 'logo', width: '300px', height: '200px' });
    assert.deepEqual(splitImageAlt('a | b'), { alt: 'a | b', width: '', height: '' });
    const html = renderMarkdown('![logo|300](https://x.io/a.png)');
    assert.ok(html.includes('class="md-imgbox" data-img="0" style="width:300px"'));
    assert.ok(html.includes('alt="logo"'));
});

test('images are numbered in the order they are drawn, inside quotes and folds too', () => {
    const src = '![a](https://x/1.png)\n\n> ![b](https://x/2.png)\n\n| h |\n| - |\n| ![c](https://x/3.png) |';
    const html = renderMarkdown(src);
    assert.deepEqual([...html.matchAll(/data-img="(\d+)"/g)].map((m) => m[1]), ['0', '1', '2']);
    assert.deepEqual(findImages(src).map((i) => i.alt), ['a', 'b', 'c']);
    assert.deepEqual([...renderMarkdown(src).matchAll(/data-img="(\d+)"/g)].map((m) => m[1]), ['0', '1', '2'], 'counted afresh each render');
});

test('images in code are not images, in the text or in the count', () => {
    const src = '`![no](https://x/n.png)`\n\n```\n![no](https://x/n.png)\n```\n\n![yes](https://x/y.png)';
    assert.deepEqual(findImages(src).map((i) => i.alt), ['yes']);
    assert.ok(renderMarkdown(src).includes('data-img="0"'));
});

test('withImageWidth writes the size back into the alt text of that image only', () => {
    const src = '![a](https://x/1.png) and ![b|200](https://x/2.png)';
    assert.equal(withImageWidth(src, 0, 320), '![a|320](https://x/1.png) and ![b|200](https://x/2.png)');
    assert.equal(withImageWidth(src, 1, 480), '![a](https://x/1.png) and ![b|480](https://x/2.png)');
    assert.equal(withImageWidth(src, 1, null), '![a](https://x/1.png) and ![b](https://x/2.png)', 'null takes the size off');
    assert.equal(withImageWidth(src, 5, 100), null);
    assert.equal(withImageWidth('![|50%](https://x/a.png)', 0, 100), '![|100](https://x/a.png)');
});

test('the editor colours an image as one piece', () => {
    const [line] = highlightLines('see ![logo|300](https://x.io/a.png) here');
    assert.match(line, /tok-img">!\[logo\|300\]</);
    assert.match(line, /tok-url">\(https:\/\/x\.io\/a\.png\)</);
});
