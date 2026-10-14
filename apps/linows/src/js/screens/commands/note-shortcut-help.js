// The shortcut list of /note: a panel over the editor with every key it answers to,
// grouped, with a box to narrow it. It only shows; the keys are the editor's.

import { filterShortcuts } from './note-shortcuts.js';
import { escapeHtml } from '../../markdown.js';

// "Ctrl+Shift+K" as a row of key caps; "Alt+Up / Alt+Down" as two.
function caps(chords) {
    return chords
        .split(' / ')
        .map((chord) => {
            // A plain word of a chord that is not a key ("to", "click") reads as text.
            const parts = chord.split('+');
            const keys = parts.map((p) => (/^(Ctrl|Alt|Shift|Enter|Tab|Esc|Up|Down|Left|Right|F\d+|.)$/.test(p) ? `<kbd>${escapeHtml(p)}</kbd>` : escapeHtml(p)));
            return `<span class="cmd-note-keys-chord">${keys.join('<span class="plus">+</span>')}</span>`;
        })
        .join('<span class="or">/</span>');
}

/**
 * `host` is the element it floats in. Returns `{ open, close, isOpen, handleKey }`.
 */
export function createShortcutHelp({ host, onClose }) {
    const root = document.createElement('div');
    root.className = 'cmd-note-keys';
    root.hidden = true;
    root.innerHTML =
        '<div class="cmd-note-keys-bar"><span class="cmd-note-keys-title">Keyboard shortcuts</span>' +
        '<input type="text" placeholder="Search keys" spellcheck="false" autocomplete="off">' +
        '<button type="button" class="cmd-note-keys-close" title="Close (Esc)">Esc</button></div>' +
        '<div class="cmd-note-keys-body"></div>';
    host.appendChild(root);
    const input = root.querySelector('input');
    const body = root.querySelector('.cmd-note-keys-body');

    function render() {
        const groups = filterShortcuts(input.value);
        body.innerHTML = groups.length
            ? groups
                  .map(
                      (g) =>
                          `<section><h4>${escapeHtml(g.group)}</h4>` +
                          g.items
                              .map(([keys, what]) => `<div class="cmd-note-keys-row"><span class="what">${escapeHtml(what)}</span>${caps(keys)}</div>`)
                              .join('') +
                          '</section>',
                  )
                  .join('')
            : '<div class="cmd-note-keys-empty">No shortcut matches.</div>';
    }

    function open() {
        root.hidden = false;
        input.value = '';
        render();
        body.scrollTop = 0;
        input.focus();
    }

    function close() {
        root.hidden = true;
        onClose?.();
    }

    input.addEventListener('input', render);
    root.querySelector('.cmd-note-keys-close').addEventListener('mousedown', (e) => {
        e.preventDefault();
        close();
    });

    /** Keys while it is open; false lets typing through to its box. */
    function handleKey(e) {
        if (root.hidden) return false;
        if (e.key === 'Escape' || e.key === 'F1') {
            e.preventDefault();
            close();
            return true;
        }
        return false;
    }

    return { open, close, isOpen: () => !root.hidden, handleKey };
}
