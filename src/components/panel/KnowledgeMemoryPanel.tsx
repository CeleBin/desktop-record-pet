import { useEffect, useMemo } from "react";

import { useKnowledgeMemoryStore } from "../../store/knowledgeMemory";

type KnowledgeMemoryPanelMode = "list" | "detail";

const STATUS_LABELS: Record<string, string> = {
  candidate: "待确认",
  understanding: "初步理解",
  rejected: "不是知识点",
};

const STATUS_STYLES: Record<string, string> = {
  candidate: "bg-primary/15 text-primary",
  understanding: "bg-secondary/15 text-secondary",
  rejected: "bg-text-muted/15 text-text-muted",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function conclusionReason(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
}

export function KnowledgeMemoryPanel({ mode }: { mode: KnowledgeMemoryPanelMode }) {
  const items = useKnowledgeMemoryStore((state) => state.items);
  const selectedTopicId = useKnowledgeMemoryStore((state) => state.selectedTopicId);
  const selectedDetail = useKnowledgeMemoryStore((state) => state.selectedDetail);
  const statusFilter = useKnowledgeMemoryStore((state) => state.statusFilter);
  const loading = useKnowledgeMemoryStore((state) => state.loading);
  const error = useKnowledgeMemoryStore((state) => state.error);
  const hasLoaded = useKnowledgeMemoryStore((state) => state.hasLoaded);
  const load = useKnowledgeMemoryStore((state) => state.load);
  const selectTopic = useKnowledgeMemoryStore((state) => state.selectTopic);
  const setStatusFilter = useKnowledgeMemoryStore((state) => state.setStatusFilter);

  useEffect(() => {
    if (!hasLoaded) void load();
  }, [hasLoaded, load]);

  useEffect(() => {
    if (mode !== "detail" || !selectedTopicId || selectedDetail?.topic.id === selectedTopicId) return;
    void selectTopic(selectedTopicId);
  }, [mode, selectedDetail?.topic.id, selectedTopicId, selectTopic]);

  const visibleItems = useMemo(
    () => statusFilter === "all" ? items : items.filter((item) => item.mastery_level === statusFilter),
    [items, statusFilter],
  );

  if (mode === "list") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-text0">知识记忆</p>
          <p className="mt-2 text-xs leading-5 text-text-muted">只记录经过你确认的理解过程和来源证据。</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(["all", "understanding", "candidate", "rejected"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`rounded-full px-2.5 py-1 text-[11px] transition ${statusFilter === filter ? "bg-secondary/15 text-secondary" : "bg-surface/50 text-text-muted hover:text-text"}`}
              >
                {filter === "all" ? "全部" : STATUS_LABELS[filter]}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && !hasLoaded && <p className="px-2 py-4 text-xs text-text-muted">正在读取知识记忆...</p>}
          {error && <p className="rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-danger">{error}</p>}
          {!loading && !error && visibleItems.length === 0 && (
            <p className="px-2 py-4 text-xs leading-5 text-text-muted">这里还没有符合条件的知识。先在笔记中完成一次 AI 分析和宠物对话吧。</p>
          )}
          <div className="space-y-2">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void selectTopic(item.id)}
                className={`w-full rounded-2xl border p-3 text-left transition ${selectedTopicId === item.id ? "border-secondary/35 bg-secondary/[7%]" : "border-border bg-surface/35 hover:border-secondary/20"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-text">{item.name}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${STATUS_STYLES[item.mastery_level] ?? STATUS_STYLES.candidate}`}>{STATUS_LABELS[item.mastery_level] ?? item.mastery_level}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-muted">{item.summary}</p>
                <p className="mt-2 text-[10px] text-text0">{item.evidence_count} 条证据 · {formatDate(item.updated_at)}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const conclusion = conclusionReason(selectedDetail?.latest_conclusion_json ?? null);
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      {!selectedTopicId && <EmptyDetail />}
      {selectedTopicId && !selectedDetail && !error && <p className="text-sm text-text-muted">正在读取知识详情...</p>}
      {selectedDetail && (
        <div className="mx-auto max-w-3xl">
          <div className="rounded-3xl border border-border bg-surface/35 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] ${STATUS_STYLES[selectedDetail.topic.mastery_level] ?? STATUS_STYLES.candidate}`}>{STATUS_LABELS[selectedDetail.topic.mastery_level] ?? selectedDetail.topic.mastery_level}</span>
              <span className="text-xs text-text-muted">更新于 {formatDate(selectedDetail.topic.updated_at)}</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-text">{selectedDetail.topic.name}</h2>
            <p className="mt-3 text-sm leading-7 text-text-muted">{selectedDetail.topic.summary}</p>
          </div>

          {conclusion && (
            <section className="mt-4 rounded-2xl border border-secondary/15 bg-secondary/[5%] p-4">
              <p className="text-[11px] font-medium text-secondary">最近一次确认</p>
              <p className="mt-2 text-sm leading-6 text-text">{conclusion}</p>
            </section>
          )}

          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text">理解证据</h3>
              <span className="text-xs text-text-muted">{selectedDetail.evidence.length} 条</span>
            </div>
            <div className="mt-3 space-y-3">
              {selectedDetail.evidence.map((evidence) => (
                <article key={evidence.id} className="rounded-2xl border border-border bg-surface/25 p-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text0">
                    <span>{evidence.record_title ?? "未命名记录"}</span>
                    <span>·</span>
                    <span>{formatDate(evidence.created_at)}</span>
                    <span>·</span>
                    <span>{evidence.evidence_type}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-muted">{evidence.evidence_text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div className="max-w-sm rounded-3xl border border-border bg-surface/30 px-6 py-8">
        <p className="text-sm font-medium text-text">选择一条知识记忆</p>
        <p className="mt-2 text-xs leading-6 text-text-muted">你会在这里看到它来自哪些笔记，以及为什么被记录为初步理解。</p>
      </div>
    </div>
  );
}
