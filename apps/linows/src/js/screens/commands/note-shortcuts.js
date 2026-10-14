// Every key the /note editor answers to, by group, for the shortcut list (the Keys
// button, F1, or `/keys`). One place for the list; a test checks that no entry is listed
// twice and that the keys the editor is known to answer to are all in it.
//
// A chord is `Ctrl+Shift+K` (modifiers in the order Ctrl, Alt, Shift, then the key),
// several for one action separated by ` / `.

export const SHORTCUTS = [
    {
        group: 'Format',
        items: [
            ['Ctrl+B', 'Bold'],
            ['Ctrl+I', 'Italic'],
            ['Ctrl+U', 'Underline'],
            ['Ctrl+Shift+X', 'Strikethrough'],
            ['Ctrl+Shift+M', 'Highlight'],
            ['Ctrl+`', 'Inline code'],
            ['Ctrl+K', 'Link (the selection becomes its text)'],
            ['Select text', 'A toolbar appears over it with these and more'],
        ],
    },
    {
        group: 'Blocks',
        items: [
            ['Ctrl+Shift+1 to 6', 'Heading 1 to 6 (again to remove)'],
            ['Ctrl+Shift+7', 'Numbered list'],
            ['Ctrl+Shift+8', 'Bullet list'],
            ['Ctrl+Shift+9', 'Task list'],
            ['Ctrl+Shift+.', 'Quote'],
            ['Ctrl+Shift+B', 'Code block'],
            ['/', 'Block menu: headings, lists, alerts, date, Template (first line), Go to, shortcuts'],
        ],
    },
    {
        group: 'Lists and levels',
        items: [
            ['Enter', 'On an item: the next item (bullet, number or task)'],
            ['Enter', 'On an empty item: ends the list'],
            ['Tab / Ctrl+]', 'Item or heading one level in (numbers start again at 1)'],
            ['Shift+Tab / Ctrl+[', 'One level out; an empty item at the margin loses its marker'],
        ],
    },
    {
        group: 'Lines',
        items: [
            ['Alt+Up / Alt+Down', 'Move the line (or the selected lines) up / down'],
            ['Alt+Enter', 'Copy the line below'],
            ['Shift+Alt+Up / Shift+Alt+Down', 'Copy the line up / down'],
            ['Ctrl+Shift+K', 'Delete the line'],
            ['Ctrl+Enter', 'New line below'],
            ['Ctrl+Shift+Enter', 'New line above'],
            ['Ctrl+J', 'Join with the next line (or join the selected lines)'],
            ['Ctrl+L', 'Select the line'],
        ],
    },
    {
        group: 'Comments',
        items: [
            ['Ctrl+/', 'Comment each selected line with <!-- --> (again to remove)'],
            ['Alt+Shift+A', 'Comment the selected lines as one block over several lines (again to remove)'],
        ],
    },
    {
        group: 'Tables',
        items: [
            ['Enter', 'At the end of a row: tidy the table, new row (typed `|a|b|` becomes a table)'],
            ['Enter', 'On an empty row: leave the table'],
            ['Tab / Shift+Tab', 'Next / previous cell (a new row after the last)'],
            ['Alt+Left / Alt+Right', 'Cell to the left / right'],
            ['Alt+Up / Alt+Down', 'Row above / below (in a table)'],
        ],
    },
    {
        group: 'Go to and fold',
        items: [
            ['Ctrl+G / Ctrl+Shift+O', 'Go to a line, or a heading, task, code block, table, image, link, tag...'],
            ['h2, task, code, img...', 'In the Go to box: only that kind (a word after it narrows)'],
            ['Ctrl+Shift+[', 'Fold the section the caret is in'],
            ['Ctrl+Shift+]', 'Open it'],
            ['Alt+Shift+[', 'Fold everything'],
            ['Alt+Shift+]', 'Open everything'],
            ['Click an arrow', 'Fold or open that section (Alt+click: every one of its kind)'],
        ],
    },
    {
        group: 'Code blocks',
        items: [
            ['( [ { \' " `', 'Typed, it adds its closing mark; typing the closer steps over it'],
            ['( [ { \' " ` on a selection', 'Wraps the selection'],
            ['Enter between { }', 'Opens an indented block between them'],
            ['Enter', 'Keeps the indent (one deeper after { ( [ or a : in Python)'],
            ['Backspace between a pair', 'Takes both marks away'],
            ['>', 'Closes an HTML / JSX tag you have just opened'],
        ],
    },
    {
        group: 'Complete',
        items: [
            ['<', 'HTML tags'],
            [':', 'Emoji by name (:smile:), or type the closing colon'],
            ['```', 'The language of a code block, and words inside one'],
            ['Up / Down', 'Move in the list'],
            ['Enter / Tab', 'Take the choice'],
            ['Esc', 'Close the list'],
        ],
    },
    {
        group: 'Edit',
        items: [
            ['Ctrl+Z / Ctrl+Y', 'Undo / redo (folding starts the undo history again)'],
            ['Ctrl+A', 'Select all'],
            ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'],
            ['Ctrl+Backspace / Ctrl+Delete', 'Delete the word before / after'],
            ['Ctrl+Home / Ctrl+End', 'Start / end of the note'],
        ],
    },
    {
        group: 'Pictures',
        items: [
            ['Ctrl+V', 'Paste a copied picture or a screenshot'],
            ['Drag a file in', 'Add the picture where you drop it'],
            ['Drag its corner', 'Resize it (in Preview)'],
            ['Double-click it', 'Back to its own size'],
        ],
    },
    {
        group: 'Note',
        items: [
            ['Ctrl+S', 'Save now (it saves by itself too)'],
            ['Ctrl+E', 'Preview (again to write)'],
            ['Ctrl+\\', 'Split view'],
            ['Ctrl+N', 'New note'],
            ['F1', 'This list'],
            ['Esc', 'Back to the notes'],
            ['Enter / Tab', 'In the title: on to the tags'],
            ['Enter', 'In the tags: add the tag'],
            ['Backspace', 'In the tags, on an empty box: remove the last tag'],
            ['Up / Down', 'In the tags: the suggestions'],
            ['Click a task', 'In Preview: tick it'],
        ],
    },
    {
        group: 'Notes list',
        items: [
            ['Down', 'From the search box into the cards'],
            ['Arrows', 'Move between the cards'],
            ['Home / End', 'First / last card'],
            ['Enter / Space', 'Open the card'],
            ['Enter', 'In the search box: open the first match'],
            ['Esc', 'Clear the search, then the tag filter'],
            ['Ctrl+N', 'New note'],
        ],
    },
    {
        group: 'Templates',
        items: [
            ['/', 'On the first line, then Template: pick one to start the note from'],
            ['Up / Down', 'In the list of templates: the next one'],
            ['Ctrl+S', 'Save the template'],
            ['Esc', 'Close the templates'],
        ],
    },
    {
        group: 'Go to box',
        items: [
            ['Up / Down / Tab', 'Move in the list'],
            ['Enter', 'Jump there'],
            ['Esc', 'Close it'],
        ],
    },
];

/** Every chord in the list, one by one: `Ctrl+B`, `Alt+Up`... (` / ` splits alternatives). */
export function chordsOf(item) {
    return item[0].split(' / ');
}

/** The entries whose chord or description contains `query` (case-insensitive), group by group. */
export function filterShortcuts(query, groups = SHORTCUTS) {
    const q = String(query).trim().toLowerCase();
    if (!q) return groups;
    return groups
        .map((g) => ({
            group: g.group,
            items: g.items.filter(([keys, what]) => `${keys} ${what}`.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)),
        }))
        .filter((g) => g.items.length);
}
