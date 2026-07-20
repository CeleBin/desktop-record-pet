# Extractable components

## MainPanel

- Source: `src/components/panel/MainPanel.tsx`
- Category: layout
- Description: Resizable three-column desktop workspace.
- Extractable props: `navWidth`, `listWidth`, `contentMode`.
- Hardcoded: column separators and workspace hierarchy.

## Navigation

- Source: `src/components/panel/Navigation.tsx`
- Category: layout
- Description: Main sidebar navigation and filters.
- Extractable props: `viewMode`, `searchQuery`, `activeStatus`, `activeTagIds`, `settingsOpen`, `memoryOpen`, `chatOpen`.
- Hardcoded: filter labels, footer shortcut hint, SVG icons.

## RecordList

- Source: `src/components/panel/RecordList.tsx`
- Category: basic
- Description: Filtered notes/tasks collection with states and optional sorting.
- Extractable props: `records`, `selectedId`, `viewMode`, `loading`.
- Hardcoded: header labels, list spacing.

## RecordDetail

- Source: `src/components/panel/RecordDetail.tsx`
- Category: layout
- Description: Reading/editing surface with a conditional table-of-contents rail.
- Extractable props: `recordTitle`, `editing`, `editorMode`, `hasToc`, `hasTask`.
- Hardcoded: action labels and inline SVG icons.
