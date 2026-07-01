import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { triggerAiAnalysis } from "../../lib/tauri";
import { useRecordsStore } from "../../store/records";
import type {
  AttachmentItem,
  RecordWithRelations,
  TaskStatus,
  UpdateRecordRequest,
} from "../../types";

interface RecordDetailProps {
  record: RecordWithRelations | null;
  loading: boolean;
  onUpdate: (id: string, update: UpdateRecordRequest) => Promise<void>;
  onConvertToTask: (recordId: string) => Promise<void>;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus, recordId: string) => Promise<void>;
  onDelete: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  note: "笔记",
  task: "待办",
  experience: "经验",
  issue: "问题",
  "file-note": "文件",
};

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  archived: "已归档",
};

const SOURCE_LABELS: Record<string, string> = {
  "quick-text": "文字速记",
  "built-in-screenshot": "截图收录",
  "drag-drop": "拖拽导入",
  "clipboard-paste": "剪贴板粘贴",
  "file-picker": "文件选择",
};

const TASK_STATUS_OPTIONS: { label: string; value: TaskStatus; activeClasses: string; dot: string }[] = [
  { label: "待办", value: "todo", activeClasses: "bg-primary/20 text-primary ring-1 ring-primary/30", dot: "bg-primary" },
  { label: "进行中", value: "doing", activeClasses: "bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/30", dot: "bg-sky-400" },
  { label: "已完成", value: "done", activeClasses: "bg-secondary/20 text-secondary ring-1 ring-secondary/30", dot: "bg-secondary" },
  { label: "已取消", value: "cancelled", activeClasses: "bg-text-muted/20 text-text-muted ring-1 ring-text-muted/20", dot: "bg-text-muted" },
];

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function InlineImage({
  attachment,
  onClick,
}: {
  attachment: AttachmentItem;
  onClick: (src: string) => void;
}) {
  const src = convertFileSrc(attachment.local_path);
  return (
    <img
      src={src}
      alt="attachment"
      className="max-h-96 w-full rounded-xl border border-border object-contain
        cursor-pointer transition hover:brightness-110"
      onClick={() => onClick(src)}
    />
  );
}

// ── Markdown helpers ────────────────────────────────────────────────

interface TocEntry {
  level: number;
  text: string;
  /** ordinal position among h1–h3 headings in document order */
  index: number;
}

/** Extract h1–h3 headings from raw markdown into a TOC (index-based). */
function extractToc(md: string): TocEntry[] {
  const toc: TocEntry[] = [];
  if (!md) return toc;
  let index = 0;
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].replace(/[*_`~]/g, "").trim();
    if (!text) continue;
    toc.push({ level, text, index });
    index += 1;
  }
  return toc;
}

// ── Component ───────────────────────────────────────────────────────

export function RecordDetail({
  record,
  loading,
  onUpdate,
  onConvertToTask,
  onUpdateTaskStatus,
  onDelete,
}: RecordDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [converting, setConverting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  //全屏预览窗口
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const { selectRecord } = useRecordsStore();

  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  // Points at whichever markdown container is currently rendered (view body or
  // edit preview). Used by the TOC to locate heading elements for scroll jumps.
  const markdownContainerRef = useRef<HTMLDivElement>(null);

  const scrollToHeading = useCallback((index: number) => {
    const container = markdownContainerRef.current;
    if (!container) return;
    const headings = container.querySelectorAll("h1, h2, h3");
    const target = headings[index];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const mdComponents = useMemo(
    () => ({
      h1: ({ children }: { children?: ReactNode }) => (
        <h1 className="text-xl font-semibold mt-6 mb-3 text-text scroll-mt-4">
          {children}
        </h1>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h2 className="text-lg font-semibold mt-5 mb-2 text-text scroll-mt-4">
          {children}
        </h2>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h3 className="text-base font-semibold mt-4 mb-2 text-text scroll-mt-4">
          {children}
        </h3>
      ),
      p: ({ children }: { children?: ReactNode }) => (
        <p className="text-sm leading-6 text-text my-2">{children}</p>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul className="list-disc pl-5 space-y-1 text-sm text-text my-2">{children}</ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol className="list-decimal pl-5 space-y-1 text-sm text-text my-2">{children}</ol>
      ),
      li: ({ children }: { children?: ReactNode }) => (
        <li className="text-sm leading-6 text-text">{children}</li>
      ),
      a: ({ children, href }: { children?: ReactNode; href?: string }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-secondary hover:text-secondary underline underline-offset-2"
        >
          {children}
        </a>
      ),
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote className="border-l-2 border-secondary/30 bg-white/[2%] pl-4 py-2 my-3 text-text-muted italic text-sm">
          {children}
        </blockquote>
      ),
      code: ({
        className,
        children,
      }: {
        className?: string;
        children?: ReactNode;
      }) => {
        const isBlock = /language-/.test(className ?? "");
        if (isBlock) {
          return <code className={className}>{children}</code>;
        }
        return (
          <code className="rounded bg-surface-2/80 px-1.5 py-0.5 text-[0.85em] text-secondary">
            {children}
          </code>
        );
      },
      pre: ({ children }: { children?: ReactNode }) => (
        <pre className="rounded-xl border border-border bg-surface/80 px-4 py-3 overflow-x-auto text-[13px] my-3">
          {children}
        </pre>
      ),
      table: ({ children }: { children?: ReactNode }) => (
        <div className="overflow-x-auto my-3">
          <table className="w-full border-collapse text-[13px]">{children}</table>
        </div>
      ),
      th: ({ children }: { children?: ReactNode }) => (
        <th className="border border-border px-3 py-1.5 text-left text-text bg-white/5">
          {children}
        </th>
      ),
      td: ({ children }: { children?: ReactNode }) => (
        <td className="border border-border px-3 py-1.5 text-text-muted">{children}</td>
      ),
      hr: () => <hr className="border-border my-6" />,
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <img
          src={src}
          alt={alt}
          className="max-h-96 w-full rounded-xl border border-border object-contain my-3"
        />
      ),
    }),
    [],
  );

  // TOC source — draft while editing, final content while viewing
  const tocSource = editingContent ? contentDraft : (record?.content ?? "");
  const toc = useMemo(() => extractToc(tocSource), [tocSource]);

  // Reset editing state when record changes
  useEffect(() => {
    setEditingTitle(false);
    setEditingContent(false);
  }, [record?.id]);

  // Focus when entering edit mode
  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingContent && contentRef.current) {
      contentRef.current.focus();
      contentRef.current.select();
    }
  }, [editingContent]);

  const startEditTitle = useCallback(() => {
    if (!record?.title) {
      setTitleDraft("");
    } else {
      setTitleDraft(record.title);
    }
    setEditingTitle(true);
  }, [record]);

  const startEditContent = useCallback(() => {
    if (!record?.content) {
      setContentDraft("");
    } else {
      setContentDraft(record.content);
    }
    setEditingContent(true);
  }, [record]);

  const saveTitle = useCallback(async () => {
    if (!record) return;
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed === (record.title ?? "")) return;
    await onUpdate(record.id, { title: trimmed.length > 0 ? trimmed : null });
  }, [record, titleDraft, onUpdate]);

  const saveContent = useCallback(async () => {
    if (!record) return;
    setEditingContent(false);
    const trimmed = contentDraft.trim();
    if (trimmed === (record.content ?? "")) return;
    await onUpdate(record.id, {
      content: trimmed.length > 0 ? trimmed : null,
    });
  }, [record, contentDraft, onUpdate]);

  const cancelEditContent = useCallback(() => {
    setEditingContent(false);
  }, []);

  const handleConvertToTask = useCallback(async () => {
    if (!record || converting) return;
    setConverting(true);
    try {
      await onConvertToTask(record.id);
    } finally {
      setConverting(false);
    }
  }, [record, converting, onConvertToTask]);

  const handleUpdateStatus = useCallback(
    async (status: TaskStatus) => {
      if (!record?.task || updatingStatus) return;
      if (record.task.task_status === status) return; // No-op if same status
      setUpdatingStatus(true);
      try {
        await onUpdateTaskStatus(record.task.id, status, record.id);
      } finally {
        setUpdatingStatus(false);
      }
    },
    [record, updatingStatus, onUpdateTaskStatus],
  );

  const handleTriggerAi = useCallback(async () => {
    if (!record || aiAnalyzing) return;
    setAiAnalyzing(true);
    setAiError(null);
    try {
      await triggerAiAnalysis(record.id, "manual");
      // Re-fetch detail to get fresh ai_results
      await selectRecord(record.id);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiAnalyzing(false);
    }
  }, [record, aiAnalyzing, selectRecord]);

  // Empty state
  if (!record) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2/50">
            <svg className="h-6 w-6 text-text0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="mt-4 text-sm text-text0">选择一条记录查看详情</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-secondary/30 border-t-secondary" />
      </div>
    );
  }

  const hasTask = !!record.task;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
            详情
          </span>
          <span className="text-text-muted">·</span>
          <span className="text-[10px] text-text0">
            {formatDateTime(record.created_at)}
          </span>
        </div>
      </div>

      {/* Body + TOC rail */}
      <div className="flex min-h-0 flex-1">
        {editingContent ? (
          /* ── Focus edit view: split editor + live preview ── */
          <div className="flex min-w-0 flex-1">
            <textarea
              ref={contentRef}
              value={contentDraft}
              onChange={(e) => setContentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEditContent();
                }
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void saveContent();
                }
              }}
              placeholder="使用 Markdown 编写…  Ctrl+Enter 保存 / Esc 取消"
              className="flex-1 resize-none border-r border-border bg-surface/60
                px-5 py-4 text-sm leading-6 text-text outline-none
                font-mono placeholder:text-text-muted"
            />
            <div className="flex-1 overflow-y-auto overscroll-contain p-5">
              {contentDraft.trim() ? (
                <div className="markdown-body" ref={markdownContainerRef}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {contentDraft}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm italic text-text0">实时预览…</p>
              )}
            </div>
          </div>
        ) : (
          /* ── View mode: scrollable body ── */
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="space-y-5 p-5">
              {/* Title */}
              <section>
                {editingTitle ? (
                  <input
                    ref={titleRef}
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => void saveTitle()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveTitle();
                      }
                      if (e.key === "Escape") {
                        setEditingTitle(false);
                      }
                    }}
                    placeholder="添加标题…"
                    className="w-full rounded-xl border border-border bg-surface/80 px-3 py-2
                      text-base font-medium text-text outline-none transition
                      focus:border-secondary/40 focus:ring-2 focus:ring-secondary/20"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={startEditTitle}
                    className="group w-full text-left"
                  >
                    <h2 className="text-lg font-medium leading-7 text-text transition group-hover:text-secondary">
                      {record.title || (
                        <span className="italic text-text0">无标题</span>
                      )}
                    </h2>
                    <span className="mt-0.5 block text-[10px] text-text-muted opacity-0 transition group-hover:opacity-100">
                      点击编辑
                    </span>
                  </button>
                )}
              </section>

              {/* Meta badges */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-text">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    record.type === "note" ? "bg-text-muted"
                    : record.type === "task" ? "bg-secondary"
                    : record.type === "experience" ? "bg-primary"
                    : record.type === "issue" ? "bg-danger"
                    : "bg-sky-400"
                  }`} />
                  {TYPE_LABELS[record.type] ?? record.type}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-text">
                  {STATUS_LABELS[record.status] ?? record.status}
                </span>
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-text-muted">
                  {SOURCE_LABELS[record.source] ?? record.source}
                </span>
              </div>

              {/* Content */}
              <section>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                  内容
                </p>
                {record.content ? (
                  <div
                    onClick={startEditContent}
                    className="group cursor-pointer"
                  >
                    <div className="markdown-body transition group-hover:text-text" ref={markdownContainerRef}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {record.content}
                      </ReactMarkdown>
                    </div>
                    <span className="mt-1 block text-[10px] text-text-muted opacity-0 transition group-hover:opacity-100">
                      点击编辑
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startEditContent}
                    className="group w-full text-left"
                  >
                    <p className="text-sm italic leading-6 text-text0">
                      无内容
                    </p>
                    <span className="mt-0.5 block text-[10px] text-text-muted opacity-0 transition group-hover:opacity-100">
                      点击编辑
                    </span>
                  </button>
                )}
              </section>

              {/* ── Task section ── */}
              {hasTask && record.task && (
                <section>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                    待办信息
                  </p>
                  <div className="rounded-2xl border border-secondary/15 bg-secondary/5 p-4">
                    {/* Interactive status update buttons */}
                    <div className="mb-3">
                      <p className="mb-2 text-[10px] font-medium text-text-muted">
                        更新状态
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {TASK_STATUS_OPTIONS.map((opt) => {
                          const isActive = record.task!.task_status === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => void handleUpdateStatus(opt.value)}
                              disabled={updatingStatus || isActive}
                              className={`
                                inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
                                text-xs font-medium transition-all duration-150
                                ${
                                  isActive
                                    ? opt.activeClasses
                                    : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text"
                                }
                                disabled:opacity-60 disabled:cursor-not-allowed
                              `}
                            >
                              {!isActive && (
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${opt.dot} opacity-40`} />
                              )}
                              {isActive && (
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                              )}
                              {opt.label}
                              {updatingStatus && isActive && (
                                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Task metadata */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-secondary/10 pt-3">
                      <span className="text-[11px] text-text-muted">
                        优先级：
                        {record.task.priority === "high"
                          ? "高"
                          : record.task.priority === "low"
                            ? "低"
                            : "中"}
                      </span>
                      {record.task.due_at && (
                        <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] text-danger">
                          截止：{formatDateTime(record.task.due_at)}
                        </span>
                      )}
                      {record.task.completed_at && (
                        <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-[10px] text-secondary">
                          完成于 {formatDateTime(record.task.completed_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* 图片嵌入内容 */}
              {record.attachments
                .filter((a) => a.file_type === "image" || a.file_type === "screenshot")
                .length > 0 && (
                  <section>
                    <div className="space-y-3">
                      {record.attachments
                        .filter((a) => a.file_type === "image" || a.file_type === "screenshot")
                        .map((att) => (
                          <InlineImage
                            key={att.id}
                            attachment={att}
                            onClick={(src) => setPreviewSrc(src)}
                          />
                        ))}
                    </div>
                  </section>
              )}

              {/* 非图片附件 */}
              {record.attachments
                .filter((a) => a.file_type !== "image" && a.file_type !== "screenshot")
                .length > 0 && (
                  <section>
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                      附件
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {record.attachments
                        .filter((a) => a.file_type !== "image" && a.file_type !== "screenshot")
                        .map((att) => (
                          <span
                            key={att.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-surface/50 px-2.5 py-1 text-[11px] text-text-muted"
                          >
                            <svg className="h-3 w-3 text-text0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            {att.local_path.split(/[\\/]/).pop()}
                          </span>
                        ))}
                    </div>
                  </section>
              )}

              {/* AI Results */}
              {record.ai_results && record.ai_results.length > 0 && (
                <section>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                    AI 分析
                  </p>
                  <div className="space-y-3">
                    {record.ai_results.map((ai) => (
                      <div
                        key={ai.id}
                        className="overflow-hidden rounded-xl border border-violet-400/12 bg-violet-400/[3%]"
                      >
                        {/* Summary */}
                        {ai.summary && (
                          <div className="px-4 py-3">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-400/10">
                                <svg className="h-3 w-3 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                                </svg>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-violet-300 mb-1">
                                  智能摘要
                                </p>
                                <p className="text-xs leading-6 text-text">
                                  {ai.summary}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Suggested tasks */}
                        {ai.suggested_tasks && (
                          <div className="border-t border-violet-400/8 px-4 py-3">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10">
                                <svg className="h-3 w-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-primary mb-1">
                                  建议待办
                                </p>
                                <ul className="space-y-1">
                                  {ai.suggested_tasks.split("\n").filter(Boolean).map((task, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs leading-5 text-text-muted">
                                      <span className="mt-[5px] inline-block h-1 w-1 shrink-0 rounded-full bg-primary/40" />
                                      {task}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Tags */}
                        {ai.tags && (
                          <div className="border-t border-violet-400/8 px-4 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <svg className="h-3 w-3 text-violet-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                              </svg>
                              {ai.tags.split(",").map((tag, i) => (
                                <span
                                  key={i}
                                  className="rounded-full bg-violet-400/8 px-2 py-0.5 text-[10px] text-violet-300/80"
                                >
                                  {tag.trim()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Model & trigger meta */}
                        <div className="border-t border-violet-400/8 px-4 py-2">
                          <div className="flex items-center gap-3 text-[10px] text-text0">
                            {ai.model_name && (
                              <span>{ai.model_name}</span>
                            )}
                            <span className="text-text-muted">·</span>
                            <span>
                              {ai.trigger_mode === "auto"
                                ? "自动分析"
                                : ai.trigger_mode === "smart"
                                  ? "智能分析"
                                  : "手动分析"}
                            </span>
                            <span className="text-text-muted">·</span>
                            <span>
                              {(() => {
                                try {
                                  return new Date(ai.created_at).toLocaleString("zh-CN", {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  });
                                } catch {
                                  return ai.created_at;
                                }
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {/* AI Error */}
              {aiError && (
                <section>
                  <div className="flex items-start gap-2.5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    <div>
                      <p className="text-xs font-medium text-danger mb-0.5">
                        AI 分析失败
                      </p>
                      <p className="text-[11px] leading-5 text-danger/70">
                        {aiError}
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {/* ── TOC right rail ── */}
        {toc.length > 0 && (
          <aside className="w-[180px] shrink-0 overflow-y-auto border-l border-border bg-bg/30 px-3 py-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
              目录
            </p>
            <nav className="space-y-0.5">
              {toc.map((entry, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => scrollToHeading(entry.index)}
                  title={entry.text}
                  style={{ paddingLeft: `${(entry.level - 1) * 12 + 4}px` }}
                  className="block w-full truncate text-left text-[11px] leading-5 text-text-muted transition hover:text-secondary"
                >
                  {entry.text}
                </button>
              ))}
            </nav>
          </aside>
        )}
      </div>

      {/* Action bar */}
      {editingContent ? (
        <div className="shrink-0 border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveContent()}
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 px-4 py-1.5
                text-xs font-medium text-secondary transition hover:bg-secondary/25"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              保存
            </button>
            <button
              type="button"
              onClick={cancelEditContent}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5
                text-xs font-medium text-text-muted transition hover:bg-white/5 hover:text-text"
            >
              取消
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-text-muted">
              Ctrl+Enter 保存 · Esc 取消
            </span>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            {!hasTask && (
              <button
                type="button"
                onClick={() => void handleConvertToTask()}
                disabled={converting}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary/10 px-3.5 py-1.5
                  text-xs font-medium text-secondary transition hover:bg-secondary/20
                  disabled:opacity-50"
              >
                {converting ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-secondary/30 border-t-secondary" />
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                )}
                转为待办
              </button>
            )}

            {/* AI analysis trigger */}
            <button
              type="button"
              onClick={() => void handleTriggerAi()}
              disabled={aiAnalyzing}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5
                text-xs font-medium text-violet-300 transition
                hover:bg-violet-400/15 disabled:opacity-50"
            >
              {aiAnalyzing ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-violet-400/30 border-t-violet-400" />
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              )}
              {aiAnalyzing ? "分析中…" : "AI 分析"}
            </button>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => onDelete(record.id)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5
                text-xs text-text0 transition hover:bg-danger/10 hover:text-danger"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              删除
            </button>
          </div>
        </div>
      )}

      {/* 全屏图片预览 */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            onClick={() => setPreviewSrc(null)}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={previewSrc}
            alt="preview"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}