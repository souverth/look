import { test } from 'node:test';
import assert from 'node:assert/strict';

// Model native textarea edits separately from the view's instance accessors:
// typing and undo change the browser's value without calling its JS setter.
class Textarea extends EventTarget {
    #value = '';
    get value() { return this.#value; }
    set value(text) { this.#value = text; }
    get selectionStart() { return 0; }
    get selectionEnd() { return 0; }
    setSelectionRange() {}
    setRangeText() {}
    scrollTop = 0;
    scrollLeft = 0;
    offsetWidth = 500;
    clientWidth = 500;
}

function element() {
    const classes = new Set();
    const el = Object.assign(new EventTarget(), {
        children: [], dataset: {}, hidden: false,
        style: { setProperty() {} },
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
            toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
        },
        setAttribute() {},
        appendChild() {},
        getBoundingClientRect: () => ({ height: 20 }),
    });
    Object.defineProperty(el, 'innerHTML', {
        set(html) {
            this.html = html;
            this.children = [...html.matchAll(/<div\b[^>]*>(.*?)<\/div>/gs)].map((match) => {
                const row = element();
                row.innerHTML = match[1];
                return row;
            });
        },
        get() { return this.html ?? ''; },
    });
    return el;
}

globalThis.HTMLTextAreaElement = Textarea;
globalThis.document = { createElement: element, activeElement: null };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const { createEditorView } = await import('../src/js/screens/commands/note-editor-view.js');
const nativeValue = Object.getOwnPropertyDescriptor(Textarea.prototype, 'value');

test('native typing, Enter and undo rebuild overlay rows and gutter', () => {
    const textarea = new Textarea();
    const overlay = element();
    const gutter = element();
    const view = createEditorView({ stack: element(), textarea, overlay, gutter });
    view.refreshNow();

    for (const text of ['hello', 'hello\n', 'hello\nworld', '\nhello\nworld', 'hello', '']) {
        nativeValue.set.call(textarea, text);
        textarea.dispatchEvent(new Event('input'));
        view.refreshNow();
        assert.equal(textarea.value, text);
        assert.equal(overlay.children.length, text.split('\n').length, JSON.stringify(text));
        assert.equal(gutter.children.length, text.split('\n').length);
        for (const line of text.split('\n').filter(Boolean)) assert.ok(overlay.children.some((row) => row.innerHTML.includes(line)));
    }
});
