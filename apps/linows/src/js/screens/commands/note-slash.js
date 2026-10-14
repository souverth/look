// The "/" block menu of /note: what it offers, in which groups, and which of it
// a typed word keeps. Data and rules only; note.js draws it and applies a pick.
//
// `text` is inserted in place of the typed "/word"; `|` marks where the caret
// lands. `hint` is the markup the item types, shown on the right of its row.
// `tone` gives an alert its colour. An item with an `action` does something instead
// of inserting text (opens the Go to list, or the template list); `firstLineOnly`
// keeps it out of the menu everywhere but the first line of the note.

import {
    code,
    type,
    minus,
    listBullets,
    listOrdered,
    listChecks,
    quote,
    calendar,
    alertCircle,
    messageWarning,
    info,
    lightbulb,
    triangleAlert,
    search,
    fileText,
} from '../../icons.js';
import { todayIso } from './note-format.js';

export const GROUPS = [
    { id: 'basic', label: 'Basic Formatting' },
    { id: 'alerts', label: 'GitHub Alerts' },
];

const heading = (n) => ({
    key: `h${n}`,
    aliases: ['heading', 'title'],
    group: 'basic',
    label: `Heading ${n}`,
    hint: '#'.repeat(n),
    icon: type,
    text: `${'#'.repeat(n)} |`,
});

const alert = (kind, icon) => ({
    key: kind.toLowerCase(),
    aliases: ['alert', 'callout'],
    group: 'alerts',
    label: `${kind[0]}${kind.slice(1).toLowerCase()} Alert`,
    hint: `> [!${kind}]`,
    icon,
    tone: kind.toLowerCase(),
    text: `> [!${kind}]\n> |`,
});

export const SNIPPETS = [
    {
        key: 'code',
        aliases: ['codeblock', 'fence', 'snippet'],
        group: 'basic',
        label: 'Codeblock',
        hint: '```',
        icon: code,
        text: '```\n|\n```',
    },
    heading(1),
    heading(2),
    heading(3),
    heading(4),
    {
        key: 'divider',
        aliases: ['hr', 'rule', 'line'],
        group: 'basic',
        label: 'Horizontal Rule',
        hint: '---',
        icon: minus,
        text: '---\n|',
    },
    {
        key: 'bullet',
        aliases: ['ul', 'list'],
        group: 'basic',
        label: 'Bullet List',
        hint: '-',
        icon: listBullets,
        text: '- |',
    },
    {
        key: 'number',
        aliases: ['ol', 'ordered', 'list'],
        group: 'basic',
        label: 'Ordered List',
        hint: '1.',
        icon: listOrdered,
        text: '1. |',
    },
    {
        key: 'todo',
        aliases: ['task', 'checkbox', 'list'],
        group: 'basic',
        label: 'Task List',
        hint: '[ ]',
        icon: listChecks,
        text: '- [ ] |',
    },
    { key: 'quote', group: 'basic', label: 'Quote', hint: '>', icon: quote, text: '> |' },
    {
        key: 'date',
        aliases: ['today'],
        group: 'basic',
        label: "Today's Date",
        hint: '',
        icon: calendar,
        text: () => `${todayIso()} |`,
    },
    {
        key: 'template',
        aliases: ['templates', 'tpl'],
        group: 'basic',
        label: 'Template',
        hint: '',
        icon: fileText,
        action: 'template',
        firstLineOnly: true,
    },
    {
        key: 'keys',
        aliases: ['shortcuts', 'help', 'keyboard'],
        group: 'basic',
        label: 'Keyboard shortcuts',
        hint: 'F1',
        icon: info,
        action: 'keys',
    },
    {
        key: 'goto',
        aliases: ['jump', 'outline', 'line', 'section'],
        group: 'basic',
        label: 'Go to…',
        hint: 'Ctrl+G',
        icon: search,
        action: 'goto',
    },
    alert('CAUTION', alertCircle),
    alert('IMPORTANT', messageWarning),
    alert('NOTE', info),
    alert('TIP', lightbulb),
    alert('WARNING', triangleAlert),
];

/** What a typed `/word` keeps: a key or alias that starts with it, or a label holding it. */
export function filter(query) {
    const q = String(query).trim().toLowerCase();
    if (!q) return SNIPPETS;
    return SNIPPETS.filter(
        (s) =>
            s.key.startsWith(q) ||
            (s.aliases || []).some((a) => a.startsWith(q)) ||
            s.label.toLowerCase().includes(q),
    );
}

/**
 * `items` ordered the way the menu shows them (group by group), and the rows to
 * draw: a header before each group that has an item, then the items, each
 * carrying its position in the ordered list, which is what Up/Down walk.
 */
export function arrange(items) {
    const ordered = [];
    const rows = [];
    for (const group of GROUPS) {
        const inGroup = items.filter((s) => s.group === group.id);
        if (!inGroup.length) continue;
        rows.push({ type: 'group', label: group.label });
        for (const item of inGroup) {
            rows.push({ type: 'item', item, index: ordered.length });
            ordered.push(item);
        }
    }
    return { ordered, rows };
}
