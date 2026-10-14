// /note: quick notes for ideas. A grid of cards (title + at most 3 lines of
// body, lifting on hover); clicking one opens a Markdown editor with a
// Preview mode, list continuation, Ctrl+B/I and a "/" block menu. Unlike /todo
// there is no manual Save: the open note autosaves shortly after each edit and
// again when leaving the editor. Data lives in the shared look-notes store.

import {
    notesList,
    notesSave,
    notesDelete,
    notesTagColors,
    notesSetTagColor,
    notesRecordOpen,
    notesSaveImage,
    notesPruneImages,
    notesTemplatesList,
    themesList,
    getConfig,
} from '../../ipc.js';
import {
    notebook,
    plus,
    trash as trashIcon,
    search as searchIcon,
    fileText as fileTextIcon,
    info as infoIcon,
    check as checkIcon,
    arrowLeft,
    sparkles,
    link as linkIcon,
    code as codeIcon,
    braces,
    highlighter,
    listBullets,
    listOrdered,
    listChecks,
    quote as quoteIcon,
    megaphone,
} from '../../icons.js';
import { withImageWidth, renderMarkdown, escapeHtml } from '../../markdown.js';
import { TAG_HUES, tagPicks, tagIndex, swatchStyle, tagStyle } from './note-tag-style.js';
import { highlightCodeBlocks, copyCode } from './note-code.js';
import { createEditing } from './note-editing.js';
import { createEditorView } from './note-editor-view.js';
import { tableEnter, tableTab, tableMove } from './note-table.js';
import { moveLines, duplicateLines, deleteLines, openLine, joinLines, toggleComment, toggleBlockComment, shiftLevel, setHeading } from './note-lines.js';
import { tagContext, filterTags, tagInsert, closeOnGreater } from './note-tags.js';
import { emojiContext, filterEmoji, emojiFor } from './note-emoji.js';
import { codeContext, filterLanguages, filterWords } from './note-code-assist.js';
import * as pairs from './note-pairs.js';
import { createJumpMenu } from './note-jump.js';
import { createShortcutHelp } from './note-shortcut-help.js';
import { createTemplateManager } from './note-template-manager.js';
import { expandTemplate, firstLine as templateLine } from './note-templates.js';
import { outline, offsetOfLine } from './note-outline.js';
import * as noteSettings from './note-settings.js';
import * as slash from './note-slash.js';
import * as ops from './note-format-ops.js';
import { formatDate, firstLine, dropFirstLine, plainPreview, newId } from './note-format.js';

const AUTOSAVE_MS = 500;
// How long the split view waits after a keystroke before redrawing its preview.
const PREVIEW_DELAY_MS = 120;

// The selection toolbar, left to right: clear, then inline marks, then code,
// then block marks. `glyph` buttons show a letter, the rest an icon.
const inlineMark = (open, close = open) => (text, start, end) =>
    ops.toggleInline(text, start, end, open, close);
const blockMark = (kind) => (text, start, end) => ops.toggleLinePrefix(text, start, end, kind);

const BUBBLE = [
    { id: 'clear', icon: sparkles, title: 'Clear formatting', run: ops.clearFormatting },
    'sep',
    { id: 'heading', glyph: '#', title: 'Heading (H1, H2, H3, off)', run: ops.cycleHeading },
    { id: 'bold', glyph: 'B', cls: 'glyph-bold', title: 'Bold (Ctrl+B)', run: inlineMark('**') },
    { id: 'italic', glyph: 'I', cls: 'glyph-italic', title: 'Italic (Ctrl+I)', run: inlineMark('*') },
    {
        id: 'strike',
        glyph: 'S',
        cls: 'glyph-strike',
        title: 'Strikethrough (Ctrl+Shift+X)',
        run: inlineMark('~~'),
    },
    { id: 'mark', icon: highlighter, title: 'Highlight', run: inlineMark('==') },
    { id: 'link', icon: linkIcon, title: 'Link (Ctrl+K)', run: ops.toLink },
    'sep',
    { id: 'code', icon: codeIcon, title: 'Inline code', run: inlineMark('`') },
    { id: 'fence', icon: braces, title: 'Code block', run: ops.toggleFence },
    'sep',
    { id: 'bullet', icon: listBullets, title: 'Bullet list', run: blockMark('bullet') },
    { id: 'ordered', icon: listOrdered, title: 'Numbered list', run: blockMark('ordered') },
    { id: 'task', icon: listChecks, title: 'Task list', run: blockMark('task') },
    { id: 'quote', icon: quoteIcon, title: 'Quote', run: blockMark('quote') },
    {
        id: 'alert',
        icon: megaphone,
        title: 'GitHub alert (again: next kind)',
        run: (text, start, end) => ops.toggleAlert(text, start, end),
    },
];

// --- State ---
let notes = []; // newest edit first
let loaded = false;
let visible = false;
let current = null; // note open in the editor, or null in list view
let mode = 'edit'; // 'edit' | 'split' | 'preview'
let lastWritingMode = 'edit'; // what Preview returns to
let settings = { ...noteSettings.DEFAULTS };
let previewTimer = null;
let saveTimer = null;
let pendingSave = Promise.resolve();
let dirty = false;
let deleteArmed = false;
let deleteTimer = null;
let suggestItems = []; // what Up/Down and Enter walk, in the order shown
let suggestRows = []; // the same, with the group headings between
let suggestIndex = 0;
let tagFrom = 0; // where the `<` of the tag being completed is
let emojiFrom = 0; // where the `:` of the emoji being completed is
let codeFrom = 0; // where the language or word being completed starts
const MARKUP_LANGS = new Set(['html', 'jsx', 'tsx', 'vue', 'xml', 'svelte']);
let activeTag = null; // tag the list is filtered to, or null for all

// --- DOM refs ---
let panel, searchBar, searchInput, toolbar, countEl, newBtn, grid;
let tagBar, tagsEl, tagInput, tagMenu, colorsEl;
let colorsTag = null; // tag the colour picker is open for
let editor, backBtn, titleInput, statusEl, modeEl, deleteBtn, bodyEl, previewEl, suggestEl;
let wrapEl, paneEl, bubbleEl;
let tplBtn, gotoBtn, keysBtn;
let jump = null; // the Go to box (Ctrl+G)
let keysHelp = null; // the shortcut list (F1)
let userNoteThemes = []; // the editor themes the user saved: [{ name, data }]
let themedColors = []; // the colours set on the editor by the current theme, so they can be taken off
let templates = null; // the template manager
let view = null; // colours and line numbers around the textarea (note-editor-view.js)

// Act on the body textarea, which init() looks up after this module loads.
const { replaceRange, lineBounds, wrapSelection, applyOp, continueList, applyTable, indentLines } =
    createEditing(() => bodyEl);

export function init() {
    panel = document.getElementById('cmd-panel-note');
    searchBar = document.getElementById('cmd-note-search-bar');
    searchInput = document.getElementById('cmd-note-search');
    toolbar = document.getElementById('cmd-note-toolbar');
    countEl = document.getElementById('cmd-note-count');
    newBtn = document.getElementById('cmd-note-new-btn');
    grid = document.getElementById('cmd-note-grid');
    tagBar = document.getElementById('cmd-note-tagbar');
    tagsEl = document.getElementById('cmd-note-tags');
    tagInput = document.getElementById('cmd-note-tag-input');
    tagMenu = document.getElementById('cmd-note-tagmenu');
    editor = document.getElementById('cmd-note-editor');
    backBtn = document.getElementById('cmd-note-back-btn');
    titleInput = document.getElementById('cmd-note-title');
    statusEl = document.getElementById('cmd-note-status');
    modeEl = document.getElementById('cmd-note-mode');
    deleteBtn = document.getElementById('cmd-note-delete-btn');
    bodyEl = document.getElementById('cmd-note-body');
    previewEl = document.getElementById('cmd-note-preview');
    suggestEl = document.getElementById('cmd-note-suggest');
    wrapEl = document.getElementById('cmd-note-body-wrap');
    paneEl = document.getElementById('cmd-note-pane');
    bubbleEl = document.getElementById('cmd-note-bubble');
    tplBtn = document.getElementById('cmd-note-tpl-btn');
    gotoBtn = document.getElementById('cmd-note-goto-btn');
    keysBtn = document.getElementById('cmd-note-keys-btn');

    view = createEditorView({
        stack: document.getElementById('cmd-note-stack'),
        textarea: bodyEl,
        overlay: document.getElementById('cmd-note-hl'),
        gutter: document.getElementById('cmd-note-gutter'),
    });
    jump = createJumpMenu({
        host: wrapEl,
        getText: () => bodyEl.value,
        goTo: goToLine,
        onClose: () => (mode === 'preview' ? null : bodyEl.focus()),
    });
    keysHelp = createShortcutHelp({
        host: wrapEl,
        onClose: () => (mode === 'preview' ? null : bodyEl.focus()),
    });
    templates = createTemplateManager({
        host: document.getElementById('cmd-note-templates'),
        onUse: newNoteFrom,
        onClose: () => showList(),
    });
    buildBubble();
    applySettings(settings);
    // The settings in the config, now and whenever Settings (or a reload of the
    // file) changes them.
    Promise.all([getConfig(), themesList('note').catch(() => [])])
        .then(([cfg, saved]) => {
            userNoteThemes = saved;
            applySettings(noteSettings.parse(cfg.entries));
        })
        .catch((err) => console.warn('[note] could not read its settings:', err));
    document.addEventListener('look:note-settings-changed', (e) => applySettings(e.detail));
    // A theme was saved or deleted in Settings: the list the editor reads from changed.
    document.addEventListener('look:note-themes-changed', (e) => {
        userNoteThemes = e.detail;
        applySettings(settings);
    });

    document.getElementById('cmd-note-search-icon').innerHTML = searchIcon;
    newBtn.innerHTML = `${plus} New note`;
    backBtn.innerHTML = arrowLeft;
    deleteBtn.innerHTML = `${trashIcon} Delete`;
    tplBtn.innerHTML = `${fileTextIcon} Templates`;
    gotoBtn.innerHTML = `${searchIcon} Go to`;
    keysBtn.innerHTML = `${infoIcon} Keys`;

    searchInput.addEventListener('input', renderGrid);
    newBtn.addEventListener('click', newNote);
    tplBtn.addEventListener('click', openTemplates);
    keysBtn.addEventListener('click', openKeys);
    gotoBtn.addEventListener('click', openJump);
    backBtn.addEventListener('click', closeEditor);
    deleteBtn.addEventListener('click', onDeleteClick);
    modeEl.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    previewEl.addEventListener('click', (e) => {
        const copy = e.target.closest('.md-copy');
        if (copy) {
            void copyCode(copy);
            return;
        }
        // Ticking a task rewrites that line of the note. A click that ends a
        // text selection is not a tick.
        const item = e.target.closest('li.md-task');
        if (item && !window.getSelection()?.toString()) toggleTask(Number(item.dataset.line));
    });
    // Images: drag the corner handle to resize, double-click one for its own size.
    previewEl.addEventListener('pointerdown', onPreviewPointerDown);
    previewEl.addEventListener('dblclick', (e) => {
        const box = e.target.closest?.('.md-imgbox');
        if (box) setImageWidth(Number(box.dataset.img), null);
    });
    // load and error do not bubble, so they are caught on the way down.
    previewEl.addEventListener(
        'load',
        (e) => e.target.closest?.('.md-imgbox')?.classList.add('loaded'),
        true,
    );
    previewEl.addEventListener(
        'error',
        (e) => e.target.closest?.('.md-imgbox')?.classList.add('broken'),
        true,
    );
    grid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-note]');
        if (card) openNote(card.dataset.note);
    });

    tagBar.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-tag]');
        if (!chip) return;
        // Clicking the active tag (or "All") clears the filter.
        activeTag = chip.dataset.tag && chip.dataset.tag !== activeTag ? chip.dataset.tag : null;
        renderGrid();
    });
    // Right-click a filter chip to recolour that tag.
    tagBar.addEventListener('contextmenu', (e) => {
        const chip = e.target.closest('[data-tag]');
        if (!chip || !chip.dataset.tag) return;
        e.preventDefault();
        openColorPicker(chip.dataset.tag, chip);
    });
    colorsEl = document.createElement('div');
    colorsEl.className = 'cmd-note-colors';
    colorsEl.hidden = true;
    panel.appendChild(colorsEl);
    colorsEl.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
    colorsEl.addEventListener('click', (e) => {
        const sw = e.target.closest('[data-c]');
        if (sw && colorsTag) pickTagColor(colorsTag, sw.dataset.c === '' ? null : Number(sw.dataset.c));
    });
    document.addEventListener('mousedown', (e) => {
        if (!colorsEl.hidden && !colorsEl.contains(e.target)) closeColorPicker();
    });
    tagsEl.addEventListener('click', (e) => {
        const dot = e.target.closest('[data-color-tag]');
        if (dot) {
            openColorPicker(dot.dataset.colorTag, dot);
            return;
        }
        const del = e.target.closest('[data-del-tag]');
        if (del) removeTag(del.dataset.delTag);
        else if (!e.target.closest('input')) tagInput.focus();
    });
    tagInput.addEventListener('input', () => {
        // Typing a comma (or pasting "a, b") commits what came before it.
        if (tagInput.value.includes(',')) {
            const parts = tagInput.value.split(',');
            tagInput.value = parts.pop();
            parts.forEach(addTag);
        }
        tagMenuIndex = -1;
        updateTagMenu();
    });
    tagInput.addEventListener('focus', updateTagMenu);
    tagInput.addEventListener('blur', () => {
        addTag(tagInput.value);
        hideTagMenu();
    });
    // mousedown, not click: a click would blur the input first and close the menu.
    tagMenu.addEventListener('mousedown', (e) => {
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        addTag(tagMenuItems[Number(row.dataset.i)].tag);
    });

    titleInput.addEventListener('input', scheduleSave);
    bodyEl.addEventListener('input', () => {
        scheduleSave();
        updateSuggest();
        schedulePreview();
        updateBubble();
    });
    bodyEl.addEventListener('click', updateSuggest);
    bodyEl.addEventListener('scroll', () => {
        positionSuggest();
        syncPreviewScroll();
        updateBubble();
    });
    // Pictures: a pasted screenshot or copied image, or image files dropped on the
    // editor, are saved as files and become `![](path)` at the caret.
    bodyEl.addEventListener('paste', (e) => {
        const files = pictureFiles(e.clipboardData?.files, e.clipboardData);
        if (!files.length) return;
        e.preventDefault();
        void insertPictures(files);
    });
    bodyEl.addEventListener('dragover', (e) => {
        if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) e.preventDefault();
    });
    bodyEl.addEventListener('drop', (e) => {
        const files = pictureFiles(e.dataTransfer?.files, null);
        if (!files.length) return;
        e.preventDefault();
        // Where it was dropped, not where the caret was.
        const at = document.caretPositionFromPoint?.(e.clientX, e.clientY);
        if (at && at.offsetNode === bodyEl) bodyEl.setSelectionRange(at.offset, at.offset);
        void insertPictures(files);
    });
    bodyEl.addEventListener('blur', () => {
        hideSuggest();
        hideBubble();
    });
    // A range selected shows the toolbar; the mouse and the keys both make one.
    for (const type of ['mouseup', 'keyup', 'select']) {
        bodyEl.addEventListener(type, updateBubble);
    }
    suggestEl.addEventListener('mousedown', (e) => {
        // mousedown, not click: the click would blur the textarea first.
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        applySuggestion(suggestItems[Number(row.dataset.i)]);
    });

    load();
    // Pictures no note mentions any more are cleared out a little after start-up, once
    // the notes have loaded and the launcher is idle.
    setTimeout(() => {
        notesPruneImages().catch((err) => console.warn('[note] image cleanup skipped:', err));
    }, 15000);
}

export function enter() {
    visible = true;
    panel.hidden = false;
    // Always land on the list; the list is what a quick capture starts from.
    if (current) closeEditor();
    else showList();
    load();
}

export function exit() {
    visible = false;
    panel.hidden = true;
    hideSuggest();
    hideBubble();
    closeColorPicker();
    disarmDelete();
    void flush();
    current = null;
}

/** Opens one note in the editor, as a note picked from the main search does. */
export async function openById(id) {
    await load();
    if (visible) openNote(id);
}

// Tab belongs to the editor (indent / title -> body), not to command switching.
export function isEditing() {
    return visible && !!current && mode !== 'preview';
}

export function handleKey(e) {
    if (!visible) return false;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (e.key === 'Escape' && !colorsEl.hidden) {
        e.preventDefault();
        closeColorPicker();
        return true;
    }
    if (e.key === 'Escape' && tagMenuOpen()) {
        e.preventDefault();
        hideTagMenu();
        return true;
    }

    if (ctrl && !e.shiftKey && key === 'n') {
        e.preventDefault();
        newNote();
        return true;
    }

    // The Go to box and the template manager take the keys while they are open.
    if (jump?.isOpen() && jump.handleKey(e)) return true;
    if (keysHelp?.isOpen() && keysHelp.handleKey(e)) return true;
    if (templates?.isOpen()) return templates.handleKey(e);

    if (!current) {
        // Cards are focusable divs; Enter/Space opens one like a button.
        const card = document.activeElement?.closest?.('.cmd-note-cell');
        if (card && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openNote(card.dataset.note);
            return true;
        }
        // Arrows walk the cards (↓ from the search box enters them, ↑ from the
        // top row goes back); Enter in the search box opens the first match.
        const inSearch = document.activeElement === searchInput;
        if (e.key === 'Enter' && inSearch) {
            const first = grid.querySelector('.cmd-note-cell');
            if (first) {
                e.preventDefault();
                openNote(first.dataset.note);
                return true;
            }
        }
        if ((card || (inSearch && e.key === 'ArrowDown')) && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'first', End: 'last' }[e.key];
            if (dir) {
                e.preventDefault();
                moveCardFocus(card, dir);
                return true;
            }
        }
        if (e.key === 'Escape' && (searchInput.value || activeTag)) {
            // Esc peels off one filter at a time: search text, then the tag.
            if (searchInput.value) searchInput.value = '';
            else activeTag = null;
            renderGrid();
            return true;
        }
        return false;
    }

    // --- Editor ---
    if (ctrl && !e.shiftKey && key === 's') {
        e.preventDefault();
        void flush(true);
        return true;
    }
    // Ctrl+E reads what you wrote and takes you back to writing the way you were
    // (edit or split); Ctrl+\ opens and closes the split view.
    // F1 lists the shortcuts.
    if (e.key === 'F1') {
        e.preventDefault();
        openKeys();
        return true;
    }
    // Folding. By key position, so every keyboard layout has them: Ctrl+Shift+[ folds the
    // section the caret is in and Ctrl+Shift+] opens it; with Alt+Shift, all of them.
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        const opening = e.code === 'BracketRight';
        if (ctrl && e.shiftKey) {
            e.preventDefault();
            if (opening) view.unfoldAtCaret();
            else view.foldAtCaret();
            return true;
        }
        if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (opening) view.unfoldAll();
            else view.foldAll();
            return true;
        }
    }
    // Ctrl+Shift+1..6 headings, 7 numbered list, 8 bullets, 9 tasks; . quote; B code block.
    if (ctrl && e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        const n = Number(e.code.slice(5));
        if (n <= 6) applyOp((t, s, en) => setHeading(t, s, en, n));
        else applyOp((t, s, en) => ops.toggleLinePrefix(t, s, en, n === 7 ? 'ordered' : n === 8 ? 'bullet' : 'task'));
        return true;
    }
    if (ctrl && e.shiftKey && e.code === 'Period') {
        e.preventDefault();
        applyOp((t, s, en) => ops.toggleLinePrefix(t, s, en, 'quote'));
        return true;
    }
    if (ctrl && e.shiftKey && key === 'b') {
        e.preventDefault();
        applyOp(ops.toggleFence);
        return true;
    }
    if (ctrl && e.shiftKey && key === 'm') {
        e.preventDefault();
        wrapSelection('==');
        return true;
    }
    if (ctrl && !e.shiftKey && key === '`') {
        e.preventDefault();
        wrapSelection('`');
        return true;
    }
    if (ctrl && !e.shiftKey && key === 'u') {
        e.preventDefault();
        wrapSelection('<u>', '</u>');
        return true;
    }
    // Ctrl+G (or Ctrl+Shift+O) goes to a line or a heading.
    if ((ctrl && !e.shiftKey && key === 'g') || (ctrl && e.shiftKey && key === 'o')) {
        e.preventDefault();
        openJump();
        return true;
    }
    if (ctrl && !e.shiftKey && key === 'e') {
        e.preventDefault();
        setMode(mode === 'preview' ? lastWritingMode : 'preview');
        return true;
    }
    if (ctrl && !e.shiftKey && key === '\\') {
        e.preventDefault();
        setMode(mode === 'split' ? 'edit' : 'split');
        return true;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        if (!suggestEl.hidden) hideSuggest();
        else closeEditor();
        return true;
    }

    const ae = document.activeElement;
    if (ae === titleInput) {
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            tagInput.focus();
            return true;
        }
        return false;
    }
    if (ae === tagInput) {
        if (tagMenuOpen() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            moveTagMenu(e.key === 'ArrowDown' ? 1 : -1);
            return true;
        }
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            // A highlighted suggestion wins; otherwise Enter/Tab adds the
            // typed text, and on an empty field moves on to the body.
            if (tagMenuOpen() && tagMenuIndex >= 0) addTag(tagMenuItems[tagMenuIndex].tag);
            else if (tagInput.value.trim()) addTag(tagInput.value);
            else bodyEl.focus();
            return true;
        }
        if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            titleInput.focus();
            return true;
        }
        if (e.key === 'Backspace' && !tagInput.value && current.tags.length) {
            e.preventDefault();
            removeTag(current.tags[current.tags.length - 1]);
            return true;
        }
        return false;
    }
    if (ae !== bodyEl) return false;

    if (!suggestEl.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = suggestItems.length;
            suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
            renderSuggest();
            return true;
        }
        const picked = suggestItems[suggestIndex];
        // A language typed out in full (```tsx) has nothing left to complete: Enter
        // just closes the list and goes on to the next line.
        const complete = e.key === 'Enter' && picked?.code === 'lang' && picked.id === picked.query;
        if (complete) {
            hideSuggest();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            applySuggestion(picked);
            return true;
        }
    }

    // Alt+Arrows in a table walk its cells; outside one they do nothing special.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.startsWith('Arrow')) {
        const dir = e.key.slice(5).toLowerCase();
        if (applyTable(tableMove, dir)) {
            e.preventDefault();
            return true;
        }
    }

    // Whole-line editing: Alt+Up/Down move the lines, Alt+Enter and Shift+Alt+Up/Down
    // copy them, Ctrl+Shift+K deletes, Ctrl+(Shift+)Enter opens a line, Ctrl+J joins,
    // Ctrl+/ comments, Ctrl+L selects the line.
    {
        const arrow = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null;
        let line = null;
        if (e.altKey && !e.ctrlKey && !e.metaKey && arrow) {
            line = e.shiftKey ? [duplicateLines, arrow] : [moveLines, arrow];
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Enter') {
            line = [duplicateLines, e.shiftKey ? 'up' : 'down'];
        } else if (ctrl && e.key === 'Enter') {
            line = [openLine, e.shiftKey];
        } else if (ctrl && e.shiftKey && key === 'k') {
            line = [deleteLines];
        } else if (ctrl && !e.shiftKey && key === 'j') {
            line = [joinLines];
        } else if (ctrl && !e.shiftKey && key === '/') {
            // keyboard.js leaves Ctrl+/ to the editor while it is open for writing.
            line = [toggleComment];
        } else if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyA') {
            line = [toggleBlockComment];
        } else if (ctrl && !e.shiftKey && key === 'l') {
            e.preventDefault();
            const [a, b] = ops.lineRange(bodyEl.value, bodyEl.selectionStart, bodyEl.selectionEnd);
            bodyEl.setSelectionRange(a, Math.min(bodyEl.value.length, b + 1));
            return true;
        }
        if (line) {
            e.preventDefault();
            const [op, ...args] = line;
            applyOp((text, s, en) => op(text, s, en, ...args));
            return true;
        }
    }

    // Typing the closing `:` of `:smile:` turns it into the emoji.
    if (e.key === ':' && !ctrl && !e.altKey && bodyEl.selectionStart === bodyEl.selectionEnd && !inCodeBlock()) {
        const pos = bodyEl.selectionStart;
        const ctx = emojiContext(bodyEl.value, pos);
        const char = ctx && emojiFor(ctx.query);
        if (char) {
            e.preventDefault();
            hideSuggest();
            replaceRange(ctx.from, pos, char, ctx.from + char.length);
            return true;
        }
    }

    // Typing the `>` of an opening tag adds its closing tag after the caret.
    if (e.key === '>' && !ctrl && bodyEl.selectionStart === bodyEl.selectionEnd && !inCodeBlock()) {
        const pos = bodyEl.selectionStart;
        const close = closeOnGreater(bodyEl.value, pos);
        if (close) {
            e.preventDefault();
            replaceRange(pos, pos, `>${close}`, pos + 1);
            return true;
        }
    }

    // Inside a fenced block: closing brackets and quotes, a block opened by Enter
    // between `{}`, Backspace taking a pair, and closing tags in HTML/JSX.
    if (!e.isComposing && !ctrl && !e.altKey) {
        const { value, selectionStart: s, selectionEnd: en } = bodyEl;
        const block = codeContext(value, s);
        if (block && block.kind !== 'lang') {
            let change = null;
            if (e.key.length === 1) {
                change = pairs.typed(value, s, en, e.key);
                if (!change && e.key === '>' && s === en && MARKUP_LANGS.has(block.lang)) {
                    const close = closeOnGreater(value, s, { markup: true });
                    if (close) change = { from: s, to: s, insert: `>${close}`, select: [s + 1, s + 1] };
                }
            } else if (e.key === 'Enter' && !e.shiftKey && s === en) {
                change = pairs.enter(value, s, block.lang);
            } else if (e.key === 'Backspace' && s === en) {
                change = pairs.backspace(value, s);
            }
            if (change) {
                e.preventDefault();
                if (change.skip !== undefined) bodyEl.setSelectionRange(change.skip, change.skip);
                else {
                    replaceRange(change.from, change.to, change.insert, change.select[1]);
                    bodyEl.setSelectionRange(change.select[0], change.select[1]);
                }
                return true;
            }
        }
    }

    if (ctrl && !e.shiftKey && (key === 'b' || key === 'i')) {
        e.preventDefault();
        wrapSelection(key === 'b' ? '**' : '*');
        return true;
    }
    if (ctrl && !e.shiftKey && key === 'k') {
        e.preventDefault();
        applyOp(ops.toLink);
        return true;
    }
    // Ctrl+] / Ctrl+[ change the level like Tab / Shift+Tab, wherever the caret is.
    if (ctrl && !e.shiftKey && (key === ']' || key === '[')) {
        e.preventDefault();
        changeLevel(key === ']' ? 1 : -1);
        return true;
    }
    if (ctrl && e.shiftKey && key === 'x') {
        e.preventDefault();
        wrapSelection('~~');
        return true;
    }
    if (e.key === 'Enter' && !e.shiftKey && !ctrl) {
        if (applyTable(tableEnter) || continueList()) {
            e.preventDefault();
            return true;
        }
        return false;
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        if (applyTable(tableTab, e.shiftKey)) return true;
        changeLevel(e.shiftKey ? -1 : 1);
        return true;
    }
    return false;
}

// --- Persistence ---

async function load() {
    try {
        const [rows, colors] = await Promise.all([notesList(), notesTagColors()]);
        tagPicks.clear();
        for (const c of colors) tagPicks.set(c.tag, c.color);
        // Don't clobber an open note's unsaved edits with a stale read.
        if (dirty) return;
        notes = rows;
        loaded = true;
    } catch (err) {
        console.error('[note] load failed:', err);
    }
    if (visible && !current) renderGrid();
}

function scheduleSave() {
    if (!current) return;
    dirty = true;
    setStatus('Editing…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), AUTOSAVE_MS);
}

// Writes the open note now. Serialized so a slow write never lands after a
// newer one. `announce` is the explicit Ctrl+S, which says "Saved" even when
// nothing changed.
function flush(announce = false) {
    clearTimeout(saveTimer);
    if (!current) return pendingSave;
    if (!dirty && !announce) return pendingSave;

    const draft = {
        id: current.id,
        title: titleInput.value,
        body: bodyEl.value,
        tags: [...current.tags],
        created_at_unix_s: current.created_at_unix_s,
        updated_at_unix_s: current.updated_at_unix_s,
    };
    dirty = false;
    pendingSave = pendingSave.then(async () => {
        try {
            const stored = await notesSave(draft);
            applyStored(draft.id, stored);
            if (current && current.id === draft.id) setStatus(`${checkIcon} Saved`);
        } catch (err) {
            dirty = true; // keep the draft; the next edit or Ctrl+S retries
            setStatus(`Save failed: ${escapeHtml(String(err))}`, true);
        }
    });
    return pendingSave;
}

function applyStored(id, stored) {
    const i = notes.findIndex((n) => n.id === id);
    if (!stored) {
        if (i >= 0) notes.splice(i, 1); // blank notes are removed by the store
        return;
    }
    if (i >= 0) notes.splice(i, 1);
    notes.unshift(stored);
    if (current && current.id === id) {
        current.created_at_unix_s = stored.created_at_unix_s;
        current.updated_at_unix_s = stored.updated_at_unix_s;
    }
}

// --- List view ---

function showList() {
    current = null;
    editor.hidden = true;
    searchBar.hidden = false;
    toolbar.hidden = false;
    grid.hidden = false;
    renderGrid();
    searchInput.focus();
}

function visibleNotes() {
    const base = activeTag ? notes.filter((n) => n.tags.includes(activeTag)) : notes;
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return base;
    return q
        .split(/\s+/)
        .reduce(
            (list, term) =>
                list.filter((n) =>
                    `${n.title}\n${n.body}\n${n.tags.join(' ')}`.toLowerCase().includes(term),
                ),
            base,
        );
}

// "All" plus one chip per tag in use, most-used first. Hidden when no note
// has a tag yet, so the list stays uncluttered for people who never tag.
function renderTagBar() {
    const counts = new Map();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
    if (activeTag && !counts.has(activeTag)) activeTag = null;
    tagBar.hidden = counts.size === 0;
    if (!counts.size) return;
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    tagBar.innerHTML =
        `<button class="cmd-note-tagchip${activeTag ? '' : ' active'}" data-tag="">All <b>${notes.length}</b></button>` +
        tags
            .map(
                ([t, c]) =>
                    `<button class="cmd-note-tagchip${t === activeTag ? ' active' : ''}" data-tag="${escapeHtml(t)}" style="${tagStyle(t)}"><i class="cmd-note-dot"></i>${escapeHtml(t)} <b>${c}</b></button>`,
            )
            .join('');
}

function renderGrid() {
    if (!grid) return;
    renderTagBar();
    const list = visibleNotes();
    countEl.innerHTML = `${notebook} ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;

    if (!list.length) {
        const msg = notes.length
            ? 'No notes match your search.'
            : loaded
              ? 'No notes yet. Press Ctrl+N to jot down an idea.'
              : 'Loading…';
        grid.innerHTML = `<div class="cmd-note-empty">${msg}</div>`;
        return;
    }
    grid.innerHTML = list
        .map((n) => {
            const title = n.title || firstLine(n.body) || 'Untitled';
            const body = n.title ? plainPreview(n.body) : plainPreview(dropFirstLine(n.body));
            const badge = n.tags.length
                ? `<span class="cmd-note-badge" style="${tagStyle(n.tags[0])}">${escapeHtml(n.tags[0])}${n.tags.length > 1 ? ` +${n.tags.length - 1}` : ''}</span>`
                : '';
            return `<div class="cmd-note-cell" data-note="${escapeHtml(n.id)}" tabindex="0" style="${n.tags.length ? tagStyle(n.tags[0]) : ''}">
                <div class="cmd-note-card">
                    ${badge}
                    <div class="cmd-note-card-title">${escapeHtml(title)}</div>
                    <div class="cmd-note-card-body">${escapeHtml(body)}</div>
                    <div class="cmd-note-card-date">${formatDate(n.updated_at_unix_s)}</div>
                </div>
            </div>`;
        })
        .join('');
}

// Moves the keyboard focus (the active card) one step. The grid wraps, so up and
// down pick the card whose centre is nearest in the row above/below rather than
// a fixed offset; up from the top row returns to the search box.
function moveCardFocus(from, dir) {
    const cells = [...grid.querySelectorAll('.cmd-note-cell')];
    if (!cells.length) return;
    const focus = (cell) => {
        cell.focus();
        cell.scrollIntoView({ block: 'nearest' });
    };
    if (!from) return focus(cells[0]);
    const i = cells.indexOf(from);
    if (dir === 'first') return focus(cells[0]);
    if (dir === 'last') return focus(cells[cells.length - 1]);
    if (dir === 'left') return focus(cells[Math.max(0, i - 1)]);
    if (dir === 'right') return focus(cells[Math.min(cells.length - 1, i + 1)]);

    const rect = from.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const below = dir === 'down';
    let best = null;
    let bestRow = Infinity;
    let bestDx = Infinity;
    for (const cell of cells) {
        const r = cell.getBoundingClientRect();
        const row = below ? r.top - rect.top : rect.top - r.top;
        if (row < rect.height / 2) continue; // same row, or the wrong side
        const dx = Math.abs(r.left + r.width / 2 - cx);
        if (row < bestRow - 1 || (Math.abs(row - bestRow) <= 1 && dx < bestDx)) {
            best = cell;
            bestRow = row;
            bestDx = dx;
        }
    }
    if (best) focus(best);
    else if (!below) searchInput.focus();
}

// --- Editor ---

function newNote() {
    if (current) void flush();
    const now = Math.floor(Date.now() / 1000);
    openEditor({
        id: newId(),
        title: '',
        body: '',
        // A note started while filtered to a tag belongs to that tag.
        tags: activeTag ? [activeTag] : [],
        created_at_unix_s: now,
        updated_at_unix_s: now,
    });
    titleInput.focus();
}

function openNote(id) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    // Feeds the main search's ranking; a failed count costs nothing visible.
    notesRecordOpen(id).catch((err) => console.warn('[note] record open failed:', err));
    openEditor({ ...note, tags: [...(note.tags || [])] });
    bodyEl.focus();
    bodyEl.setSelectionRange(bodyEl.value.length, bodyEl.value.length);
}

function openEditor(note) {
    current = note;
    dirty = false;
    titleInput.value = note.title;
    bodyEl.value = note.body;
    view.refreshNow();
    tagInput.value = '';
    renderTags();
    setStatus('');
    disarmDelete();
    searchBar.hidden = true;
    toolbar.hidden = true;
    tagBar.hidden = true;
    grid.hidden = true;
    editor.hidden = false;
    // Opens the way the setting says; a note is never opened already scrolled.
    setMode(settings.defaultView);
    bodyEl.scrollTop = 0;
}

async function closeEditor() {
    hideSuggest();
    hideBubble();
    disarmDelete();
    await flush();
    showList();
}

// Edit shows the writing pane alone, Preview the rendered text alone, Split both
// side by side. The preview is only drawn while it is on screen.
function setMode(next) {
    mode = next;
    if (next !== 'preview') lastWritingMode = next;
    wrapEl.dataset.view = next;
    modeEl.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === next);
    });
    hideSuggest();
    hideBubble();
    paneEl.hidden = next === 'preview';
    previewEl.hidden = next === 'edit';
    if (next !== 'edit') renderPreview();
    if (next === 'preview') {
        // Take focus off the hidden textarea so keys don't reach it.
        document.activeElement?.blur?.();
    } else {
        // The pane may just have come back from hidden, or changed width.
        view.refreshNow();
        bodyEl.focus();
        syncPreviewScroll();
    }
}

// The settings in force: how the editor looks, and how a note opens.
function applySettings(next) {
    settings = { ...noteSettings.DEFAULTS, ...next };
    // The theme to start from, and the colours laid over it (a saved theme's own, then the
    // ones changed since). They go on the editor as inline variables, so the preview inside
    // it takes them too; the ones the last theme set and this one does not are taken off.
    const look = noteSettings.resolveTheme(settings, userNoteThemes);
    wrapEl.dataset.edTheme = look.base;
    for (const name of themedColors) wrapEl.style.removeProperty(name);
    themedColors = Object.keys(look.colors);
    for (const [name, value] of Object.entries(look.colors)) wrapEl.style.setProperty(name, value);
    wrapEl.dataset.size = settings.size;
    view.configure({
        lineNumbers: settings.lineNumbers,
        highlight: settings.highlight,
        wrap: settings.wrap,
    });
    // A note already open keeps its view; the setting is for the next one.
}

// In the split view the preview follows the typing, a beat behind it.
function schedulePreview() {
    if (mode !== 'split') return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        renderPreview();
        syncPreviewScroll();
    }, PREVIEW_DELAY_MS);
}

// Scrolls the preview to the same fraction of its length as the editor, so the
// two stay roughly abreast without knowing which line is which.
// The preview glides to its place rather than jumping: each frame covers a share
// of the distance left, so a fast scroll in the editor is followed smoothly and
// a re-render that changes the height does not snap the view.
let previewGoal = 0;
let previewGlide = 0;

function syncPreviewScroll() {
    if (mode !== 'split') return;
    const room = bodyEl.scrollHeight - bodyEl.clientHeight;
    const ratio = room > 0 ? bodyEl.scrollTop / room : 0;
    previewGoal = ratio * Math.max(0, previewEl.scrollHeight - previewEl.clientHeight);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(previewGoal - previewEl.scrollTop) < 2) {
        previewEl.scrollTop = previewGoal;
        return;
    }
    if (previewGlide) return;
    const step = () => {
        const gap = previewGoal - previewEl.scrollTop;
        if (mode !== 'split' || Math.abs(gap) < 0.5) {
            previewEl.scrollTop = previewGoal;
            previewGlide = 0;
            return;
        }
        previewEl.scrollTop += gap * 0.3;
        previewGlide = requestAnimationFrame(step);
    };
    previewGlide = requestAnimationFrame(step);
}

// Flips `[ ]` / `[x]` on one source line (also inside a quote) and re-renders
// the preview in place, keeping the scroll position.
function toggleTask(lineNo) {
    const lines = bodyEl.value.split('\n');
    const line = lines[lineNo];
    if (line === undefined) return;
    const next = line.replace(
        /^(\s*(?:>\s?)*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/,
        (_, a, mark, c) => `${a}${mark === ' ' ? 'x' : ' '}${c}`,
    );
    if (next === line) return;
    lines[lineNo] = next;
    bodyEl.value = lines.join('\n');
    view.refreshNow();
    scheduleSave();
    const scroll = previewEl.scrollTop;
    renderPreview();
    previewEl.scrollTop = scroll;
}

// --- Preview: rendering, code highlighting, copy ---

// Redraws the preview block by block: a block whose markup is the same as last
// time is left alone, so typing in one paragraph repaints one paragraph, and
// the code blocks above and below keep their highlighting instead of flashing
// plain while it is fetched again. (Highlighting changes a block's DOM, so each
// block remembers the markup it was drawn from rather than being compared live.)
const drawnFrom = new WeakMap();

function renderPreview() {
    const html = renderMarkdown(bodyEl.value) || '<p class="md-empty">Nothing to preview yet.</p>';
    const next = document.createElement('template');
    next.innerHTML = html;
    const fresh = [...next.content.children];
    const have = [...previewEl.children];
    for (let i = 0; i < fresh.length; i++) {
        const markup = fresh[i].outerHTML;
        if (have[i] && drawnFrom.get(have[i]) === markup) continue;
        drawnFrom.set(fresh[i], markup);
        if (have[i]) previewEl.replaceChild(fresh[i], have[i]);
        else previewEl.appendChild(fresh[i]);
        highlightCodeBlocks(fresh[i]);
        resolveLocalImages(fresh[i]);
    }
    for (let i = have.length - 1; i >= fresh.length; i--) have[i].remove();
}

// --- Go to a line or a heading (Ctrl+G) ---

// The caret's line, counted from 0.
function caretLineIndex() {
    return bodyEl.value.slice(0, bodyEl.selectionStart).split('\n').length - 1;
}

function openKeys() {
    if (!current) return;
    hideSuggest();
    keysHelp.open();
}

function openJump() {
    if (!current) return;
    hideSuggest();
    jump.open(mode === 'preview' ? 0 : caretLineIndex());
}

// Takes the caret to the start of `line` and glides the text so the line sits a third
// of the way down. In Preview, which has no caret, it is the heading that is scrolled to.
function goToLine(line) {
    if (mode === 'preview') {
        const index = outline(bodyEl.value).findIndex((h) => h.line === line);
        const heading = index >= 0 ? previewEl.querySelectorAll('h1,h2,h3,h4,h5,h6')[index] : null;
        let top;
        if (heading) {
            top = heading.getBoundingClientRect().top - previewEl.getBoundingClientRect().top + previewEl.scrollTop - 12;
        } else {
            // Not a heading: the preview does not know which line is which, so go by how far
            // down the note the line is.
            const lines = Math.max(1, bodyEl.value.split('\n').length - 1);
            top = (line / lines) * (previewEl.scrollHeight - previewEl.clientHeight);
        }
        previewEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        return;
    }
    const at = offsetOfLine(bodyEl.value, line);
    bodyEl.focus();
    bodyEl.setSelectionRange(at, at);
    const place = caretPosition(at);
    bodyEl.scrollTo({ top: Math.max(0, bodyEl.scrollTop + place.top - bodyEl.clientHeight * 0.3), behavior: 'smooth' });
    view.markActive();
    view.syncScroll();
}

// --- Templates ---

// The manager replaces the list while it is open and gives it back when it closes.
function openTemplates() {
    searchBar.hidden = true;
    toolbar.hidden = true;
    tagBar.hidden = true;
    grid.hidden = true;
    void templates.open();
}

// A new note that starts from a template, the caret where the template says.
function newNoteFrom({ body }) {
    templates.close();
    if (current) void flush();
    const { text, caret } = expandTemplate(body, { title: '' });
    const now = Math.floor(Date.now() / 1000);
    openEditor({
        id: newId(),
        title: '',
        body: text,
        tags: activeTag ? [activeTag] : [],
        created_at_unix_s: now,
        updated_at_unix_s: now,
    });
    bodyEl.focus();
    bodyEl.setSelectionRange(caret, caret);
    scheduleSave();
}

// What "/" then Template on the first line leads to: the templates as a list to pick
// from, at the caret, in the same menu the blocks use.
async function showTemplatePicker() {
    let found = [];
    try {
        found = await notesTemplatesList();
    } catch (err) {
        console.warn('[note] templates unavailable:', err);
    }
    if (!found.length) {
        setStatus('No templates yet. Open Templates in the notes list to make one.');
        return;
    }
    suggestItems = found.map((t) => ({
        template: t,
        label: t.name,
        hint: templateLine(t.body).slice(0, 28),
        icon: fileTextIcon,
    }));
    suggestRows = suggestItems.map((item, index) => ({ type: 'item', item, index }));
    suggestIndex = 0;
    suggestEl.hidden = false;
    renderSuggest();
    positionSuggest();
}

// --- Pasting and dropping pictures ---

// The pictures among `files`. A paste that also carries text (a spreadsheet cell, a
// copied sentence) is text, not a picture, so the text goes in as usual.
function pictureFiles(files, clipboard) {
    const pictures = [...(files ?? [])].filter((f) => /^image\/(png|jpeg|gif|webp|bmp|avif|svg\+xml)$/.test(f.type));
    if (!pictures.length) return [];
    if (clipboard && clipboard.getData('text/plain').trim()) return [];
    return pictures;
}

function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// Saves each picture and writes `![name](path)` for it at the caret, one per line.
// The place is taken before the (async) save, so typing meanwhile does not move it.
async function insertPictures(files) {
    const start = bodyEl.selectionStart;
    const end = bodyEl.selectionEnd;
    setStatus('Saving image…');
    try {
        const lines = [];
        for (const file of files) {
            const ext = file.type.replace('image/', '').replace('svg+xml', 'svg');
            const path = await notesSaveImage(await fileAsBase64(file), ext);
            // A screenshot is called "image.png" and says nothing; a dropped file's name does.
            const name = file.name.replace(/\.[^.]+$/, '');
            const alt = /^(image|screenshot)$/i.test(name) ? '' : name.replace(/[\[\]]/g, '');
            lines.push(`![${alt}](${path})`);
        }
        const before = bodyEl.value.slice(0, start);
        // On its own line: after text on the same line it starts a new one.
        const lead = before && !before.endsWith('\n') ? '\n' : '';
        const text = `${lead}${lines.join('\n')}\n`;
        replaceRange(start, end, text, start + text.length);
        setStatus('');
    } catch (err) {
        console.error('[note] saving the image failed:', err);
        setStatus(`Could not save the image: ${escapeHtml(String(err))}`, true);
    }
}

// --- Images in the preview ---

// A picture on this machine is shown through the address Tauri gives the webview
// for it (the asset protocol, scoped to the home folder).
function resolveLocalImages(root) {
    for (const img of root.querySelectorAll('img[data-local]')) {
        try {
            img.src = window.__TAURI__.core.convertFileSrc(img.dataset.local);
        } catch {
            img.closest('.md-imgbox')?.classList.add('broken');
        }
    }
}

// Writes an image's new width into its alt text in the note (`![logo|320](...)`), or
// takes it out for `null`, then redraws. The textarea may be hidden (preview mode),
// so the value is set directly and an input event tells the rest of the editor.
function setImageWidth(index, width) {
    const next = withImageWidth(bodyEl.value, index, width);
    if (next === null || next === bodyEl.value) return;
    const scroll = previewEl.scrollTop;
    bodyEl.value = next;
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
    renderPreview();
    previewEl.scrollTop = scroll;
}

// Dragging the round handle at an image's corner resizes it live; letting go saves
// the width. The image never grows past the page, and never below 40px.
function onPreviewPointerDown(e) {
    const handle = e.target.closest?.('.md-img-handle');
    if (!handle) return;
    const box = handle.closest('.md-imgbox');
    e.preventDefault();
    const index = Number(box.dataset.img);
    const startX = e.clientX;
    const startWidth = box.getBoundingClientRect().width;
    const widest = Math.max(80, previewEl.clientWidth - 48);
    let width = Math.round(startWidth);
    handle.setPointerCapture(e.pointerId);
    box.classList.add('resizing');
    box.dataset.size = `${width}px`;
    const move = (ev) => {
        width = Math.max(40, Math.min(widest, Math.round(startWidth + ev.clientX - startX)));
        box.style.width = `${width}px`;
        box.dataset.size = `${width}px`;
    };
    const done = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', done);
        handle.removeEventListener('pointercancel', done);
        box.classList.remove('resizing');
        delete box.dataset.size;
        setImageWidth(index, width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', done);
    handle.addEventListener('pointercancel', done);
}

// --- Tags (editor) ---

const TAG_MAX = 24;
const TAGS_MAX = 8;

function renderTags() {
    tagsEl.querySelectorAll('.cmd-note-tagpill').forEach((el) => el.remove());
    for (const t of current.tags) {
        const pill = document.createElement('span');
        pill.className = 'cmd-note-tagpill';
        pill.style.cssText = tagStyle(t);
        pill.innerHTML =
            `<button type="button" class="cmd-note-tagdot" data-color-tag="${escapeHtml(t)}" title="Change colour"></button>` +
            `${escapeHtml(t)}<button type="button" data-del-tag="${escapeHtml(t)}" title="Remove tag">×</button>`;
        tagsEl.insertBefore(pill, tagInput);
    }
    tagInput.hidden = current.tags.length >= TAGS_MAX;
    updateTagMenu();
}

// --- Tag suggestion menu (under the tag input) ---

let tagMenuItems = [];
let tagMenuIndex = -1; // -1: nothing highlighted, so Enter adds what was typed

const tagMenuOpen = () => !tagMenu.hidden;

function updateTagMenu() {
    if (!current || document.activeElement !== tagInput) return hideTagMenu();
    const q = tagInput.value.replace(/[,#]/g, '').trim().toLowerCase();
    const counts = new Map();
    for (const n of notes) {
        for (const t of n.tags) if (!current.tags.includes(t)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    tagMenuItems = [...counts]
        .filter(([t]) => t.includes(q))
        .sort((a, b) => (b[0].startsWith(q) - a[0].startsWith(q)) || b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([tag, count]) => ({ tag, count }));
    // Offer to create what was typed unless it already is a tag.
    if (q && !counts.has(q) && !current.tags.includes(q)) tagMenuItems.push({ tag: q, create: true });
    if (!tagMenuItems.length) return hideTagMenu();
    tagMenuIndex = Math.min(tagMenuIndex, tagMenuItems.length - 1);
    renderTagMenu();
    tagMenu.hidden = false;
    tagMenu.style.left = `${tagInput.offsetLeft}px`;
    tagMenu.style.top = `${tagInput.offsetTop + tagInput.offsetHeight + 4}px`;
}

function renderTagMenu() {
    tagMenu.innerHTML = tagMenuItems
        .map(
            (it, i) =>
                `<div class="cmd-note-tagmenu-row${i === tagMenuIndex ? ' active' : ''}" data-i="${i}">
                    <i class="cmd-note-dot" style="${tagStyle(it.tag)}"></i>
                    <span class="cmd-note-tagmenu-name">${escapeHtml(it.tag)}</span>
                    <span class="cmd-note-tagmenu-meta">${it.create ? 'New tag' : it.count}</span>
                </div>`,
        )
        .join('');
    revealWithin(tagMenu, tagMenu.querySelector('.active'));
}

function hideTagMenu() {
    tagMenuIndex = -1;
    tagMenuItems = [];
    if (tagMenu) tagMenu.hidden = true;
}

function moveTagMenu(dir) {
    const n = tagMenuItems.length;
    tagMenuIndex = tagMenuIndex < 0 ? (dir > 0 ? 0 : n - 1) : (tagMenuIndex + dir + n) % n;
    renderTagMenu();
}

function openColorPicker(tag, anchor) {
    colorsTag = tag;
    const selected = tagIndex(tag);
    colorsEl.innerHTML =
        TAG_HUES.map(
            (_, i) =>
                `<button type="button" class="cmd-note-swatch${i === selected ? ' active' : ''}" data-c="${i}" style="${swatchStyle(i)}" title="Colour ${i + 1}"></button>`,
        ).join('') +
        `<button type="button" class="cmd-note-swatch-auto" data-c="" title="Back to the automatic colour">Auto</button>`;
    colorsEl.hidden = false;
    const p = panel.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const left = Math.max(4, Math.min(a.left - p.left, p.width - colorsEl.offsetWidth - 4));
    colorsEl.style.left = `${left}px`;
    colorsEl.style.top = `${a.bottom - p.top + 6}px`;
}

function closeColorPicker() {
    colorsTag = null;
    if (colorsEl) colorsEl.hidden = true;
}

function pickTagColor(tag, index) {
    if (index === null) tagPicks.delete(tag);
    else tagPicks.set(tag, index);
    closeColorPicker();
    if (current) renderTags();
    else renderGrid();
    notesSetTagColor(tag, index).catch((err) => console.error('[note] tag colour failed:', err));
}

// Mirrors core/notes normalize_tags so what is shown is what gets stored.
function addTag(raw) {
    if (!current) return;
    const tag = String(raw).replace(/[,#]/g, '').trim().toLowerCase().slice(0, TAG_MAX);
    tagInput.value = '';
    if (!tag || current.tags.includes(tag) || current.tags.length >= TAGS_MAX) return;
    current.tags.push(tag);
    renderTags();
    scheduleSave();
}

function removeTag(tag) {
    if (!current) return;
    current.tags = current.tags.filter((t) => t !== tag);
    renderTags();
    scheduleSave();
    tagInput.focus();
}

// Two clicks to delete: the first arms the button, the second confirms.
function onDeleteClick() {
    if (!current) return;
    if (!deleteArmed) {
        deleteArmed = true;
        deleteBtn.classList.add('cmd-note-delete-armed');
        deleteBtn.innerHTML = `${trashIcon} Click again to delete`;
        deleteTimer = setTimeout(disarmDelete, 3000);
        return;
    }
    const id = current.id;
    disarmDelete();
    clearTimeout(saveTimer);
    dirty = false;
    notes = notes.filter((n) => n.id !== id);
    current = null;
    pendingSave = pendingSave.then(() => notesDelete(id)).catch((err) => {
        console.error('[note] delete failed:', err);
    });
    showList();
}

function disarmDelete() {
    deleteArmed = false;
    clearTimeout(deleteTimer);
    if (!deleteBtn) return;
    deleteBtn.classList.remove('cmd-note-delete-armed');
    deleteBtn.innerHTML = `${trashIcon} Delete`;
}

function setStatus(html, isError = false) {
    statusEl.innerHTML = html;
    statusEl.classList.toggle('cmd-note-status-error', isError);
}

// Scrolls `box` just enough to show `row`, and nothing else. scrollIntoView also
// scrolls every ancestor, including the editor's clipped wrapper, which shoved the
// whole editor up when the last row of a menu was reached.
function revealWithin(box, row) {
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}
// Tab / Shift+Tab: a list item moves a level in or out and a heading gains or loses
// a `#` (their colour follows, it is read from the text); anything else is indented
// the plain way. In a code block it is always the plain indent: `# x` is a comment there.
function changeLevel(dir) {
    if (!inCodeBlock() && applyTable(shiftLevel, dir)) return;
    indentLines(dir < 0);
}

// True while the caret is inside a fenced block, where typing : or > is code, not a shortcut.
function inCodeBlock() {
    const ctx = codeContext(bodyEl.value, bodyEl.selectionStart);
    return !!ctx && ctx.kind !== 'lang';
}

// --- "/" block menu ---

function updateSuggest() {
    if (mode === 'preview' || !current) return hideSuggest();
    const { selectionStart: pos, selectionEnd: end, value } = bodyEl;
    if (pos !== end) return hideSuggest();
    const [ls] = lineBounds(pos);
    // Code: the language after an opening fence, words inside a block. Inside a
    // block nothing else (emoji, tags, the "/" menu) is offered.
    const code = codeContext(value, pos);
    if (code) {
        let items = [];
        if (code.kind === 'lang') {
            items = filterLanguages(code.query).map((l) => ({ code: 'lang', id: l.id, name: l.name, query: code.query }));
        } else if (code.kind === 'word') {
            items = filterWords(code).map((w) => ({ code: 'word', word: w.word, kind: w.kind, query: code.query }));
        }
        if (!items.length) return hideSuggest();
        codeFrom = code.from;
        suggestItems = items;
        suggestRows = items.map((item, index) => ({ type: 'row', item, index }));
        suggestIndex = 0;
        suggestEl.hidden = false;
        renderSuggest();
        positionSuggest();
        return;
    }
    // `:` and a few letters: emoji by name.
    const emoji = emojiContext(value, pos);
    if (emoji) {
        const hits = filterEmoji(emoji.query);
        if (!hits.length) return hideSuggest();
        emojiFrom = emoji.from;
        suggestItems = hits.map((h) => ({ emoji: h.char, name: h.name, query: emoji.query, label: `:${h.name}:` }));
        suggestRows = suggestItems.map((item, index) => ({ type: 'row', item, index }));
        suggestIndex = 0;
        suggestEl.hidden = false;
        renderSuggest();
        positionSuggest();
        return;
    }
    // `<` and a few letters: the HTML tags that start with them.
    const tag = tagContext(value, pos);
    if (tag) {
        const tags = filterTags(tag.prefix);
        if (!tags.length) return hideSuggest();
        tagFrom = tag.from;
        suggestItems = tags.map((t) => ({ tag: t, label: `<${t}`, icon: '<span class="cmd-note-tag-t">t</span>' }));
        suggestRows = suggestItems.map((item, index) => ({ type: 'row', item, index }));
        suggestIndex = 0;
        suggestEl.hidden = false;
        renderSuggest();
        positionSuggest();
        return;
    }
    const m = value.slice(ls, pos).match(/^\s*\/([a-z0-9]*)$/i);
    if (!m) return hideSuggest();
    // Template is for starting a note: it is only offered on its first line.
    const arranged = slash.arrange(slash.filter(m[1]).filter((s) => !s.firstLineOnly || ls === 0));
    suggestItems = arranged.ordered;
    suggestRows = arranged.rows;
    if (!suggestItems.length) return hideSuggest();
    suggestIndex = 0;
    suggestEl.hidden = false;
    renderSuggest();
    positionSuggest();
}

function renderSuggest() {
    // Rebuilding the rows resets the list's scroll, so keep it and then bring
    // the highlighted row into view; otherwise Up/Down walks off the visible
    // part of a long menu.
    const scroll = suggestEl.scrollTop;
    // Group headings between the rows; only the rows carry a data-i, so a click on
    // a heading picks nothing.
    suggestEl.innerHTML = suggestRows
        .map((row) => {
            if (row.type === 'group') {
                return `<div class="cmd-note-suggest-group">${escapeHtml(row.label)}</div>`;
            }
            const { item, index } = row;
            if (item.code) {
                // The typed part in bold; a language shows its name on the right,
                // a word whether it is a keyword or text already in the block.
                const shown = item.code === 'lang' ? item.id : item.word;
                const at = shown.toLowerCase().indexOf(item.query.toLowerCase());
                const bold = at < 0
                    ? escapeHtml(shown)
                    : `${escapeHtml(shown.slice(0, at))}<b>${escapeHtml(shown.slice(at, at + item.query.length))}</b>${escapeHtml(shown.slice(at + item.query.length))}`;
                const lead = item.code === 'lang' ? '<span class="cmd-note-fence">```</span>' : '';
                const tail = item.code === 'lang' ? item.name : item.kind;
                return `<div class="cmd-note-suggest-row cmd-note-suggest-code${index === suggestIndex ? ' active' : ''}" data-i="${index}">
                    <span class="cmd-note-suggest-label">${lead}${bold}</span>
                    <span class="cmd-note-suggest-kind">${escapeHtml(tail)}</span>
                </div>`;
            }
            if (item.emoji) {
                // `:ta` of `:table_tennis...:` in bold, the emoji on the right.
                const at = item.name.indexOf(item.query);
                const name = at < 0
                    ? escapeHtml(item.name)
                    : `${escapeHtml(item.name.slice(0, at))}<b>${escapeHtml(item.query)}</b>${escapeHtml(item.name.slice(at + item.query.length))}`;
                return `<div class="cmd-note-suggest-row cmd-note-suggest-emoji${index === suggestIndex ? ' active' : ''}" data-i="${index}">
                    <span class="cmd-note-suggest-label">:${name}:</span>
                    <span class="cmd-note-emoji">${item.emoji}</span>
                </div>`;
            }
            const tone = item.tone ? ` tone-${item.tone}` : '';
            return `<div class="cmd-note-suggest-row${index === suggestIndex ? ' active' : ''}" data-i="${index}">
                    <span class="cmd-note-suggest-icon${tone}">${item.icon}</span>
                    <span class="cmd-note-suggest-label">${escapeHtml(item.label)}</span>
                    ${item.hint ? `<code>${escapeHtml(item.hint)}</code>` : ''}
                </div>`;
        })
        .join('');
    suggestEl.scrollTop = scroll;
    revealWithin(suggestEl, suggestEl.querySelector('.active'));

}

// Pixel position of character `pos` inside the textarea, measured by laying
// the same text out in an off-screen mirror with identical wrapping. Relative
// to the textarea's top-left corner, with its own scroll already subtracted.
function caretPosition(pos) {
    const cs = getComputedStyle(bodyEl);
    const mirror = document.createElement('div');
    for (const prop of [
        'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
        'tabSize', 'textTransform', 'textIndent',
    ]) {
        mirror.style[prop] = cs[prop];
    }
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    // What the textarea shows (folded lines left out), so a popup lands where the caret is.
    mirror.textContent = view.displayText().slice(0, view.toDisplayOffset(pos));
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);
    bodyEl.parentElement.appendChild(mirror);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const pos2 = {
        left: marker.offsetLeft - bodyEl.scrollLeft,
        top: marker.offsetTop - bodyEl.scrollTop,
        lineHeight,
    };
    mirror.remove();
    return pos2;
}

// Anchors the menu just under the caret; flips above it when there is no room
// below, and stays inside the editor horizontally.
function positionSuggest() {
    if (suggestEl.hidden) return;
    const wrap = bodyEl.parentElement;
    const caret = caretPosition(bodyEl.selectionStart);
    const menuW = suggestEl.offsetWidth;
    const menuH = suggestEl.offsetHeight;
    const left = Math.max(4, Math.min(caret.left, wrap.clientWidth - menuW - 4));
    let top = caret.top + caret.lineHeight + 4;
    if (top + menuH > wrap.clientHeight - 4 && caret.top - menuH - 4 >= 0) {
        top = caret.top - menuH - 4;
    }
    suggestEl.style.left = `${left}px`;
    suggestEl.style.top = `${Math.max(4, top)}px`;
}

function hideSuggest() {
    if (suggestEl) suggestEl.hidden = true;
    suggestItems = [];
    suggestRows = [];
}

// --- Selection toolbar ---

function buildBubble() {
    bubbleEl.innerHTML = BUBBLE.map((tool) => {
        if (tool === 'sep') return '<span class="sep"></span>';
        const body = tool.icon ?? escapeHtml(tool.glyph);
        return `<button type="button" data-tool="${tool.id}" class="${tool.cls ?? ''}" title="${escapeHtml(tool.title)}">${body}</button>`;
    }).join('');
    // mousedown, not click, and never default: a click would blur the textarea
    // and take the selection (and this toolbar) away before it ran.
    bubbleEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const button = e.target.closest('[data-tool]');
        const tool = button && BUBBLE.find((t) => t !== 'sep' && t.id === button.dataset.tool);
        if (!tool) return;
        applyOp(tool.run);
        view.refresh();
        updateBubble();
    });
}

// Shown over a selected range in the writing pane, hidden otherwise.
function updateBubble() {
    if (!current || mode === 'preview' || document.activeElement !== bodyEl) return hideBubble();
    const { selectionStart: start, selectionEnd: end } = bodyEl;
    if (start === end || !suggestEl.hidden) return hideBubble();
    bubbleEl.hidden = false;
    positionBubble(start, end);
}

function hideBubble() {
    if (bubbleEl) bubbleEl.hidden = true;
}

// Above the start of the selection, centred over it when it is on one line;
// below its last line when there is no room above. The toolbar lives in the
// body wrap (the writing pane clips, and the toolbar can be wider than a split
// half), so the caret's coordinates, which are the textarea's, are moved over.
function positionBubble(start, end) {
    const first = caretPosition(start);
    const last = caretPosition(end);
    const wrap = wrapEl.getBoundingClientRect();
    const area = bodyEl.getBoundingClientRect();
    const dx = area.left - wrap.left;
    const dy = area.top - wrap.top;
    const width = bubbleEl.offsetWidth;
    const height = bubbleEl.offsetHeight;
    const sameLine = Math.abs(first.top - last.top) < 1;
    const middle = dx + (sameLine ? (first.left + last.left) / 2 : first.left + 24);
    const left = Math.max(4, Math.min(middle - width / 2, wrap.width - width - 4));
    let top = dy + first.top - height - 8;
    if (top < 4) top = dy + last.top + last.lineHeight + 8;
    top = Math.min(top, wrap.height - height - 4);
    bubbleEl.style.left = `${left}px`;
    bubbleEl.style.top = `${Math.max(4, top)}px`;
}

function applySuggestion(item) {
    if (!item) return;
    const pos = bodyEl.selectionStart;
    if (item.code) {
        hideSuggest();
        const value = bodyEl.value;
        const text = item.code === 'lang' ? item.id : item.word;
        // A fence with nothing closing it gets its closing fence, so the block is whole.
        const closed = item.code === 'lang' && /^\s*```/m.test(value.slice(pos));
        if (item.code === 'lang' && !closed) {
            replaceRange(codeFrom, pos, `${text}\n\n\`\`\``, codeFrom + text.length + 1);
        } else {
            replaceRange(codeFrom, pos, text, codeFrom + text.length);
        }
        return;
    }
    if (item.emoji) {
        hideSuggest();
        replaceRange(emojiFrom, pos, item.emoji, emojiFrom + item.emoji.length);
        return;
    }
    if (item.tag) {
        const { text, caret } = tagInsert(item.tag);
        hideSuggest();
        replaceRange(tagFrom, pos, text, tagFrom + caret);
        return;
    }
    if (item.template) {
        hideSuggest();
        const { text, caret } = expandTemplate(item.template.body, { title: titleInput.value });
        replaceRange(pos, pos, text, pos + caret);
        return;
    }
    const [ls] = lineBounds(pos);
    const indent = bodyEl.value.slice(ls, pos).match(/^\s*/)[0];
    if (item.action) {
        // Go to and Template do something instead of typing a block: the typed /word
        // goes, then the box or the list opens.
        hideSuggest();
        replaceRange(ls + indent.length, pos, '', ls + indent.length);
        if (item.action === 'goto') openJump();
        else if (item.action === 'keys') openKeys();
        else setTimeout(() => void showTemplatePicker(), 0);
        return;
    }
    const raw = typeof item.text === 'function' ? item.text() : item.text;
    const caretAt = raw.indexOf('|');
    const text = raw.replace('|', '');
    // Multi-line blocks keep the line's indent so they stay inside a list item.
    const body = text.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n');
    const caretOffset = caretAt < 0 ? body.length : caretAt + (body.slice(0, caretAt).split('\n').length - 1) * indent.length;
    hideSuggest();
    replaceRange(ls + indent.length, pos, body, ls + indent.length + caretOffset);
}
