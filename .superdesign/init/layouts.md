# Layouts

## `src/components/panel/MainPanel.tsx`

The desktop shell is a resizable three-column layout: navigation, record list/settings, and main detail. It uses two `col-resize-handle` separators; the right column fills remaining width.

```tsx
return (
  <div className="flex h-screen overflow-hidden bg-bg text-text">
    <aside className="shrink-0 border-r border-border bg-bg/50" style={{ width: widths.nav }}><Navigation … /></aside>
    <div className="col-resize-handle shrink-0" onPointerDown={startResize("nav")} />
    <section className="flex shrink-0 flex-col border-r border-border bg-bg/30" style={{ width: widths.list }}>
      <RecordList … />
    </section>
    <div className="col-resize-handle shrink-0" onPointerDown={startResize("list")} />
    <section className="flex min-w-0 flex-1 flex-col bg-bg/20"><RecordDetail … /></section>
  </div>
);
```

## `src/components/panel/Navigation.tsx`

Persistent left sidebar with filter/search controls, tag filters, navigation mode controls, and settings/memory actions. It uses `nav` semantics, compact uppercase section labels, rounded filter chips, and a bottom action row.

## `src/components/panel/RecordDetail.tsx`

Main reading and editing surface. Header contains record actions; body switches between WYSIWYG BlockNote and Markdown-source split preview while editing. A right TOC rail is conditionally visible for headings. Its action bar currently sits below the content and houses save/cancel plus editor-mode controls.
