import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { createRecord, hideWindow, showMainPanel } from "../../lib/tauri";

const QUICK_INPUT_LABEL = "quick-input";
const RESET_EVENT = "quick-input:reset";

function normalizeContent(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function QuickInput() {
  const appWindow = getCurrentWebviewWindow();
  const [content, setContent] = useState("");
  const [createAsTask, setCreateAsTask] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isEmpty = useMemo(() => normalizeContent(content) === null, [content]);

  async function handleDragMouseDown(e: React.MouseEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea")) return;
    e.preventDefault();
    try {
      await appWindow.startDragging();
    } catch {
      // ignore drag errors (e.g. window already released)
    }
  }

  useEffect(() => {
    // Make the html :root background transparent so the window's
    // `transparent: true` shows the desktop in the padding area around
    // the floating card. (styles.css sets `background: var(--bg)` on :root
    // globally, which would otherwise paint an opaque box around the card.)
    document.documentElement.style.background = "transparent";

    const focus = () => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.select();
    };

    focus();

    const unlistenPromise = listen(RESET_EVENT, () => {
      setContent("");
      setCreateAsTask(false);
      setError(null);
      requestAnimationFrame(focus);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleSubmit(openMainPanelAfterSave: boolean) {
    if (submitting || isEmpty) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await createRecord({
        type: createAsTask ? "task" : "note",
        content: normalizeContent(content),
        source: "quick-text",
        createAsTask,
      });

      setContent("");
      setCreateAsTask(false);

      if (openMainPanelAfterSave) {
        await showMainPanel();
      }

      await hideWindow(QUICK_INPUT_LABEL);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function handleCancel() {
    if (submitting) {
      return;
    }

    setContent("");
    setCreateAsTask(false);
    setError(null);
    await hideWindow(QUICK_INPUT_LABEL);
  }

  return (
    <main className="h-screen bg-transparent p-3 text-text">
      <section className="flex h-full min-h-[148px] flex-col rounded-3xl bg-bg p-4 backdrop-blur-xl">
        <div
          onMouseDown={handleDragMouseDown}
          className="mb-3 flex cursor-grab items-center justify-between gap-3 select-none active:cursor-grabbing"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-secondary/80">
              Quick capture
            </p>
            <h1 className="mt-1 text-sm font-semibold text-text">
              文字速记
            </h1>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-white/5 px-3 py-1.5 text-xs text-text">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-secondary"
              checked={createAsTask}
              onChange={(event) => setCreateAsTask(event.target.checked)}
            />
            直接建待办
          </label>
        </div>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              void handleCancel();
              return;
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit(event.ctrlKey || event.metaKey);
            }
          }}
          rows={3}
          placeholder="记一句话，回车立即保存"
          className="min-h-0 flex-1 resize-none rounded-2xl border border-border bg-surface/80 px-4 py-3 text-sm leading-6 text-text outline-none transition focus:border-secondary/40 focus:ring-2 focus:ring-secondary/20"
        />

        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-text-muted">
          <div className="space-y-1">
            <p>Enter 保存</p>
            <p>Ctrl+Enter 保存并打开主面板</p>
          </div>
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="rounded-full border border-border px-3 py-1.5 text-text transition hover:border-white/20 hover:text-white"
          >
            Esc 取消
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-2xl border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}

        {submitting ? (
          <p className="mt-3 text-xs text-secondary/80">正在本地保存…</p>
        ) : null}
      </section>
    </main>
  );
}
