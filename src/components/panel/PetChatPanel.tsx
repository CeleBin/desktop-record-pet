import { useEffect, useRef, useState } from "react";

import { generatePetChatTitle, getLatestPetChatSession, listAiProfiles, listPetChatMessages, listRecords, runAiTask, updatePetChatSessionTitle } from "../../lib/tauri";
import { useSettingsStore } from "../../store/settings";
import type { AiProfile, PetChatResult, RecordItem } from "../../types";
import { PET_CHAT_HISTORY_REFRESH_EVENT, PET_CHAT_NEW_SESSION_EVENT, PET_CHAT_OPEN_SESSION_EVENT } from "./PetChatHistoryPanel";

type Message = { role: "user" | "assistant"; content: string };

function createLocalChatTitle(content: string): string {
  const title = content.trim()
    .replace(/^(请问|请帮我|帮我|我想|我需要|能不能|可以帮我)\s*/u, "")
    .replace(/[。！？!?，,；;]+$/u, "")
    .trim();
  return Array.from(title || "新对话").slice(0, 18).join("");
}

async function revealReply(
  reply: string,
  isCurrent: () => boolean,
  onUpdate: (content: string) => void,
): Promise<void> {
  const characters = Array.from(reply);
  const step = Math.max(1, Math.ceil(characters.length / 80));
  for (let index = step; index <= characters.length; index += step) {
    if (!isCurrent()) return;
    onUpdate(characters.slice(0, index).join(""));
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  if (isCurrent()) onUpdate(reply);
}

export function PetChatPanel() {
  const settings = useSettingsStore((state) => state.settings);
  const petName = settings.pet_name?.trim() || "小宠物";
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RecordItem[]>([]);
  const [contextRecords, setContextRecords] = useState<RecordItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<RecordItem[]>([]);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await getLatestPetChatSession();
        if (cancelled) return;
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

  const openSession = async (sessionId: string) => {
    const restored = await listPetChatMessages(sessionId);
    setSessionId(sessionId);
    setMessages(restored.map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    })));
    setError(null);
  };

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const sessionId = (event as CustomEvent<string>).detail;
      if (sessionId) void openSession(sessionId);
    };
    const handleNew = () => startNewConversation();
    window.addEventListener(PET_CHAT_OPEN_SESSION_EVENT, handleOpen);
    window.addEventListener(PET_CHAT_NEW_SESSION_EVENT, handleNew);
    return () => {
      window.removeEventListener(PET_CHAT_OPEN_SESSION_EVENT, handleOpen);
      window.removeEventListener(PET_CHAT_NEW_SESSION_EVENT, handleNew);
    };
  }, []);

  useEffect(() => {
    void listAiProfiles().then((next) => {
      setProfiles(next);
      const usable = next.filter((profile) => profile.enabled && profile.apiKeyConfigured);
      const preferred = usable.find((profile) => profile.id === settings.ai_default_profile_id) ?? usable[0];
      if (!preferred) return;
      // Sync the chat selector with the settings default. The user can still
      // switch profiles manually for the current conversation afterwards.
      setSelectedProfileId(preferred.id);
      setSelectedModel(preferred.defaultModel || preferred.models[0] || "");
    }).catch(() => setProfiles([]));
  }, [settings.ai_default_profile_id]);

  useEffect(() => {
    const query = draft.trim();
    if (!includeContext || !query) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(() => {
      void listRecords({ searchQuery: query, limit: 3 }).then((next) => {
        setCandidates(next);
      }).catch(() => setCandidates([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, includeContext]);

  useEffect(() => {
    if (!pickerOpen) return;
    const timer = setTimeout(() => {
      void listRecords({ searchQuery: pickerQuery.trim() || undefined, limit: 50 }).then(setPickerResults).catch(() => setPickerResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [pickerOpen, pickerQuery]);

  const toggleContextRecord = (record: RecordItem) => {
    setContextRecords((current) => current.some((item) => item.id === record.id)
      ? current.filter((item) => item.id !== record.id)
      : [...current, record]);
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    const currentStreamVersion = ++streamVersion.current;
    const isCurrentStream = () => streamVersion.current === currentStreamVersion;
    const isFirstMessage = messages.length === 0;
    setMessages((current) => [...current, { role: "user", content }, { role: "assistant", content: "" }]);
    try {
      const retainedRecordIds = includeContext ? contextRecords.map((record) => record.id) : [];
      const run = await runAiTask({
        taskType: "pet_chat",
        payload: {
          sessionId,
          content,
          retainedRecordIds,
          persona: settings.pet_persona ?? "gentle-companion",
          customPrompt: settings.pet_custom_prompt || null,
          profileId: selectedProfileId || null,
          model: selectedModel || null,
        },
      });
      const result = run.result_json ? JSON.parse(run.result_json) as PetChatResult : null;
      if (!result?.reply) throw new Error("宠物没有返回可用回复");
      setSessionId(result.sessionId);
      await revealReply(result.reply, isCurrentStream, (reply) => {
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.role === "assistant") last.content = reply;
          return next;
        });
      });
      if (isFirstMessage) {
        const localTitle = createLocalChatTitle(content);
        await updatePetChatSessionTitle(result.sessionId, localTitle);
        void generatePetChatTitle(result.sessionId, content, result.reply, selectedProfileId || null, selectedModel || null)
          .then(() => window.dispatchEvent(new Event(PET_CHAT_HISTORY_REFRESH_EVENT)))
          .catch(() => undefined);
      }
      window.dispatchEvent(new Event(PET_CHAT_HISTORY_REFRESH_EVENT));
      setDraft("");
    } catch (cause) {
      setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message.role === "assistant" && !message.content)));
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const startNewConversation = () => {
    streamVersion.current += 1;
    setSessionId(null);
    setMessages([]);
    setCandidates([]);
    setContextRecords([]);
    setDraft("");
    setError(null);
  };

  return <div className="flex h-full min-h-0 min-w-0 flex-col p-5">
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-4"><p className="text-[11px] uppercase tracking-[0.2em] text-text0">{petName}</p><h2 className="mt-1 text-xl font-semibold">和{petName}聊聊</h2></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">{messages.length === 0 && <p className="rounded-2xl border border-border bg-surface/50 p-4 text-sm text-text-muted">我会在你发送前本地找出少量相关笔记或待办；你也可以关闭本轮上下文。</p>}{messages.map((message, index) => <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><p className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-secondary/20" : "border border-primary/15 bg-primary/5"}`}>{message.content}</p></div>)}</div>
      {includeContext && candidates.length > 0 && <div className="mt-3 rounded-xl border border-primary/15 bg-primary/[4%] p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs text-text-muted">相关内容推荐</span><span className="text-[10px] text-text0">点击后加入本轮引用</span></div><div className="flex flex-wrap gap-2">{candidates.map((record) => { const selected = contextRecords.some((item) => item.id === record.id); return <button key={record.id} type="button" onClick={() => toggleContextRecord(record)} className={`max-w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${selected ? "border-primary/60 bg-primary/15 text-primary shadow-sm shadow-primary/10" : "border-border bg-surface/50 text-text-muted hover:border-primary/40 hover:text-text"}`}><span>{record.type === "task" ? "待办" : "笔记"} · {record.title || "未命名"}</span>{selected && <span className="ml-1">✓</span>}</button>; })}</div></div>}
      {includeContext && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted"><span>本轮引用：</span>{contextRecords.map((record) => <button type="button" onClick={() => toggleContextRecord(record)} key={record.id} className="rounded-full border border-primary/50 bg-primary/10 px-2 py-1 text-primary hover:border-danger/50 hover:bg-danger/10 hover:text-danger">{record.type === "task" ? "待办" : "笔记"} · {record.title ?? "未命名"} ×</button>)}<button type="button" onClick={() => setPickerOpen(true)} className="rounded-full border border-primary/30 px-2 py-1 text-primary hover:bg-primary/10">+ 选择笔记/待办</button>{!contextRecords.length && <span className="text-text0">暂无引用</span>}</div>}
      <div className="mt-4 rounded-2xl border border-border bg-surface/60 p-3"><div className="mb-2 flex items-center gap-2"><span className="text-xs text-text-muted">本轮模型</span><select value={`${selectedProfileId}::${selectedModel}`} onChange={(event) => { const [profileId, ...modelParts] = event.target.value.split("::"); const model = modelParts.join("::"); setSelectedProfileId(profileId); setSelectedModel(model); }} className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2/80 px-2 py-1.5 text-xs text-text"><option value="::">未配置 AI</option>{profiles.filter((profile) => profile.enabled && profile.apiKeyConfigured).flatMap((profile) => profile.models.map((model) => <option key={`${profile.id}::${model}`} value={`${profile.id}::${model}`}>{profile.name} · {model}</option>))}</select></div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`想和${petName}聊什么？`} className="min-h-20 w-full resize-none bg-transparent text-sm outline-none" /><div className="mt-2 flex items-center justify-between"><label className="text-xs text-text-muted"><input checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} type="checkbox" className="mr-1" />本轮带相关笔记与待办</label><button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} className="rounded-full bg-primary/15 px-4 py-2 text-xs text-primary disabled:opacity-40">{sending ? `${petName}思考中...` : "发送"}</button></div>{error && <p className="mt-2 text-xs text-danger">{error}</p>}</div>
      {pickerOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-2xl"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-medium text-text">选择笔记和待办</h3><p className="mt-1 text-[11px] text-text-muted">系统推荐的内容会标记为“推荐”，点击或勾选后才会加入上下文。</p></div><button type="button" onClick={() => setPickerOpen(false)} className="text-text0 hover:text-text">×</button></div><input autoFocus value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="搜索笔记或待办" className="mb-3 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text outline-none focus:border-primary/50" /><div className="max-h-72 space-y-1 overflow-y-auto">{pickerResults.map((record) => { const checked = contextRecords.some((item) => item.id === record.id); const recommended = candidates.some((item) => item.id === record.id); return <label key={record.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 transition ${checked ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-primary/10"}`}><input type="checkbox" checked={checked} onChange={() => toggleContextRecord(record)} /><span className="min-w-0 flex-1"><span className={`block truncate text-xs ${checked ? "text-primary" : "text-text"}`}>{record.title || "未命名"}{checked && <span className="ml-1">✓</span>}</span><span className="block truncate text-[10px] text-text-muted">{record.type === "task" ? "待办" : "笔记"}{recommended ? " · 推荐" : ""}</span></span></label>; })}{!pickerResults.length && <p className="px-2 py-6 text-center text-xs text-text0">没有找到内容</p>}</div><div className="mt-4 flex justify-end"><button type="button" onClick={() => setPickerOpen(false)} className="rounded-full bg-primary/15 px-4 py-2 text-xs text-primary">完成（{contextRecords.length}）</button></div></div></div>}
    </section>
  </div>;
}
