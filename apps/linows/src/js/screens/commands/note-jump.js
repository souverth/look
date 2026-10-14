// The "Go to" box of /note (Ctrl+G): type a line number to jump to it, or pick a
// place in the note: a heading, task, code block, table, image, link, tag, quote or
// alert, narrowed by what is typed (`h2`, `task milk`, `img`...) or by a chip. It is
// only the box: what a jump does to the editor is the caller's `goTo`.

import { landmarks, readJump, readKind } from './note-outline.js';
import { escapeHtml } from '../../markdown.js';

// The chips under the input: what each types, and how it is labelled.
const CHIPS = [
    ['h1', 'H1'],
    ['h2', 'H2'],
    ['h3', 'H3'],
    ['h4', 'H4'],
    ['h5', 'H5'],
    ['h6', 'H6'],
    ['task', 'Tasks'],
    ['code', 'Code'],
    ['table', 'Tables'],
    ['img', 'Images'],
    ['link', 'Links'],
    ['tag', 'Tags'],
    ['quote', 'Quotes'],
    ['alert', 'Alerts'],
];

// The small label in front of a row.
function badge(item) {
    switch (item.kind) {
        case 'heading':
            return [`H${item.level}`, `lv${item.level}`];
        case 'task':
            return item.done ? ['DONE', 'k-done'] : ['TODO', 'k-task'];
        case 'code':
            return ['CODE', 'k-code'];
        case 'table':
            return ['TABLE', 'k-table'];
        case 'image':
            return ['IMG', 'k-image'];
        case 'link':
            return ['LINK', 'k-link'];
        case 'tag':
            return ['TAG', 'k-tag'];
        case 'quote':
            return ['QUOTE', 'k-quote'];
        case 'alert':
            return ['ALERT', 'k-alert'];
        case 'comment':
            return ['REM', 'k-comment'];
        default:
            return ['→', ''];
    }
}

/**
 * `host` is the element it floats in; `getText()` is the note's text; `goTo(line,
 * item)` makes the jump (`line` counts from 0); `onClose` runs when it closes empty-handed.
 * Returns `{ open(currentLine), close, isOpen, handleKey }`.
 */
export function createJumpMenu({ host, getText, goTo, onClose }) {
    const root = document.createElement('div');
    root.className = 'cmd-note-jump';
    root.hidden = true;
    root.innerHTML =
        '<div class="cmd-note-jump-bar"><span class="cmd-note-jump-icon">#</span>' +
        '<input type="text" placeholder="Line number, a heading, or: task, code, table, img, link, tag" spellcheck="false" autocomplete="off"></div>' +
        `<div class="cmd-note-jump-chips">${CHIPS.map(([q, label]) => `<button type="button" data-q="${q}">${label}</button>`).join('')}</div>` +
        '<div class="cmd-note-jump-list"></div>';
    host.appendChild(root);
    const input = root.querySelector('input');
    const list = root.querySelector('.cmd-note-jump-list');
    const chips = [...root.querySelectorAll('.cmd-note-jump-chips button')];

    let items = [];
    let index = 0;

    const lineCount = () => getText().replace(/\r\n?/g, '\n').split('\n').length;

    function render() {
        const text = getText();
        const found = readJump(input.value, landmarks(text), lineCount());
        items =
            found.line !== undefined
                ? [{ line: found.line, kind: 'line', title: `Go to line ${found.line + 1}` }]
                : found.items;
        index = Math.min(index, Math.max(0, items.length - 1));

        // The chip of the kind being looked at is lit.
        const { kind, level } = readKind(input.value);
        const lit = kind === 'heading' && level ? `h${level}` : { task: 'task', done: 'task', image: 'img' }[kind] ?? kind;
        for (const chip of chips) chip.classList.toggle('on', chip.dataset.q === lit);

        if (!items.length) {
            const why = input.value.trim() ? 'Nothing matches.' : 'No headings yet. Type a line number, or task, code, img…';
            list.innerHTML = `<div class="cmd-note-jump-empty">${why}</div>`;
            return;
        }
        list.innerHTML = items
            .map((h, i) => {
                const [label, tone] = badge(h);
                const indent = h.kind === 'heading' ? (h.level - 1) * 12 : 0;
                return (
                    `<div class="cmd-note-jump-row${i === index ? ' active' : ''}" data-i="${i}">` +
                    `<span class="cmd-note-jump-level ${tone}">${label}</span>` +
                    `<span class="cmd-note-jump-title" style="padding-left:${indent}px">${escapeHtml(h.title)}</span>` +
                    `<span class="cmd-note-jump-line">${h.line + 1}</span></div>`
                );
            })
            .join('');
        // Keep the active row in view inside the list only (never scrollIntoView: it
        // would scroll the editor behind as well).
        const row = list.querySelector('.active');
        if (row) {
            const top = row.offsetTop;
            const bottom = top + row.offsetHeight;
            if (top < list.scrollTop) list.scrollTop = top;
            else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
        }
    }

    function pick(i) {
        const item = items[i];
        if (!item) return;
        close();
        goTo(item.line, item);
    }

    function open(currentLine = 0) {
        root.hidden = false;
        input.value = '';
        index = 0;
        render();
        // Start on the heading the caret is under, so the list opens where you are.
        const here = items.reduce((best, h, i) => (h.line <= currentLine ? i : best), 0);
        index = here;
        render();
        input.focus();
    }

    function close() {
        root.hidden = true;
    }

    input.addEventListener('input', () => {
        index = 0;
        render();
    });
    list.addEventListener('mousedown', (e) => {
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        pick(Number(row.dataset.i));
    });
    // A chip types its kind into the box (a second press clears it), and the box keeps its focus.
    root.querySelector('.cmd-note-jump-chips').addEventListener('mousedown', (e) => {
        const chip = e.target.closest('button[data-q]');
        if (!chip) return;
        e.preventDefault();
        input.value = chip.classList.contains('on') ? '' : `${chip.dataset.q} `;
        index = 0;
        render();
        input.focus();
    });

    /** Keys while it is open; false lets typing through to its input. */
    function handleKey(e) {
        if (root.hidden) return false;
        const n = items.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
            e.preventDefault();
            if (n) {
                const step = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
                index = (index + step + n) % n;
                render();
            }
            return true;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            pick(index);
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            onClose?.();
            return true;
        }
        return false;
    }

    return { open, close, isOpen: () => !root.hidden, handleKey };
}
