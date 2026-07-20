# Shared UI components

## `src/components/panel/RecordItemContent.tsx`

Reusable record-list row content. It renders a type marker, title, timestamp, task status, attachment count, and destructive action. The parent owns selection and drag behavior.

```tsx
export function RecordItemContent({ record, onDelete }: RecordItemContentProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
          <span className="truncate text-sm font-medium text-text">{contentPreview(record)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text0">
          <span>{meta.label}</span><span className="text-text-muted">·</span>
          <span>{formatDate(record.created_at)}</span>
        </div>
      </div>
      <button className="shrink-0 rounded-lg p-1 text-text-muted opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100">…</button>
    </div>
  );
}
```

## `src/components/panel/MarkdownEditor.tsx`

BlockNote-backed WYSIWYG markdown editor. It is controlled through an initial markdown value and debounced `onChange`, supports clipboard and OS-drop images, and follows the app's `data-mode` color scheme.

```tsx
export function MarkdownEditor({ markdown, onChange, onSave, className }: MarkdownEditorProps) {
  const editor = useCreateBlockNote({ uploadFile: async (file) => onAddImageFileRef.current?.(file) ?? "" });
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="bn-wrapper min-h-0 flex-1 overflow-y-auto" data-color-scheme={colorScheme}>
        <BlockNoteView editor={editor} editable onChange={handleBlocksChange} theme={colorScheme} />
      </div>
    </div>
  );
}
```

## `src/components/panel/RecordList.tsx`

Middle-column list with loading/empty states and optional sortable rows.

```tsx
return (
  <div className="flex h-full flex-col overflow-hidden">
    <div className="shrink-0 border-b border-border px-4 py-3">…</div>
    <div className="flex-1 overflow-y-auto overscroll-contain">…</div>
  </div>
);
```
