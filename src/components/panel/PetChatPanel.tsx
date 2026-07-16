import { useEffect, useState } from "react";

import { getLatestPetChatSession, listPetChatMessages, listRecords, runAiTask } from "../../lib/tauri";
import { useSettingsStore } from "../../store/settings";
import type { PetChatResult, RecordItem } from "../../types";

type Message = { role: "user" | "assistant"; content: string };

export function PetChatPanel() {
  const settings = useSettingsStore((state) => state.settings);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RecordItem[]>([]);
  const [includeContext, setIncludeContext] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await getLatestPetChatSession();
        if (!latest) return;
        const restored = await listPetChatMessages(latest.id);
        if (cancelled) return;
        setSessionId(latest.id);
        setMessages(restored.map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          content: message.content,
        })));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? `无法恢复最近对话：${cause.message}` : "无法恢复最近对话");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const query = draft.trim();
    if (!includeContext || !query) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(() => {
      void listRecords({ searchQuery: query, limit: 3 }).then(setCandidates).catch(() => setCandidates([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, includeContext]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const retainedRecordIds = includeContext ? candidates.map((record) => record.id) : [];
      const run = await runAiTask({
        taskType: "pet_chat",
        payload: {
          sessionId,
          content,
          retainedRecordIds,
          persona: settings.pet_persona ?? "gentle-companion",
          customPrompt: settings.pet_custom_prompt || null,
        },
      });
      const result = run.result_json ? JSON.parse(run.result_json) as PetChatResult : null;
      if (!result?.reply) throw new Error("宠物没有返回可用回复");
      setSessionId(result.sessionId);
      setMessages((current) => [...current, { role: "user", content }, { role: "assistant", content: result.reply }]);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const startNewConversation = () => {
    setSessionId(null);
    setMessages([]);
    setCandidates([]);
    setDraft("");
    setError(null);
  };

  return <div className="flex h-full min-h-0 flex-col p-6">
    <div className="mb-4 flex items-start justify-between gap-4"><div><p className="text-[11px] uppercase tracking-[0.2em] text-text0">桌宠搭子</p><h2 className="mt-1 text-xl font-semibold">聊聊你正在做的事</h2></div><button type="button" onClick={startNewConversation} disabled={sending} className="rounded-full border border-border px-3 py-2 text-xs text-text-muted hover:border-primary/50 hover:text-primary disabled:opacity-40">新对话</button></div>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      {messages.length === 0 && <p className="rounded-2xl border border-border bg-surface/50 p-4 text-sm text-text-muted">我会在你发送前本地找出少量相关笔记或待办；你也可以关闭本轮上下文。</p>}
      {messages.map((message, index) => <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><p className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-secondary/20" : "border border-primary/15 bg-primary/5"}`}>{message.content}</p></div>)}
    </div>
    {includeContext && <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">本轮引用：{candidates.length ? candidates.map((record) => <button type="button" onClick={() => setCandidates((current) => current.filter((item) => item.id !== record.id))} key={record.id} className="rounded-full border border-border px-2 py-1 hover:border-danger/50">{record.type === "task" ? "待办" : "笔记"} · {record.title ?? "未命名"} ×</button>) : <span>未找到相关内容</span>}</div>}
    <div className="mt-4 rounded-2xl border border-border bg-surface/60 p-3"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="想和搭子聊什么？" className="min-h-20 w-full resize-none bg-transparent text-sm outline-none" /><div className="mt-2 flex items-center justify-between"><label className="text-xs text-text-muted"><input checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} type="checkbox" className="mr-1" />本轮带相关笔记与待办</label><button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} className="rounded-full bg-primary/15 px-4 py-2 text-xs text-primary disabled:opacity-40">{sending ? "宠物思考中..." : "发送"}</button></div>{error && <p className="mt-2 text-xs text-danger">{error}</p>}</div>
  </div>;
}
