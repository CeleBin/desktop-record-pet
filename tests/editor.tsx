import React from "react";
import { createRoot } from "react-dom/client";
import { MarkdownEditor } from "../src/components/panel/MarkdownEditor";
import "../src/styles.css";

const sample = '```json\n{\n  "name": "sample",\n  "description": "' + 'long value '.repeat(24) + '",\n\n  "enabled": true\n}\n```';
const state = window as any;
state.changes = [];
state.saved = null;
state.reloadEditor = (markdown = sample) => {
  state.mount = (state.mount ?? 0) + 1;
  root.render(<div style={{width: 780}}><MarkdownEditor key={state.mount}
    className="document-editor" markdown={markdown}
    onChange={(md) => state.changes.push(md)}
    onSave={(md) => { state.saved = md; }}
    onFlushReady={(flush) => { state.flushEditor = flush; }}
  /></div>);
};
const root = createRoot(document.getElementById("root")!);
state.reloadEditor();
