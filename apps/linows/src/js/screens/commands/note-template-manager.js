// The template manager of /note: the templates on the left, one open for editing on
// the right (name, text, the variables it can use), and a button to start a note
// from it. Templates are files in ~/.look/note-templates; this is only the screen.

import { notesTemplatesList, notesTemplateSave, notesTemplateDelete } from '../../ipc.js';
import { escapeHtml } from '../../markdown.js';
import { VARIABLES, firstLine } from './note-templates.js';

/**
 * `host` is the element the manager fills. `onUse({ name, body })` starts a note from
 * a template; `onClose()` leaves the manager. Returns `{ open, close, isOpen, handleKey }`.
 */
export function createTemplateManager({ host, onUse, onClose }) {
    host.innerHTML =
        '<div class="cmd-note-tplm-head"><span class="cmd-note-tplm-title">Templates</span>' +
        '<span class="cmd-note-tplm-sub">Start a note from one: type / on the first line, then Template.</span>' +
        '<button type="button" class="cmd-todo-btn" data-act="new">New template</button>' +
        '<button type="button" class="cmd-todo-btn" data-act="close">Close</button></div>' +
        '<div class="cmd-note-tplm-body"><div class="cmd-note-tplm-list" role="listbox"></div>' +
        '<div class="cmd-note-tplm-form">' +
        '<input class="cmd-note-tplm-name" type="text" placeholder="Template name" maxlength="60" spellcheck="false" autocomplete="off">' +
        '<textarea class="cmd-note-tplm-text" spellcheck="false" placeholder="What a new note starts with. Markdown works."></textarea>' +
        '<div class="cmd-note-tplm-vars"></div>' +
        '<div class="cmd-note-tplm-foot"><span class="cmd-note-tplm-msg"></span>' +
        '<button type="button" class="cmd-todo-btn" data-act="delete">Delete</button>' +
        '<button type="button" class="cmd-todo-btn" data-act="use">Use for a new note</button>' +
        '<button type="button" class="cmd-todo-btn cmd-note-tplm-save" data-act="save">Save</button></div>' +
        '</div></div>';

    const listEl = host.querySelector('.cmd-note-tplm-list');
    const nameEl = host.querySelector('.cmd-note-tplm-name');
    const textEl = host.querySelector('.cmd-note-tplm-text');
    const varsEl = host.querySelector('.cmd-note-tplm-vars');
    const msgEl = host.querySelector('.cmd-note-tplm-msg');
    const deleteBtn = host.querySelector('[data-act="delete"]');

    let templates = [];
    let editing = null; // the name it had when opened; null for one not saved yet
    let deleteArmed = false;
    let armTimer = 0;

    // The variables, as buttons that put themselves into the text at the caret.
    varsEl.innerHTML =
        '<span>Variables</span>' +
        VARIABLES.map(([v, hint]) => `<button type="button" data-var="${escapeHtml(v)}" title="${escapeHtml(hint)}">${escapeHtml(v)}</button>`).join('');

    function say(text, isError = false) {
        msgEl.textContent = text;
        msgEl.classList.toggle('error', isError);
    }

    function disarm() {
        deleteArmed = false;
        clearTimeout(armTimer);
        deleteBtn.textContent = 'Delete';
        deleteBtn.classList.remove('armed');
    }

    function renderList() {
        listEl.innerHTML = templates.length
            ? templates
                  .map(
                      (t) =>
                          `<button type="button" class="cmd-note-tplm-item${t.name === editing ? ' active' : ''}" data-name="${escapeHtml(t.name)}" role="option">` +
                          `<span class="cmd-note-tplm-item-name">${escapeHtml(t.name)}</span>` +
                          `<span class="cmd-note-tplm-item-line">${escapeHtml(firstLine(t.body))}</span></button>`,
                  )
                  .join('')
            : '<div class="cmd-note-tplm-empty">No templates yet. Make one with New template.</div>';
    }

    function show(template) {
        disarm();
        editing = template ? template.name : null;
        nameEl.value = template ? template.name : '';
        textEl.value = template ? template.body : '';
        say('');
        renderList();
    }

    async function reload() {
        try {
            templates = await notesTemplatesList();
        } catch (err) {
            templates = [];
            say(`Could not read the templates: ${err}`, true);
        }
    }

    async function open() {
        host.hidden = false;
        await reload();
        show(templates[0] ?? null);
        (templates.length ? listEl.querySelector('.active') : nameEl)?.focus();
    }

    function close() {
        host.hidden = true;
        disarm();
        onClose?.();
    }

    async function save() {
        try {
            const name = await notesTemplateSave(nameEl.value, textEl.value, editing);
            await reload();
            show(templates.find((t) => t.name === name) ?? { name, body: textEl.value });
            say('Saved');
        } catch (err) {
            say(String(err), true);
        }
    }

    async function remove() {
        if (editing === null) return show(templates[0] ?? null);
        // Two presses: the first arms it, as Delete does on a note.
        if (!deleteArmed) {
            deleteArmed = true;
            deleteBtn.textContent = 'Click again to delete';
            deleteBtn.classList.add('armed');
            armTimer = setTimeout(disarm, 3000);
            return;
        }
        try {
            await notesTemplateDelete(editing);
            await reload();
            show(templates[0] ?? null);
        } catch (err) {
            say(String(err), true);
        }
    }

    host.addEventListener('click', (e) => {
        const item = e.target.closest('.cmd-note-tplm-item');
        if (item) return show(templates.find((t) => t.name === item.dataset.name) ?? null);
        const variable = e.target.closest('[data-var]');
        if (variable) {
            const at = textEl.selectionStart;
            textEl.setRangeText(variable.dataset.var, at, textEl.selectionEnd, 'end');
            textEl.focus();
            return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'close') close();
        else if (act === 'new') {
            show(null);
            nameEl.focus();
        } else if (act === 'save') void save();
        else if (act === 'delete') void remove();
        else if (act === 'use') onUse({ name: nameEl.value.trim(), body: textEl.value });
    });

    /** Keys while it is open; false lets typing through. */
    function handleKey(e) {
        if (host.hidden) return false;
        const ctrl = e.ctrlKey || e.metaKey;
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            return true;
        }
        if (ctrl && !e.shiftKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void save();
            return true;
        }
        // Up and Down walk the list while it has the focus.
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement?.closest?.('.cmd-note-tplm-list')) {
            e.preventDefault();
            const at = templates.findIndex((t) => t.name === editing);
            const next = templates[Math.min(templates.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
            if (next) {
                show(next);
                listEl.querySelector('.active')?.focus();
            }
            return true;
        }
        return false;
    }

    return { open, close, isOpen: () => !host.hidden, handleKey };
}
