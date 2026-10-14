// Single source of truth for query prefixes and slash commands, mirroring
// macOS AppConstants.swift (PrefixSuggestion + commandCatalog) so the
// `"` menu, the `:` menu, and the Help screen can't drift. linows omits
// `tw"` (no dictionary lookup yet).

import {
    calculator,
    timer,
    listChecks,
    notebook,
    bot,
    gauge,
    xCircle,
    terminal,
    info,
    globe,
    clipboard,
    image,
    fileText,
    alertCircle,
} from './icons.js';

// The two histories share one empty screen and differ only in the wording, so
// the words travel as data (macOS ClipboardEmptyStateCopy). results.js draws
// the info half, preview.js the tips half.
export const CLIPBOARD_EMPTY_COPY = {
    clipboard: {
        icon: clipboard,
        title: 'Clipboard History',
        body: 'No clipboard items yet',
        help: 'Copy any text, then search with <kbd>c"word</kbd> to find it here.',
        tips: [
            'Type <kbd>c"</kbd> to list latest 10 clips',
            'Type <kbd>c"mail</kbd> to filter',
            'Press <kbd>Enter</kbd> to copy selected item',
        ],
    },
    'clipboard-image': {
        icon: image,
        title: 'Copied Images',
        body: 'No images copied yet',
        help: 'Copy a picture or take a screenshot, then find it here with <kbd>ci"name</kbd>.',
        tips: [
            'Type <kbd>ci"</kbd> to list the latest images',
            'Type <kbd>ci"firefox</kbd> to filter by name',
            'Press <kbd>Enter</kbd> to copy the selected image',
        ],
    },
};

/** The "How to use" half of a clipboard empty state. */
export function clipboardTipsHtml(copy) {
    const tips = copy.tips
        .map((tip) => `<div class="preview-clip-help-line">• ${tip}</div>`)
        .join('');
    return `
    <div class="preview-clip-help">
      <div class="preview-clip-help-title">How to use</div>
      ${tips}
    </div>`;
}

// What each history says when a row is forgotten, keyed as above.
export const CLIPBOARD_DELETED_BANNER = {
    clipboard: 'Clipboard item deleted',
    'clipboard-image': 'Image removed from history',
};

// Synthetic-row id namespaces: the renderer and Enter/click handlers tell
// synthetic rows apart from real candidates by id prefix.
const PREFIX_HINT_ID = 'prefixhint:';
const COMMAND_HINT_ID = 'cmdhint:';
const WEB_SUGGEST_ID = 'websuggest:';
const WEB_URL_ID = 'weburl:';
const CALC_ID = 'calc:';
const QUICK_ID = 'quick:';
const MEMO_NOTE_ID = 'memonote:';
const MEMO_TASK_ID = 'memotask:';
const SNIPPET_ID = 'snippet:';
const WINDOW_ID = 'win:';
const DISCOVERY_CHAR = '"';
export const NOTES_PREFIX = 'n"';
export const SNIPPETS_PREFIX = 's"';
export const WINDOWS_PREFIX = 'w"';

// Google-autocomplete row glyph: Lucide `search` (mirrors macOS, which uses
// SF Symbols "magnifyingglass"). Inlined here rather than imported as a
// dedicated icon constant since this is the only place that needs it.
const SEARCH_GLYPH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

const PREFIX_ENTRIES = [
    { prefix: 'a"', argHint: 'word', description: 'Apps only' },
    { prefix: 'f"', argHint: 'word', description: 'Files only' },
    { prefix: 'd"', argHint: 'word', description: 'Folders only' },
    {
        prefix: 'rc"',
        argHint: 'word',
        description: 'Recent files/folders, newest first (optional filter)',
    },
    { prefix: 'r"', argHint: 'pattern', description: 'Regex search' },
    { prefix: 'ps"', argHint: 'word', description: 'Find & kill running processes' },
    {
        prefix: 'c"',
        argHint: 'word',
        description: 'Clipboard history search (latest 10 text clips)',
    },
    { prefix: 'ci"', argHint: 'word', description: 'Copied images, newest first' },
    {
        prefix: NOTES_PREFIX,
        argHint: 'word',
        description: 'Your notes, newest first (optional filter)',
    },
    {
        prefix: SNIPPETS_PREFIX,
        argHint: 'word',
        description: 'Text snippets, pasted into the app you were in',
    },
    {
        prefix: WINDOWS_PREFIX,
        argHint: 'word',
        description: 'Open windows, front to back (Windows)',
    },
    { prefix: 't"', argHint: 'word', description: 'Web translate (VI/EN/JA)' },
];

// Catalog order is the whole shortcut mapping: Ctrl+N selects the Nth entry
// (see screens/commands/index.js, which builds its sidebar from this list), so
// the number in each title is derived rather than written and reordering here
// is enough. Mirrors the macOS `commandDefinitions`.
const COMMAND_DEFINITIONS = [
    { id: 'todo', detail: 'Daily tasks & progress', icon: listChecks },
    { id: 'pomo', detail: 'Pomodoro focus timer', icon: timer },
    { id: 'note', detail: 'Quick notes & ideas (Markdown)', icon: notebook },
    {
        id: 'kill',
        detail: 'Force kill app or process by name, port, or PID',
        icon: xCircle,
    },
    { id: 'shell', detail: 'Run a shell command', icon: terminal },
    { id: 'calc', detail: 'Evaluate math expression', icon: calculator },
    {
        id: 'speed',
        detail: 'Measure internet download, upload, and latency',
        icon: gauge,
    },
    { id: 'sys', detail: 'Show system information', icon: info },
    { id: 'agents', detail: 'Coding agents & quota', icon: bot },
];

export const COMMAND_ENTRIES = COMMAND_DEFINITIONS.map((entry, index) => ({
    ...entry,
    shortcut: index + 1,
    title: `${entry.id}`,
}));

// True when `id` names a built-in command, for the `:cmd <args>` live trigger.
export function isCommandId(id) {
    return COMMAND_ENTRIES.some((entry) => entry.id === id);
}

// Quick capture from the search box (see components/quickcapture.js):
//   :note <text>   save a note        :todo <text>   add a task to today
//   :done [text]   tick off an open task
// `:note` and `:todo` need a space and some intent to count, so a bare `:note`
// is still the discovery menu and Enter on it opens the panel as before.
export function parseQuickCapture(query) {
    const m = String(query).trimStart().match(/^:(note|todo|done)(?:\s+([\s\S]*))?$/i);
    if (!m) return null;
    const word = m[1].toLowerCase();
    if (word !== 'done' && m[2] === undefined) return null;
    const action = word === 'note' ? 'note' : word === 'todo' ? 'task' : 'done';
    return { action, text: (m[2] ?? '').trim() };
}

// `buy milk #errands #home` -> { body: 'buy milk', tags: ['errands', 'home'] }.
export function splitNoteTags(text) {
    const tags = [];
    const body = String(text)
        .replace(/(^|\s)#([\p{L}\p{N}_-]{1,24})(?=\s|$)/gu, (_, space, tag) => {
            tags.push(tag.toLowerCase());
            return space;
        })
        .replace(/\s+/g, ' ')
        .trim();
    return { body, tags: [...new Set(tags)].slice(0, 8) };
}

export function quickResultId(action, payload = '') {
    return `${QUICK_ID}${action}:${payload}`;
}

function quickFromResultId(resultId) {
    if (!resultId?.startsWith(QUICK_ID)) return null;
    const rest = resultId.slice(QUICK_ID.length);
    const i = rest.indexOf(':');
    return i < 0 ? { action: rest, payload: '' } : { action: rest.slice(0, i), payload: rest.slice(i + 1) };
}

// True when `:cmd <ws>` should bypass the discovery menu and live-trigger
// the command panel (matches macOS extractInlineCommand). Bare `:calc` keeps
// the menu open; only whitespace after a known id flips the trigger.
function isInlineCommandWithArgs(query) {
    if (!query.startsWith(':')) return false;
    if (parseQuickCapture(query)) return false;
    const spaceIdx = query.slice(1).search(/\s/);
    if (spaceIdx < 0) return false;
    return isCommandId(query.slice(1, 1 + spaceIdx).toLowerCase());
}

export function isPrefixSuggestionQuery(query) {
    return query.trimStart().startsWith(DISCOVERY_CHAR);
}

// True when the query is in any prefix-driven mode: the `"`/`:` discovery
// menus, an inline `:cmd <args>`, or one of the PREFIX_ENTRIES (a"/f"/d"/
// rc"/r"/c"/t"). Web suggestions and AI/Wikipedia lookups are gated off
// for these. The query is a launcher scope, not a knowledge question.
// Adding a new prefix to PREFIX_ENTRIES picks up everywhere automatically.
export function isPrefixedQuery(query) {
    const trimmed = (query || '').trimStart();
    if (!trimmed) return false;
    if (trimmed.startsWith(DISCOVERY_CHAR) || trimmed.startsWith(':')) return true;
    return PREFIX_ENTRIES.some((e) => trimmed.startsWith(e.prefix));
}

// `#dev` names a note tag in Look, so it is a local lookup: no web answer card,
// no Google completions (which for a hashtag are noise).
export function isTagQuery(query) {
    return (query || '').trimStart().startsWith('#');
}

export function isCommandSuggestionQuery(query) {
    const trimmed = query.trimStart();
    return trimmed.startsWith(':') && !isInlineCommandWithArgs(trimmed);
}

// Synthetic rows backing the `"` menu, narrowed by what the user typed after
// the leading `"`. Case-insensitive substring match against prefix, display
// form, and description, so `"folder` finds `d"` by intent rather than only
// by the cryptic prefix letter.
export function prefixSuggestionResults(query) {
    const filter = query.trimStart().slice(DISCOVERY_CHAR.length).trim().toLowerCase();
    const entries = filter
        ? PREFIX_ENTRIES.filter(
              (e) =>
                  e.prefix.toLowerCase().includes(filter) ||
                  (e.prefix + e.argHint).toLowerCase().includes(filter) ||
                  e.description.toLowerCase().includes(filter),
          )
        : PREFIX_ENTRIES;
    return entries.map((entry, index) => ({
        id: `${PREFIX_HINT_ID}${entry.prefix}`,
        kind: 'app',
        title: entry.prefix + entry.argHint,
        subtitle: entry.description,
        path: '',
        score: entries.length - index,
        iconSvg: SEARCH_GLYPH,
    }));
}

const QUICK_HINTS = [
    { keyword: 'note', fill: ':note ', title: ':note <text>', detail: 'Save a note without opening it', icon: notebook },
    { keyword: 'todo', fill: ':todo ', title: ':todo <text>', detail: 'Add a task to today', icon: listChecks },
    { keyword: 'done', fill: ':done', title: ':done', detail: 'Tick off one of today\'s tasks', icon: listChecks },
];

// Synthetic rows backing the `:` menu. `:end` or `:process` both surface
// `kill`. Each row carries its command's icon so the list scans visually.
export function commandSuggestionResults(query) {
    const filter = query.trimStart().slice(1).trim().toLowerCase();
    const entries = filter
        ? COMMAND_ENTRIES.filter(
              (e) => e.id.toLowerCase().includes(filter) || e.detail.toLowerCase().includes(filter),
          )
        : COMMAND_ENTRIES;
    const rows = entries.map((entry, index) => ({
        id: `${COMMAND_HINT_ID}${entry.id}`,
        kind: 'app',
        title: entry.title,
        subtitle: entry.detail,
        path: '',
        score: entries.length - index,
        iconSvg: entry.icon,
    }));

    // The quick captures, picked like a prefix: Enter fills the query.
    const hints = QUICK_HINTS.filter(
        (h) => !filter || h.keyword.includes(filter) || h.detail.toLowerCase().includes(filter),
    ).map((h, index) => ({
        id: `${PREFIX_HINT_ID}${h.fill}`,
        kind: 'app',
        title: h.title,
        subtitle: h.detail,
        path: '',
        score: -1 - index,
        iconSvg: h.icon,
    }));
    return [...rows, ...hints];
}

export function prefixFromResultId(resultId) {
    return resultId?.startsWith(PREFIX_HINT_ID) ? resultId.slice(PREFIX_HINT_ID.length) : null;
}

export function commandIdFromResultId(resultId) {
    return resultId?.startsWith(COMMAND_HINT_ID) ? resultId.slice(COMMAND_HINT_ID.length) : null;
}

// Google-autocomplete rows. Sit at the bottom of the results list when AI is
// on and the query is plain text (`>=2` chars, no mode prefix). Enter on one
// opens Google for that text. Mirrors macOS AppConstants.Launcher.WebSuggestion.
export function webSuggestionResults(suggestions) {
    return suggestions.map((text, index) => ({
        id: `${WEB_SUGGEST_ID}${text}`,
        kind: 'app',
        title: text,
        subtitle: 'Search Google',
        path: '',
        score: -1 - index,
        iconSvg: SEARCH_GLYPH,
    }));
}

export function webSuggestionFromResultId(resultId) {
    return resultId?.startsWith(WEB_SUGGEST_ID) ? resultId.slice(WEB_SUGGEST_ID.length) : null;
}

// Synthesized "Open <url>" rows (issue #232 + url-history spec). One shape
// shared by the live-classified row and history rows, so the open handler and
// preview key off the same id encoding. Mirrors macOS
// AppConstants.Launcher.WebURL.
export const WEB_URL_OPEN_SUBTITLE = 'Open in browser';
export const WEB_URL_RECENT_SUBTITLE = 'Recently opened';

// `PID: 1234 • Port: 3000 8080`, shared by the `ps"` row and the kill list.
export function processPidLabel(pid, ports) {
    return ports?.length ? `PID: ${pid} • Port: ${ports.join(' ')}` : `PID: ${pid}`;
}

export function webUrlResult(url, subtitle, score) {
    return {
        id: `${WEB_URL_ID}${url}`,
        kind: 'app',
        title: url,
        subtitle,
        path: url,
        score,
        iconSvg: globe,
    };
}

/**
 * Where the synthesized "open this URL" row sits (macOS URLRowPlacement).
 *
 * A structural URL cannot be a file or a search term, so it leads. A bare host
 * sits one below the best local match (issue #232), out of reach of a declared
 * source that carries the host in every subtitle and would bury it.
 */
export function placeUrlRow(url, isBareHost, ranked) {
    if (!isBareHost) return [url, ...ranked];
    return [...ranked.slice(0, 1), url, ...ranked.slice(1)];
}

export function webUrlFromResultId(resultId) {
    return resultId?.startsWith(WEB_URL_ID) ? resultId.slice(WEB_URL_ID.length) : null;
}

// Pinned above the results whenever the query is arithmetic. Title is the
// answer, subtitle the expression it was parsed from.
export function calcResult(expr, calculation) {
    return {
        id: `${CALC_ID}${calculation.raw}`,
        kind: 'app',
        title: calculation.display,
        subtitle: `${expr}  •  Enter to copy`,
        // Doubles as the path: keeps the preview cache key distinct from
        // other pathless rows, and makes Ctrl+C copy the result.
        path: calculation.raw,
        score: Number.MAX_SAFE_INTEGER,
        iconSvg: calculator,
        calcExpr: expr,
    };
}

// Notes and open tasks matching a plain query (core/notes, core/todo search).
// Enter opens the note in /note, or /todo for a task. `path` is the text Ctrl+C
// copies; the preview keys on the id, since two notes may share a title.
const MONTH_ABBR = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

export function noteResult(hit) {
    const tags = hit.tags?.length ? hit.tags.map((t) => `#${t}`).join(' ') : '';
    const detail = [hit.snippet, tags].filter(Boolean).join('  ·  ');
    return {
        id: `${MEMO_NOTE_ID}${hit.id}`,
        kind: 'app',
        title: hit.title,
        subtitle: detail ? `Note  ·  ${detail}` : 'Note',
        path: hit.title,
        score: hit.score,
        iconSvg: notebook,
        memoSnippet: hit.snippet,
        memoPreview: hit.preview || '',
        memoTags: hit.tags || [],
    };
}

/** `2026-10-13` against today `2026-10-13` -> "today"; else "Oct 15". */
export function taskDayLabel(dueDate, todayKey, tomorrowKey) {
    if (dueDate === todayKey) return 'today';
    if (dueDate === tomorrowKey) return 'tomorrow';
    const [, m, d] = dueDate.split('-').map(Number);
    const label = `${MONTH_ABBR[m - 1]} ${d}`;
    return dueDate < todayKey ? `${label}, late` : label;
}

export function taskResult(hit, todayKey, tomorrowKey) {
    const day = taskDayLabel(hit.due_date, todayKey, tomorrowKey);
    return {
        id: `${MEMO_TASK_ID}${hit.id}`,
        kind: 'app',
        title: hit.name,
        subtitle: `Task  ·  ${day}  ·  Ctrl+D done`,
        path: hit.name,
        score: hit.score,
        iconSvg: listChecks,
        memoDay: day,
    };
}

// A snippet from `s"`. Enter pastes it into the app underneath; the row says
// what it would paste, and its keyword when that is not just its name.
export function snippetResult(hit) {
    const keyword = hit.keyword && hit.keyword !== hit.name ? `${hit.keyword}  ·  ` : '';
    return {
        id: `${SNIPPET_ID}${hit.id}`,
        kind: 'app',
        title: hit.name,
        subtitle: `${keyword}${hit.preview}`,
        // Ctrl+C copies the expanded text, not this; the path only keys the preview.
        path: hit.id,
        score: hit.score,
        iconSvg: fileText,
        snippetKeyword: hit.keyword || '',
    };
}

// A window from `w"`: its title, and the app it belongs to. `id` is the backend's
// `hwnd:<handle>`; the app's exe gives the row its icon.
export function windowResult(w, index = 0, total = 1) {
    const subtitle = [w.app, w.minimized ? 'minimized' : ''].filter(Boolean).join('  ·  ');
    return {
        id: `${WINDOW_ID}${w.id}`,
        kind: 'app',
        title: w.title,
        subtitle: subtitle || 'Window',
        path: w.exe_path || '',
        // Front to back is the order the backend sent them in.
        score: total - index,
        windowApp: w.app || '',
        windowMinimized: !!w.minimized,
    };
}

function windowFromResultId(resultId) {
    return resultId?.startsWith(WINDOW_ID) ? resultId.slice(WINDOW_ID.length) : null;
}

// What `s"` shows when the file lists nothing but has something to say: one row
// per warning, which Enter repeats as a banner (the `quick:none` rows).
export function snippetsProblemRows(warnings) {
    return warnings.map((message) => ({
        id: quickResultId('none', message),
        kind: 'app',
        title: 'snippets.toml has a problem',
        subtitle: message,
        path: '',
        score: 0,
        iconSvg: alertCircle,
    }));
}

function snippetFromResultId(resultId) {
    return resultId?.startsWith(SNIPPET_ID) ? resultId.slice(SNIPPET_ID.length) : null;
}

// Rows the engine found stay in charge of the top: a note sits below the best
// few local matches, so typing an app's name still launches that app on Enter.
export const MEMO_ROWS_AFTER = 3;

export function placeMemoRows(memo, ranked) {
    if (memo.length === 0) return ranked;
    const at = Math.min(MEMO_ROWS_AFTER, ranked.length);
    return [...ranked.slice(0, at), ...memo, ...ranked.slice(at)];
}

function memoFromResultId(resultId) {
    if (resultId?.startsWith(MEMO_NOTE_ID)) {
        return { target: 'note', id: resultId.slice(MEMO_NOTE_ID.length) };
    }
    if (resultId?.startsWith(MEMO_TASK_ID)) {
        return { target: 'task', id: resultId.slice(MEMO_TASK_ID.length) };
    }
    return null;
}

export function calcRawFromResultId(resultId) {
    return resultId?.startsWith(CALC_ID) ? resultId.slice(CALC_ID.length) : null;
}

// Classifies a result id into its synthetic-row kind, or null for a real
// candidate. The id prefixes are disjoint, so at most one arm can match.
export function classifyResultId(resultId) {
    const prefix = prefixFromResultId(resultId);
    if (prefix != null) return { kind: 'prefixSuggestion', prefix };

    const commandId = commandIdFromResultId(resultId);
    if (commandId != null) return { kind: 'commandSuggestion', commandId };

    const raw = calcRawFromResultId(resultId);
    if (raw != null) return { kind: 'calc', raw };

    const suggestion = webSuggestionFromResultId(resultId);
    if (suggestion != null) return { kind: 'webSuggestion', text: suggestion };

    const url = webUrlFromResultId(resultId);
    if (url != null) return { kind: 'webUrl', url };

    const quick = quickFromResultId(resultId);
    if (quick) return { kind: 'quick', ...quick };

    const memo = memoFromResultId(resultId);
    if (memo) return { kind: 'memo', ...memo };

    const snippet = snippetFromResultId(resultId);
    if (snippet != null) return { kind: 'snippet', id: snippet };

    const win = windowFromResultId(resultId);
    if (win != null) return { kind: 'window', id: win };

    return null;
}

// True for the synthetic kind:'app' rows (prefix/command hints, Google
// suggestions, URL rows), so callers can tell them from real launcher apps.
export function isSyntheticResultId(resultId) {
    return classifyResultId(resultId) != null;
}
