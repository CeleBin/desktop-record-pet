import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { listenForFileDrops } from "../../lib/dragDrop";
import { useEditorPreviewResize } from "../../lib/useEditorPreviewResize";
import { useEditorPreviewSyncScroll } from "../../lib/useEditorPreviewSyncScroll";
import { useTocResize } from "../../lib/useTocResize";
import { extractMarkdownToc } from "../../lib/markdownToc";

import { addAttachmentsToRecord, getRecordDetail, runAiTask, saveClipboardImage, setRecordTags } from "../../lib/tauri";
import { useLearningCoachStore } from "../../store/learningCoach";
import { useRecordsStore } from "../../store/records";
import { useTagsStore } from "../../store/tags";
import type {
  AiResultItem,
  LearningAnalysisResult,
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
  growthPreviewEnabled: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  note: "笔记",
  task: "待办",
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

const KNOWLEDGE_STATUS_LABELS: Record<string, string> = {
  candidate: "待确认",
  understanding: "初步理解",
  mastered: "已掌握",
  awareness: "待确认",
  rejected: "不是知识点",
};

interface EffectiveKnowledgeTopic {
  key: string;
  topicId: string | null;
  name: string;
  rawStatus: string;
  masteryLevel: string;
  summary: string;
  evidenceText: string;
  canPromote: boolean;
}

interface PersistedLearningAnalysisEntry {
  ai: AiResultItem;
  result: LearningAnalysisResult;
}

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

function normalizeTopicName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function isLearningAnalysisResult(value: unknown): value is LearningAnalysisResult {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.summary !== "string") return false;
  if (!Array.isArray(candidate.knowledge_points)) return false;
  if (!Array.isArray(candidate.questions_for_user)) return false;
  if (!Array.isArray(candidate.suggested_memory_updates)) return false;

  return candidate.knowledge_points.every((point) => {
    if (!point || typeof point !== "object") return false;
    const item = point as Record<string, unknown>;
    return (
      typeof item.name === "string"
      && typeof item.confidence === "number"
      && typeof item.example_from_note === "string"
    );
  }) && candidate.questions_for_user.every((question) => typeof question === "string")
    && candidate.suggested_memory_updates.every((update) => {
      if (!update || typeof update !== "object") return false;
      const item = update as Record<string, unknown>;
      return (
        typeof item.topic === "string"
        && typeof item.mastery_level === "string"
        && typeof item.evidence === "string"
      );
    });
}

function parseLearningAnalysisResult(raw: string | null | undefined): LearningAnalysisResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLearningAnalysisResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Custom URL transform for ReactMarkdown. Allows standard web protocols and
 * Tauri asset URLs through, converts local filesystem paths (Windows `C:\…`
 * or `C:/…`) to Tauri asset URLs via convertFileSrc, and strips everything
 * else (security: prevents javascript: URLs etc.).
 */
const markdownUrlTransform = (url: string): string => {
  if (/^(https?:|data:|blob:|asset:|mailto:|tel:)/i.test(url)) {
    return url;
  }
  if (/^[a-zA-Z]:[\\/]/.test(url)) {
    return convertFileSrc(url);
  }
  return "";
};

/** Convert an image Blob to raw RGBA pixel data + dimensions via a canvas. */
function blobToRgba(blob: Blob): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get 2d canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ rgba: new Uint8Array(imageData.data.buffer), width: canvas.width, height: canvas.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load pasted image"));
    };
    img.src = url;
  });
}

// ── Markdown helpers ────────────────────────────────────────────────

// ── Component ───────────────────────────────────────────────────────

export function RecordDetail({
  record,
  loading,
  onUpdate,
  onConvertToTask,
  onUpdateTaskStatus,
  onDelete,
  growthPreviewEnabled,
}: RecordDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [converting, setConverting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [latestAiResult, setLatestAiResult] = useState<LearningAnalysisResult | null>(null);
  //全屏预览窗口
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const aiSectionRef = useRef<HTMLElement | null>(null);

  // ── Editor / preview split ratio (persisted, proportional resize) ──
  const { ratio: editorRatio, startResize: startEditorResize, resetRatio: resetEditorRatio } =
    useEditorPreviewResize();

  // ── Editor / preview scroll sync (toggled, proportional) ──
  // Only active while editing AND the preview pane is visible.
  const [scrollAnchors, setScrollAnchors] = useState<{ editor: number[]; preview: number[] }>({
    editor: [],
    preview: [],
  });
  const {
    syncScroll,
    toggle: toggleSyncScroll,
    editorRef: syncEditorRef,
    previewRef: syncPreviewRef,
    scrollToHeading: scrollToSyncedHeading,
  } = useEditorPreviewSyncScroll(editingContent && showPreview, scrollAnchors);

  // ── TOC rail width (persisted, clamped px resize) ──
  const { width: tocWidth, startResize: startTocResize, resetWidth: resetTocWidth } =
    useTocResize();

  const { selectRecord, hydrateRecord } = useRecordsStore();
  const startLearningSession = useLearningCoachStore((state) => state.startSession);
  const allTags = useTagsStore((s) => s.tags);
  const createTag = useTagsStore((s) => s.createTag);

  // ── Tag management ──
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#a78bfa");
  const tagPopoverRef = useRef<HTMLDivElement>(null);
  const TAG_PRESET_COLORS = [
    "#a78bfa", "#fbbf24", "#34d399", "#fb7185",
    "#38bdf8", "#fb923c", "#e879f9", "#2dd4bf",
  ];

  // Close tag popover on outside click
  useEffect(() => {
    if (!showTagPopover) return;
    const handler = (e: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(e.target as Node)) {
        setShowTagPopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTagPopover]);

  const recordTagIds = useMemo(
    () => new Set(record?.tags.map((t) => t.id) ?? []),
    [record?.tags],
  );

  const effectiveKnowledgeTopics = useMemo<EffectiveKnowledgeTopic[]>(
    () => (record?.knowledge_topics ?? []).map((topic) => ({
      key: `${topic.topic_id}-${topic.updated_at}`,
      topicId: topic.topic_id,
      name: topic.name,
      rawStatus: topic.mastery_level,
      masteryLevel: KNOWLEDGE_STATUS_LABELS[topic.mastery_level] ?? topic.mastery_level,
      summary: topic.summary,
      evidenceText: topic.evidence_text,
      canPromote: topic.mastery_level === "candidate",
    })),
    [record?.knowledge_topics],
  );

  const knowledgeTopicByName = useMemo(() => {
    const map = new Map<string, EffectiveKnowledgeTopic>();
    effectiveKnowledgeTopics.forEach((topic) => {
      map.set(normalizeTopicName(topic.name), topic);
    });
    return map;
  }, [effectiveKnowledgeTopics]);

  const { persistedLearningAnalysisEntries, legacyAiResults } = useMemo(() => {
    const entries: PersistedLearningAnalysisEntry[] = [];
    const legacy: AiResultItem[] = [];

    for (const ai of record?.ai_results ?? []) {
      const parsed = parseLearningAnalysisResult(ai.research_result);
      if (parsed) {
        entries.push({ ai, result: parsed });
      } else {
        legacy.push(ai);
      }
    }

    return {
      persistedLearningAnalysisEntries: entries,
      legacyAiResults: legacy,
    };
  }, [record?.ai_results]);

  const visibleLatestAiResult = useMemo(() => {
    if (!latestAiResult) return null;
    return persistedLearningAnalysisEntries.length === 0 ? latestAiResult : null;
  }, [latestAiResult, persistedLearningAnalysisEntries.length]);

  const availableTags = useMemo(
    () => allTags.filter((t) => !recordTagIds.has(t.id)),
    [allTags, recordTagIds],
  );

  const handleRemoveTag = useCallback(
    async (tagId: string) => {
      if (!record) return;
      const newIds = (record.tags ?? [])
        .filter((t) => t.id !== tagId)
        .map((t) => t.id);
      try {
        await setRecordTags(record.id, newIds);
        await selectRecord(record.id);
      } catch {
        // error handled elsewhere
      }
    },
    [record, selectRecord],
  );

  const handleAddTag = useCallback(
    async (tagId: string) => {
      if (!record) return;
      const newIds = [...(record.tags ?? []).map((t) => t.id), tagId];
      try {
        await setRecordTags(record.id, newIds);
        await selectRecord(record.id);
        setShowTagPopover(false);
      } catch {
        // error handled elsewhere
      }
    },
    [record, selectRecord],
  );

  const handleCreateAndAddTag = useCallback(async () => {
    if (!record || !newTagName.trim()) return;
    try {
      const tag = await createTag(newTagName.trim(), newTagColor);
      setNewTagName("");
      await handleAddTag(tag.id);
    } catch {
      // error handled by store
    }
  }, [record, newTagName, newTagColor, createTag, handleAddTag]);

  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  // Mirrors contentDraft for use inside async callbacks (paste/drop) where
  // the closure would otherwise capture a stale value.
  const contentDraftRef = useRef("");
  useEffect(() => {
    contentDraftRef.current = contentDraft;
  }, [contentDraft]);

  // Mirrors record + editingContent for the window-level drag-drop listener.
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  const editingContentRef = useRef(editingContent);
  useEffect(() => {
    editingContentRef.current = editingContent;
  }, [editingContent]);

  // ── Auto-save infrastructure ──────────────────────────────────────
  // The auto-save system works as follows:
  // 1. While editing, a debounced effect watches `contentDraft` / `titleDraft`.
  //    When they diverge from the last persisted value, a pending save is
  //    recorded in a ref and a 1.2s timer is started.
  // 2. If the timer fires, the pending save is flushed to the backend.
  // 3. If the user switches records, navigates away (unmount), or manually
  //    clicks 保存/完成, the pending save is flushed immediately so no edits
  //    are lost.
  // `draftRecordIdRef` tracks which record the current draft belongs to —
  // this prevents a stale draft from being saved onto the wrong record after
  // the user switches selection.

  // The record id the current draft belongs to (null = no active draft).
  const draftRecordIdRef = useRef<string | null>(null);
  // Pending content save awaiting debounce flush or explicit flush.
  const pendingContentSaveRef = useRef<{ recordId: string; content: string } | null>(null);
  // Last content successfully persisted (trimmed). Prevents redundant saves
  // and feedback loops.
  const lastSavedContentRef = useRef<string>("");
  // Content as it was when the current edit session started. Used by
  // finishEditContent ("取消") to revert any auto-saved intermediate versions
  // back to the pre-edit content.
  const editStartContentRef = useRef<string>("");

  // Mirror titleDraft for use in async flush callbacks.
  const titleDraftRef = useRef("");
  useEffect(() => {
    titleDraftRef.current = titleDraft;
  }, [titleDraft]);
  const pendingTitleSaveRef = useRef<{ recordId: string; title: string } | null>(null);
  const lastSavedTitleRef = useRef<string>("");

  // Flush a single pending content save. Reads from ref → safe to call from
  // any effect cleanup or callback without stale-closure issues.
  const flushContentSave = useCallback(() => {
    const pending = pendingContentSaveRef.current;
    if (!pending) return;
    pendingContentSaveRef.current = null;
    const trimmed = pending.content.trim();
    if (trimmed === lastSavedContentRef.current.trim()) return;
    lastSavedContentRef.current = trimmed;
    void onUpdate(pending.recordId, {
      content: trimmed,
    });
  }, [onUpdate]);

  // Flush a single pending title save.
  const flushTitleSave = useCallback(() => {
    const pending = pendingTitleSaveRef.current;
    if (!pending) return;
    pendingTitleSaveRef.current = null;
    const trimmed = pending.title.trim();
    if (trimmed === lastSavedTitleRef.current.trim()) return;
    lastSavedTitleRef.current = trimmed;
    void onUpdate(pending.recordId, {
      title: trimmed,
    });
  }, [onUpdate]);

  // Points at whichever markdown container is currently rendered (view body or
  // edit preview). Used by the TOC to locate heading elements for scroll jumps.
  const markdownContainerRef = useRef<HTMLDivElement>(null);

  const scrollToHeading = useCallback((index: number) => {
    if (editingContent && scrollToSyncedHeading(index)) return;
    const container = markdownContainerRef.current;
    if (!container) return;
    const headings = container.querySelectorAll("h1, h2, h3");
    const target = headings[index];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [editingContent, scrollToSyncedHeading]);

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
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        if (!src) return null;
        const resolved = /^(https?:|data:|asset:|blob:)/i.test(src)
          ? src
          : convertFileSrc(src);
        if (!resolved) return null;
        return (
          <img
            src={resolved}
            alt={alt}
            onClick={() => setPreviewSrc(resolved)}
            className="max-h-96 w-full cursor-zoom-in rounded-xl border border-border object-contain my-3"
          />
        );
      },
    }),
    [setPreviewSrc],
  );

  // TOC source — draft while editing, final content while viewing
  const tocSource = editingContent ? contentDraft : (record?.content ?? "");
  const toc = useMemo(() => extractMarkdownToc(tocSource), [tocSource]);

  // Measure matching headings in both scroll panes. The textarea mirror is
  // necessary because soft wrapping makes source character/line offsets
  // different from its pixel scroll positions.
  useLayoutEffect(() => {
    if (!editingContent || !showPreview || toc.length === 0) {
      setScrollAnchors((current) => (
        current.editor.length === 0 && current.preview.length === 0
          ? current
          : { editor: [], preview: [] }
      ));
      return;
    }

    const textarea = contentRef.current;
    const preview = syncPreviewRef.current;
    const markdown = markdownContainerRef.current;
    if (!textarea || !preview || !markdown) return;

    let frame = 0;
    const measure = () => {
      const computed = window.getComputedStyle(textarea);
      const mirror = document.createElement("div");
      Object.assign(mirror.style, {
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        zIndex: "-1",
        top: "0",
        left: "-100000px",
        width: `${textarea.clientWidth}px`,
        boxSizing: computed.boxSizing,
        padding: computed.padding,
        border: computed.border,
        font: computed.font,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        tabSize: computed.tabSize,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        wordBreak: "break-word",
      });

      const sourceMarkers: HTMLSpanElement[] = [];
      let cursor = 0;
      for (const entry of toc) {
        mirror.append(document.createTextNode(contentDraft.slice(cursor, entry.start)));
        const lineEnd = contentDraft.indexOf("\n", entry.start);
        const marker = document.createElement("span");
        marker.textContent = contentDraft.slice(entry.start, lineEnd === -1 ? contentDraft.length : lineEnd);
        mirror.append(marker);
        sourceMarkers.push(marker);
        cursor = lineEnd === -1 ? contentDraft.length : lineEnd;
      }
      mirror.append(document.createTextNode(contentDraft.slice(cursor)));
      document.body.append(mirror);

      const editor = sourceMarkers.map((marker) => marker.offsetTop);
      mirror.remove();

      const headings = Array.from(markdown.querySelectorAll("h1, h2, h3"));
      const previewRect = preview.getBoundingClientRect();
      let headingCursor = 0;
      const rendered = toc.map((entry) => {
        const match = headings.findIndex((heading, index) => (
          index >= headingCursor
          && heading.tagName === `H${entry.level}`
          && heading.textContent?.trim() === entry.text
        ));
        if (match === -1) return null;
        headingCursor = match + 1;
        const rect = headings[match].getBoundingClientRect();
        return rect.top - previewRect.top + preview.scrollTop;
      });

      if (rendered.some((position) => position == null)) {
        setScrollAnchors({ editor: [], preview: [] });
        return;
      }
      const next = { editor, preview: rendered as number[] };
      setScrollAnchors((current) => (
        current.editor.every((value, index) => value === next.editor[index])
        && current.preview.every((value, index) => value === next.preview[index])
        && current.editor.length === next.editor.length
        && current.preview.length === next.preview.length
          ? current
          : next
      ));
    };

    frame = requestAnimationFrame(measure);
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    resizeObserver.observe(textarea);
    resizeObserver.observe(preview);
    resizeObserver.observe(markdown);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [contentDraft, editingContent, showPreview, toc]);

  // Keep lastSaved* refs in sync with the record from the server.
  useEffect(() => {
    lastSavedContentRef.current = record?.content ?? "";
    lastSavedTitleRef.current = record?.title ?? "";
  }, [record?.id, record?.content, record?.title]);

  // Debounced auto-save for content while editing.
  useEffect(() => {
    if (!editingContent || !record) return;
    // Only auto-save if the draft belongs to the currently selected record.
    if (draftRecordIdRef.current !== record.id) return;
    const draft = contentDraft;
    if (draft.trim() === lastSavedContentRef.current.trim()) {
      pendingContentSaveRef.current = null;
      return;
    }
    pendingContentSaveRef.current = { recordId: record.id, content: draft };
    const timer = setTimeout(() => {
      flushContentSave();
    }, 1200);
    return () => clearTimeout(timer);
  }, [editingContent, contentDraft, record, flushContentSave]);

  // Debounced auto-save for title while editing.
  useEffect(() => {
    if (!editingTitle || !record) return;
    if (draftRecordIdRef.current !== record.id) return;
    const draft = titleDraft;
    if (draft.trim() === lastSavedTitleRef.current.trim()) {
      pendingTitleSaveRef.current = null;
      return;
    }
    pendingTitleSaveRef.current = { recordId: record.id, title: draft };
    const timer = setTimeout(() => {
      flushTitleSave();
    }, 800);
    return () => clearTimeout(timer);
  }, [editingTitle, titleDraft, record, flushTitleSave]);

  // When the selected record changes, flush any pending draft for the OLD
  // record before resetting editing state. Also invalidate the draft so the
  // auto-save effect doesn't fire against the new record with stale content.
  useEffect(() => {
    flushContentSave();
    flushTitleSave();
    draftRecordIdRef.current = null;
    pendingContentSaveRef.current = null;
    pendingTitleSaveRef.current = null;
    setEditingTitle(false);
    setEditingContent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);

  // Flush pending saves on unmount (e.g. navigating to settings / closing panel)
  useEffect(() => {
    return () => {
      flushContentSave();
      flushTitleSave();
    };
  }, [flushContentSave, flushTitleSave]);

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
    draftRecordIdRef.current = record?.id ?? null;
    if (!record?.title) {
      setTitleDraft("");
    } else {
      setTitleDraft(record.title);
    }
    setEditingTitle(true);
  }, [record]);

  const startEditContent = useCallback(() => {
    draftRecordIdRef.current = record?.id ?? null;
    const original = record?.content ?? "";
    editStartContentRef.current = original;
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
    if (trimmed === lastSavedTitleRef.current.trim()) return;
    pendingTitleSaveRef.current = null;
    await onUpdate(record.id, {
      title: trimmed,
    });
    lastSavedTitleRef.current = trimmed;
  }, [record, titleDraft, onUpdate]);

  const saveContent = useCallback(async () => {
    if (!record) return;
    const trimmed = contentDraft.trim();
    if (trimmed !== lastSavedContentRef.current.trim()) {
      pendingContentSaveRef.current = null;
      await onUpdate(record.id, {
        content: trimmed,
      });
      lastSavedContentRef.current = trimmed;
    }
    setEditingContent(false);
  }, [record, contentDraft, onUpdate]);

  // Exit edit mode, discarding ALL changes made during this edit session.
  // "取消" acts as a true cancel: any pending auto-save is dropped, and if
  // auto-save already persisted an intermediate version that differs from the
  // content at edit-start, we revert via onUpdate so the record returns to its
  // pre-edit state.
  const finishEditContent = useCallback(() => {
    if (!record) {
      setEditingContent(false);
      return;
    }
    const original = editStartContentRef.current;
    // Drop any pending auto-save so it can't fire after we cancel.
    pendingContentSaveRef.current = null;
    draftRecordIdRef.current = null;
    // If auto-save already wrote a version different from edit-start, revert.
    const persisted = lastSavedContentRef.current.trim();
    if (persisted !== original.trim()) {
      lastSavedContentRef.current = original;
      // Pass the string directly (even if empty) so Rust deserializes to
      // Some("...") / Some("") and db.update_record overwrites the column.
      // Passing null → None → Option::or falls back to current → no clear.
      void onUpdate(record.id, {
        content: original,
      });
    }
    setEditingContent(false);
  }, [record, onUpdate]);

  const insertMarkdownAtCursor = useCallback((text: string) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const draft = contentDraftRef.current;
    const prefix = draft.slice(0, start);
    const suffix = draft.slice(end);
    // Add newlines around the image if we're not at the start of a line.
    const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith("\n");
    const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith("\n");
    const insertion =
      (needsLeadingNewline ? "\n" : "") +
      text +
      (needsTrailingNewline ? "\n" : "");
    const next = prefix + insertion + suffix;
    setContentDraft(next);
    contentDraftRef.current = next;
    const newCursor = start + insertion.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = newCursor;
    });
  }, []);

  const addImagePathsToRecord = useCallback(
    async (paths: string[]) => {
      if (!record) return;
      const oldIds = new Set(record.attachments.map((a) => a.id));
      await addAttachmentsToRecord(record.id, paths);
      const updated = await getRecordDetail(record.id);
      const newAttachments = updated.attachments.filter(
        (a) => !oldIds.has(a.id) && (a.file_type === "image" || a.file_type === "screenshot"),
      );
      if (newAttachments.length > 0) {
        // Store the convertFileSrc URL (http://asset.localhost/...) in the
        // markdown so ReactMarkdown's default urlTransform doesn't strip it
        // and the img renderer can display it directly.
        const markdown = newAttachments
          .map((a) => `![](${convertFileSrc(a.local_path)})`)
          .join("\n\n");
        insertMarkdownAtCursor(markdown);
      }
      await selectRecord(record.id);
    },
    [record, selectRecord, insertMarkdownAtCursor],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!record) return;
      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return; // let default text paste happen
      const blob = imageItem.getAsFile();
      if (!blob) return;
      e.preventDefault();
      try {
        const { rgba, width, height } = await blobToRgba(blob);
        const tempPath = await saveClipboardImage(
          Array.from(rgba),
          width,
          height,
        );
        await addImagePathsToRecord([tempPath]);
      } catch (error) {
        console.error("Failed to paste image:", error);
      }
    },
    [record, addImagePathsToRecord],
  );

  const addImagePathsToRecordRef = useRef(addImagePathsToRecord);
  useEffect(() => {
    addImagePathsToRecordRef.current = addImagePathsToRecord;
  }, [addImagePathsToRecord]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listenForFileDrops(async ({ paths }) => {
      if (!editingContentRef.current) return;
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const imagePaths = paths.filter((p) =>
        /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p),
      );
      if (imagePaths.length === 0) return;
      try {
        await addImagePathsToRecordRef.current(imagePaths);
      } catch (error) {
        console.error("Failed to drop images:", error);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
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
      const taskRun = await runAiTask({
        taskType: "learning_analysis",
        payload: {
          recordId: record.id,
          includeRelatedTasks: true,
          interactionMode: "prepare",
        },
      });

      if (taskRun.result_json) {
        const parsed = parseLearningAnalysisResult(taskRun.result_json);
        setLatestAiResult(parsed);
      } else {
        setLatestAiResult(null);
      }

      // Re-fetch detail to get fresh ai_results, but hydrate directly so the
      // current detail pane updates immediately without relying on selection churn.
      const updated = await getRecordDetail(record.id);
      hydrateRecord(updated);
      requestAnimationFrame(() => {
        aiSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiAnalyzing(false);
    }
  }, [record, aiAnalyzing, hydrateRecord]);

  const handleStartLearningSession = useCallback((
    topicId: string,
    topicName: string,
    summary: string,
    evidenceText: string,
    noteExample: string | null,
    questions: string[],
  ) => {
    if (!record) return;
    const openingQuestion = questions[0]
      ?? `你可以先用自己的话说说，你现在怎么理解“${topicName}”？`;
    startLearningSession({
      id: `${record.id}:${topicId}:${Date.now()}`,
      topicId,
      topicName,
      sourceRecordId: record.id,
      sourceRecordTitle: record.title ?? null,
      summary,
      evidenceText,
      noteExample,
      suggestedQuestions: questions,
      messages: [
        {
          role: "assistant",
          content: `我想和你聊聊“${topicName}”。${openingQuestion}`,
        },
      ],
      createdAt: new Date().toISOString(),
      status: "active",
    });
  }, [record, startLearningSession]);

  const renderLearningAnalysisCard = (
    result: LearningAnalysisResult,
    keyPrefix: string,
    ai?: AiResultItem,
  ): ReactNode => (
    <div className="overflow-hidden rounded-xl border border-primary/18 bg-primary/[4%]">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <svg className="h-3 w-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[11px] font-medium text-primary">
              本次学习分析
            </p>
            <p className="text-xs leading-6 text-text">
              {result.summary}
            </p>
          </div>
        </div>
      </div>

      {result.knowledge_points.length > 0 && (
        <div className="border-t border-primary/10 px-4 py-3">
          <p className="mb-2 text-[11px] font-medium text-primary">
            识别出的知识点
          </p>
          <div className="space-y-2">
            {result.knowledge_points.map((point, index) => (
              <div key={`${keyPrefix}-point-${point.name}-${index}`} className="rounded-lg bg-surface/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-text">{point.name}</p>
                  <span className="text-[10px] text-text-muted">
                    置信度 {Math.round(point.confidence * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">
                  {point.example_from_note}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.questions_for_user.length > 0 && (
        <div className="border-t border-primary/10 px-4 py-3">
          <p className="mb-2 text-[11px] font-medium text-primary">
            建议继续追问
          </p>
          <ul className="space-y-1">
            {result.questions_for_user.map((question, index) => (
              <li key={`${keyPrefix}-question-${index}`} className="flex items-start gap-2 text-xs leading-5 text-text-muted">
                <span className="mt-[5px] inline-block h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                {question}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.suggested_memory_updates.length > 0 && (
        <div className="border-t border-primary/10 px-4 py-3">
          <p className="mb-2 text-[11px] font-medium text-primary">
            本次识别的候选知识
          </p>
          <p className="mb-2 text-[11px] leading-5 text-text-muted">
            这些内容会先作为待确认候选项，后续需要通过宠物对话再决定是否进入用户知识记忆。
          </p>
          <div className="space-y-2">
            {result.suggested_memory_updates.map((update, index) => {
              const matchedTopic = knowledgeTopicByName.get(normalizeTopicName(update.topic));
              const candidateTopicId = matchedTopic?.canPromote ? matchedTopic.topicId : null;
              const matchedPoint = result.knowledge_points.find((point) =>
                normalizeTopicName(point.name) === normalizeTopicName(update.topic),
              );
              return (
                <div key={`${keyPrefix}-memory-${update.topic}-${index}`} className="rounded-lg bg-surface/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-text">{update.topic}</p>
                    <span className="text-[10px] text-text-muted">
                      {matchedTopic?.masteryLevel ?? KNOWLEDGE_STATUS_LABELS[update.mastery_level] ?? "待确认"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-text-muted">
                    {update.evidence}
                  </p>
                  {candidateTopicId && (
                    <div className="mt-3">
                      <p className="mb-2 text-[11px] leading-5 text-text-muted">
                        先把这个候选知识交给宠物，聊过之后再决定是否写入知识记忆。
                      </p>
                      <button
                        type="button"
                        onClick={() => handleStartLearningSession(
                          candidateTopicId,
                          update.topic,
                          result.summary,
                          update.evidence,
                          matchedPoint?.example_from_note ?? null,
                          result.questions_for_user,
                        )}
                        className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 px-3 py-1.5 text-[11px] font-medium text-secondary transition hover:bg-secondary/25"
                      >
                        和宠物聊聊
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ai && (
        <div className="border-t border-primary/10 px-4 py-2">
          <div className="flex items-center gap-3 text-[10px] text-text0">
            {ai.model_name && <span>{ai.model_name}</span>}
            <span className="text-text-muted">·</span>
            <span>
              {ai.trigger_mode === "auto"
                ? "自动分析"
                : ai.trigger_mode === "smart"
                  ? "智能分析"
                  : "手动分析"}
            </span>
            <span className="text-text-muted">·</span>
            <span>{formatDateTime(ai.created_at)}</span>
          </div>
        </div>
      )}
    </div>
  );

  useEffect(() => {
    setLatestAiResult(null);
    setAiError(null);
  }, [record?.id]);

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

  if (loading && !editingContent) {
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
      <div className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          {!editingContent && (
            <button
              type="button"
              onClick={startEditContent}
              className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2.5 py-1
                text-[11px] font-medium text-secondary transition hover:bg-secondary/25"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
              </svg>
              编辑
            </button>
          )}

          {!editingContent && !hasTask && (
            <button
              type="button"
              onClick={() => void handleConvertToTask()}
              disabled={converting}
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary/10 px-3 py-1
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

          {growthPreviewEnabled && !editingContent && (
            <button
              type="button"
              onClick={() => void handleTriggerAi()}
              disabled={aiAnalyzing}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1
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
          )}

          <div className="flex-1" />

          {!editingContent && (
            <button
              type="button"
              onClick={() => onDelete(record.id)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1
                text-xs text-text0 transition hover:bg-danger/10 hover:text-danger"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              删除
            </button>
          )}
        </div>
      </div>

      {/* Body + TOC rail */}
      <div className="flex min-h-0 flex-1">
        {editingContent ? (
          /* ── Focus edit view: split editor + live preview ── */
          <div className="flex min-w-0 flex-1">
            <textarea
              ref={(el) => {
                contentRef.current = el;
                syncEditorRef.current = el;
              }}
              value={contentDraft}
              onChange={(e) => setContentDraft(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  finishEditContent();
                }
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void saveContent();
                }
              }}
              placeholder="使用 Markdown 编写…  自动保存已开启 · Ctrl+Enter 立即保存 · Esc 取消"
              className={`${
                showPreview ? "border-r border-border" : "w-full"
              } resize-none bg-surface/60
                px-5 py-4 text-sm leading-6 text-text outline-none
                font-mono placeholder:text-text-muted`}
              style={
                showPreview
                  ? { flex: `${editorRatio} 1 0%` }
                  : undefined
              }
            />
            {showPreview && (
              <>
                <div
                  className="col-resize-handle shrink-0"
                  onPointerDown={startEditorResize}
                  onDoubleClick={resetEditorRatio}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整编辑器与预览宽度"
                />
                <div
                  ref={syncPreviewRef}
                  className="overflow-y-auto overscroll-contain p-5"
                  style={{ flex: `${1 - editorRatio} 1 0%` }}
                >
                  {contentDraft.trim() ? (
                    <div className="markdown-body" ref={markdownContainerRef}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents} urlTransform={markdownUrlTransform}>
                        {contentDraft}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm italic text-text0">实时预览…</p>
                  )}
                </div>
              </>
            )}
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
                  <div className="group flex items-start gap-2">
                    <h2 className="flex-1 text-lg font-medium leading-7 text-text select-text">
                      {record.title || (
                        <span className="italic text-text0">无标题</span>
                      )}
                    </h2>
                    <button
                      type="button"
                      onClick={startEditTitle}
                      title="编辑标题"
                      className="mt-1 shrink-0 rounded-lg p-1 text-text-muted opacity-0 transition hover:bg-white/5 hover:text-text focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                  </div>
                )}
              </section>

              {/* Meta badges */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-text">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    record.type === "note" ? "bg-text-muted" : "bg-secondary"
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

              {/* Tags */}
              <section>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                  标签
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {record.tags && record.tags.length > 0
                    ? record.tags.map((tag) => {
                        const hasColor = !!tag.color;
                        return (
                          <span
                            key={tag.id}
                            className={`
                              inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]
                              ${hasColor ? "" : "bg-white/5 text-text"}
                            `}
                          style={
                            hasColor
                              ? {
                                  backgroundColor: `${tag.color!}1a`,
                                  color: tag.color!,
                                }
                              : undefined
                          }
                        >
                          {tag.name}
                          <button
                            type="button"
                            onClick={() => void handleRemoveTag(tag.id)}
                            className="ml-0.5 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
                          >
                            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      );
                        })
                      : null}
                  {/* Add tag button */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowTagPopover((prev) => !prev)}
                      className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-white/15 px-2 py-0.5 text-[11px] text-text-muted transition hover:border-white/30 hover:text-text"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      添加
                    </button>

                    {showTagPopover && (
                      <div
                        ref={tagPopoverRef}
                        className="absolute left-0 z-50 mt-1 w-56 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur-xl"
                      >
                        {availableTags.length > 0 && (
                          <div className="mb-2">
                            <p className="mb-1.5 text-[10px] font-medium text-text-muted">
                              已有标签
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {availableTags.map((tag) => {
                                const hasColor = !!tag.color;
                                return (
                                  <button
                                    key={tag.id}
                                    type="button"
                                    onClick={() => void handleAddTag(tag.id)}
                                    className={`
                                      rounded-full px-2 py-0.5 text-[10px] font-medium transition
                                      ${hasColor ? "" : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text"}
                                    `}
                                  style={
                                        hasColor
                                          ? {
                                              backgroundColor: `${tag.color!}1a`,
                                              color: tag.color!,
                                            }
                                          : undefined
                                      }
                                    >
                                      {tag.name}
                                    </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <p className="mb-1.5 text-[10px] font-medium text-text-muted">
                          新建标签
                        </p>
                        <input
                          type="text"
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleCreateAndAddTag();
                            }
                            if (e.key === "Escape") {
                              setShowTagPopover(false);
                            }
                          }}
                          placeholder="输入名称…"
                          className="mb-2 w-full rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs text-text placeholder-text-muted outline-none transition focus:border-secondary/40 focus:ring-2 focus:ring-secondary/20"
                          autoFocus
                        />
                        <div className="mb-2 flex gap-1.5">
                          {TAG_PRESET_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setNewTagColor(color)}
                              className={`h-4 w-4 rounded-full transition-all duration-150 ${
                                newTagColor === color
                                  ? "ring-2 ring-white ring-offset-1 ring-offset-surface/95"
                                  : "ring-1 ring-white/10"
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCreateAndAddTag()}
                          disabled={!newTagName.trim()}
                          className="w-full rounded-lg bg-secondary/15 px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-secondary/25 disabled:opacity-40"
                        >
                          创建并添加
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Content */}
              <section>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                  内容
                </p>
                {record.content ? (
                  <div className="markdown-body select-text" ref={markdownContainerRef}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents} urlTransform={markdownUrlTransform}>
                      {record.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startEditContent}
                    className="group w-full text-left"
                  >
                    <p className="text-sm italic leading-6 text-text0">
                      无内容，点击添加
                    </p>
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
              {growthPreviewEnabled && (visibleLatestAiResult || persistedLearningAnalysisEntries.length > 0 || legacyAiResults.length > 0) && (
                <section ref={aiSectionRef}>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                    AI 分析
                  </p>
                  <div className="space-y-3">
                    {visibleLatestAiResult && (
                      <>{renderLearningAnalysisCard(visibleLatestAiResult, "latest")}</>
                    )}

                    {persistedLearningAnalysisEntries.map(({ ai, result }) => (
                      <div key={ai.id}>
                        {renderLearningAnalysisCard(result, ai.id, ai)}
                      </div>
                    ))}

                    {legacyAiResults.map((ai) => (
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

              {growthPreviewEnabled && effectiveKnowledgeTopics.length > 0 && (
                <section>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
                    待确认知识状态
                  </p>
                  <p className="mb-3 text-[11px] leading-5 text-text-muted">
                    这里展示的是从当前记录中沉淀出的候选知识或阶段性状态，不等同于已经确认的用户知识记忆。
                  </p>
                  <div className="space-y-3">
                    {effectiveKnowledgeTopics.map((topic) => (
                      <div
                        key={topic.key}
                        className="overflow-hidden rounded-xl border border-secondary/15 bg-secondary/[4%]"
                      >
                        <div className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary/12">
                              <svg className="h-3 w-3 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m4-2a8 8 0 11-16 0 8 8 0 0116 0z" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-medium text-secondary">
                                  {topic.name}
                                </p>
                                <span className="text-[10px] text-text-muted">
                                  {topic.masteryLevel}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-6 text-text">
                                {topic.summary}
                              </p>
                              <p className="mt-2 text-[11px] leading-5 text-text-muted">
                                证据：{topic.evidenceText}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {/* AI Error */}
              {growthPreviewEnabled && aiError && (
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

        {/* ── TOC resize handle ── */}
        {toc.length > 0 && (
          <div
            className="col-resize-handle shrink-0"
            onPointerDown={startTocResize}
            onDoubleClick={resetTocWidth}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整目录宽度"
          />
        )}

        {/* ── TOC right rail ── */}
        {toc.length > 0 && (
          <aside
            className="shrink-0 overflow-y-auto border-l border-border bg-bg/30 px-3 py-4"
            style={{ width: tocWidth }}
          >
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
      {editingContent && (
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
              onClick={finishEditContent}
              title="丢弃本次编辑改动并退出"
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5
                text-xs font-medium text-text-muted transition hover:bg-white/5 hover:text-text"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => setShowPreview((prev) => !prev)}
              title={showPreview ? "关闭预览" : "开启预览"}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
                text-xs font-medium transition ${
                  showPreview
                    ? "bg-secondary/10 text-secondary hover:bg-secondary/20"
                    : "text-text-muted hover:bg-white/5 hover:text-text"
                }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {showPreview ? "预览中" : "预览"}
            </button>
            {showPreview && (
              <button
                type="button"
                onClick={toggleSyncScroll}
                title={syncScroll ? "关闭同步滚动" : "开启同步滚动"}
                aria-pressed={syncScroll}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
                  text-xs font-medium transition ${
                    syncScroll
                      ? "bg-secondary/10 text-secondary hover:bg-secondary/20"
                      : "text-text-muted hover:bg-white/5 hover:text-text"
                  }`}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 10l5-5 5 5M7 14l5 5 5-5" />
                </svg>
                {syncScroll ? "同步中" : "同步"}
              </button>
            )}
            <div className="flex-1" />
            <span className="text-[10px] text-text-muted">
              自动保存已开启 · Ctrl+Enter 立即保存 · Esc 取消
            </span>
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
