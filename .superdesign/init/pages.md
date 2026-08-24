# Page dependency trees

## Main workspace / `?window=main-panel`

Entry: `src/App.tsx`

Dependencies:

- `src/components/panel/MainPanel.tsx`
  - `src/components/panel/Navigation.tsx`
  - `src/components/panel/RecordList.tsx`
    - `src/components/panel/SortableRecordItem.tsx`
      - `src/components/panel/RecordItemContent.tsx`
  - `src/components/panel/RecordDetail.tsx`
    - `src/components/panel/MarkdownEditor.tsx`
    - `src/lib/useEditorPreviewResize.ts`
    - `src/lib/useEditorPreviewSyncScroll.ts`
    - `src/lib/useTocResize.ts`
    - `src/lib/markdownToc.ts`
    - `src/styles.css`
  - `src/components/settings/SettingsPanel.tsx`
  - `src/components/panel/PetChatPanel.tsx`
  - `src/components/panel/KnowledgeMemoryPanel.tsx`
  - `src/components/panel/PetLearningPanel.tsx`
  - `src/store/records.ts`
  - `src/store/tags.ts`
  - `src/store/tasks.ts`
  - `src/store/settings.ts`

## Target feature: note editing

Entry: `src/components/panel/RecordDetail.tsx`

Actual desktop render branch:

- Header: edit / convert-to-task / optional AI / delete actions
- If `editingContent && editorMode === "wysiwyg"`: `MarkdownEditor` fills the left content area.
- If `editingContent && editorMode === "source"`: textarea plus optional resizable Markdown preview.
- If not editing: reading content, metadata, tags, attachments, task/AI panels.
- If markdown headings exist: conditional resizable TOC rail at right.
- If editing: bottom action bar with Save, Cancel, WYSIWYG/Source toggle, Preview/Sync controls in source mode, and shortcut hint.
