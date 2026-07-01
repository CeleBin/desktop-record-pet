import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  createRecord,
  hideWindow,
  saveScreenshotRecord,
  showMainPanel,
} from "../../lib/tauri";

const SUPPLEMENT_BOX_LABEL = "supplement-box";

export function SupplementBox() {
  const [content, setContent] = useState("");
  const [createAsTask, setCreateAsTask] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Screenshot state received via event from the overlay
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [hasSavedScreenshot, setHasSavedScreenshot] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const normalizedContent = useMemo(() => {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [content]);

  // Listen for screenshot:captured event from the overlay
  useEffect(() => {
    const unlistenPromise = listen<{ path: string }>("screenshot:captured", (event) => {
      const path = event.payload.path;
      setScreenshotPath(path);
      setScreenshotPreviewUrl(convertFileSrc(path));
      setHasSavedScreenshot(false); // allow a fresh save for this new capture
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Focus textarea when window becomes visible
  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [screenshotPreviewUrl]);

  async function handleSubmit(openMainPanelAfterSave: boolean) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      if (screenshotPath && !hasSavedScreenshot) {
        // Save with screenshot attachment
        await saveScreenshotRecord(normalizedContent, screenshotPath, createAsTask);
        setHasSavedScreenshot(true);
      } else {
        // Plain record (no screenshot, or already saved)
        await createRecord({
          type: createAsTask ? "task" : "note",
          content: normalizedContent,
          source: "built-in-screenshot",
          createAsTask,
        });
      }

      if (openMainPanelAfterSave) {
        await showMainPanel();
      }

      setContent("");
      setCreateAsTask(false);
      setScreenshotPath(null);
      setScreenshotPreviewUrl(null);
      setHasSavedScreenshot(false);

      await hideWindow(SUPPLEMENT_BOX_LABEL);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg/85 p-4 text-text">
      <section className="flex h-full flex-col rounded-3xl border border-border bg-bg/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-sky-300/80">
              Screenshot capture
            </p>
            <h1 className="mt-1 text-lg font-semibold text-text">
              补一句说明后收录
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

        <div className="mt-4 grid flex-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
          {/* Screenshot preview */}
          <div className="flex min-h-[180px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface/70">
            {screenshotPreviewUrl ? (
              <img
                src={screenshotPreviewUrl}
                alt="screenshot preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-center text-xs text-text0">
                截图预览
                <br />
                <span className="mt-1 block text-[10px] text-text-muted">
                  (选择区域后自动显示)
                </span>
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  void hideWindow(SUPPLEMENT_BOX_LABEL);
                  return;
                }

                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSubmit(event.ctrlKey || event.metaKey);
                }
              }}
              rows={5}
              placeholder="可补一句说明，也可以直接回车保存"
              className="min-h-[180px] resize-none rounded-2xl border border-border bg-surface/80 px-4 py-3 text-sm leading-6 text-text outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/20"
            />

            <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
              <div className="space-y-1">
                <p>Enter 保存（允许空文本）</p>
                <p>Ctrl+Enter 保存并打开主面板</p>
              </div>
              <button
                type="button"
                onClick={() => void hideWindow(SUPPLEMENT_BOX_LABEL)}
                className="rounded-full border border-border px-3 py-1.5 text-text transition hover:border-white/20 hover:text-white"
              >
                Esc 取消
              </button>
            </div>

            {error ? (
              <p className="rounded-2xl border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            ) : null}

            {submitting ? (
              <p className="text-xs text-sky-300/80">正在本地保存截图记录…</p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
