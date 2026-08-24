import { useEffect, useMemo, useState } from "react";
import { clearAiProfileApiKey, createAiProfile, deleteAiProfile, listAiProfiles, setAiProfileApiKey, updateAiProfile } from "../../lib/tauri";
import type { AiProfile } from "../../types";

type Draft = { name: string; provider: string; baseUrl: string; defaultModel: string; modelsText: string; enabled: boolean };
type ProviderPreset = { label: string; value: string; protocol: string; baseUrl: string; models: string[]; needsBaseUrl: boolean };
const PROVIDERS: ProviderPreset[] = [
  { label: "Claude", value: "claude", protocol: "Anthropic Messages", baseUrl: "https://api.anthropic.com/v1", models: ["claude-sonnet-4-20250514", "claude-haiku-4-20250514"], needsBaseUrl: false },
  { label: "OpenAI", value: "openai", protocol: "OpenAI Chat Completions", baseUrl: "https://api.openai.com/v1", models: ["gpt-4.1", "gpt-4o"], needsBaseUrl: false },
  { label: "DeepSeek", value: "deepseek", protocol: "OpenAI-compatible", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], needsBaseUrl: false },
  { label: "OpenCode Zen", value: "opencode", protocol: "OpenAI-compatible", baseUrl: "https://opencode.ai/zen/v1", models: ["big-pickle", "gpt-5-nano"], needsBaseUrl: false },
  { label: "自定义 OpenAI-compatible", value: "custom-openai", protocol: "OpenAI-compatible", baseUrl: "", models: [], needsBaseUrl: true },
  { label: "Ollama", value: "ollama", protocol: "OpenAI-compatible", baseUrl: "http://127.0.0.1:11434/v1", models: [], needsBaseUrl: false },
];
const emptyDraft: Draft = { name: "", provider: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1", modelsText: "gpt-4.1\ngpt-4o", enabled: true };
const toDraft = (p: AiProfile): Draft => ({ name: p.name, provider: p.provider, baseUrl: p.baseUrl ?? "", defaultModel: p.defaultModel, modelsText: p.models.join("\n"), enabled: p.enabled });
const modelsFromDraft = (d: Draft) => d.modelsText.split(/\r?\n|,/).map((m) => m.trim()).filter(Boolean);

export function AiProfilesPanel({ defaultProfileId, onDefaultProfileChange, onSuccess }: { defaultProfileId: string; onDefaultProfileChange: (id: string) => void; onSuccess: (message: string) => void }) {
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId]);

  const reload = async (selectId?: string | null) => {
    const next = await listAiProfiles(); setProfiles(next);
    const id = selectId === undefined ? selectedId : selectId; setSelectedId(id);
    const profile = next.find((p) => p.id === id); setDraft(profile ? toDraft(profile) : emptyDraft); setApiKey("");
  };
  useEffect(() => { void reload().catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);
  const startNew = () => { setSelectedId(null); setDraft(emptyDraft); setApiKey(""); setError(null); setDialogOpen(true); };
  const selectProfile = (p: AiProfile) => { setSelectedId(p.id); setDraft(toDraft(p)); setApiKey(""); setError(null); setDialogOpen(true); };
  const chooseProvider = (provider: string) => {
    const preset = PROVIDERS.find((item) => item.value === provider);
    if (!preset) return setDraft({ ...draft, provider });
    setDraft({ ...draft, provider, baseUrl: preset.baseUrl, modelsText: preset.models.join("\n"), defaultModel: preset.models[0] ?? "" });
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const models = modelsFromDraft(draft);
      const request = { name: draft.name.trim(), provider: draft.provider, baseUrl: draft.baseUrl.trim() || null, defaultModel: draft.defaultModel.trim() || models[0] || "", models, enabled: draft.enabled };
      if (!request.name || !request.defaultModel) throw new Error("请填写配置名称和至少一个模型");
      if (selectedId) { await updateAiProfile(selectedId, request); if (apiKey.trim()) await setAiProfileApiKey(selectedId, apiKey.trim()); onSuccess("AI 配置已保存"); await reload(selectedId); }
      else { const created = await createAiProfile(request, apiKey.trim() || undefined); onSuccess("AI 配置已创建"); await reload(created.id); }
      setDialogOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected || !window.confirm(`删除配置“${selected.name}”？`)) return;
    try { await deleteAiProfile(selected.id); if (defaultProfileId === selected.id) onDefaultProfileChange(""); onSuccess("AI 配置已删除"); await reload(null); setDialogOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return <div className="space-y-3 p-3">
    <div className="flex items-center justify-between gap-2"><p className="text-xs text-text-muted">已配置的模型会出现在聊天窗口中，可按本轮对话自由选择。</p><button type="button" onClick={startNew} className="shrink-0 rounded-full bg-primary/15 px-3 py-1.5 text-xs text-primary">+ 新配置</button></div>
    <div className="space-y-2">
      {profiles.map((p) => <button key={p.id} type="button" onClick={() => selectProfile(p)} className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2/30 px-3.5 py-3 text-left transition hover:border-primary/30 hover:bg-primary/5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75h4.5m-6.75 3h9m-10.5 0A2.25 2.25 0 003.75 9v9.75A2.25 2.25 0 006 21h12a2.25 2.25 0 002.25-2.25V9A2.25 2.25 0 0015.75 6.75m-9.75 0V5.25A1.5 1.5 0 017.5 3.75h9a1.5 1.5 0 011.5 1.5v1.5" /></svg></span>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium text-text">{p.name}</span>{defaultProfileId === p.id && <span className="rounded-full bg-secondary/10 px-1.5 py-0.5 text-[10px] text-secondary">默认</span>}</span><span className="mt-0.5 block truncate text-[11px] text-text-muted">{PROVIDERS.find((x) => x.value === p.provider)?.label ?? p.provider} · {p.models.length} 个模型</span></span>
        <span className={`shrink-0 text-[11px] ${p.apiKeyConfigured ? "text-secondary" : "text-text0"}`}>{p.apiKeyConfigured ? "已就绪" : "待配置密钥"}</span><svg className="h-4 w-4 shrink-0 text-text0 transition group-hover:translate-x-0.5 group-hover:text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>)}
      {profiles.length === 0 && <button type="button" onClick={startNew} className="flex w-full flex-col items-center rounded-xl border border-dashed border-border px-4 py-6 text-center transition hover:border-primary/40 hover:bg-primary/5"><span className="text-sm text-text-muted">还没有 AI 配置</span><span className="mt-1 text-[11px] text-text0">点击“新配置”添加你的第一个模型</span></button>}
    </div>

    {dialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={selected ? "编辑 AI 配置" : "新建 AI 配置"} onMouseDown={(e) => { if (e.target === e.currentTarget) setDialogOpen(false); }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-2xl shadow-black/30">
        <div className="mb-3 flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium text-text">{selected ? "编辑 AI 配置" : "新建 AI 配置"}</h3><p className="mt-1 text-[11px] text-text-muted">配置名称只用于区分账号，聊天时可以单独选择模型。</p></div><button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg p-1 text-text0 transition hover:bg-white/10 hover:text-text" aria-label="关闭"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></div>
        <div className="max-h-[min(70vh,520px)] space-y-2 overflow-y-auto pr-1">
          <label className="block text-xs text-text-muted">配置名称<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-surface-2/80 px-3 py-2 text-xs text-text" placeholder="例如：OpenAI 工作账号" /></label>
          <label className="block text-xs text-text-muted">Provider<select value={draft.provider} onChange={(e) => chooseProvider(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface-2/80 px-3 py-2 text-xs text-text">{PROVIDERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
          <p className="rounded-lg bg-primary/5 px-3 py-2 text-[11px] text-text-muted">协议：{PROVIDERS.find((x) => x.value === draft.provider)?.protocol ?? "自定义协议"}。预置 Provider 会自动带出模型和地址。</p>
          <label className="block text-xs text-text-muted">API 密钥{selected?.apiKeyConfigured && <span className="ml-2 text-secondary">已保存，留空保持不变</span>}<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface-2/80 px-3 py-2 text-xs text-text" placeholder="输入新密钥" /></label>
          <details className="rounded-lg border border-border bg-surface-2/30 px-3 py-2"><summary className="cursor-pointer text-xs text-text-muted">高级设置</summary><div className="mt-2 space-y-2"><label className="block text-xs text-text-muted">Base URL{PROVIDERS.find((x) => x.value === draft.provider)?.needsBaseUrl ? "" : "（可覆盖默认值）"}<input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-surface-2/80 px-3 py-2 text-xs text-text" placeholder="https://api.example.com/v1" /></label><label className="block text-xs text-text-muted">模型列表（一行一个）<textarea value={draft.modelsText} onChange={(e) => setDraft({ ...draft, modelsText: e.target.value })} className="mt-1 min-h-16 w-full rounded-lg border border-border bg-surface-2/80 px-3 py-2 text-xs text-text" placeholder="model-a\nmodel-b" /></label><label className="block text-xs text-text-muted">默认模型<input value={draft.defaultModel} onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-surface-2/80 px-3 py-2 text-xs text-text" placeholder="model-a" /></label></div></details>
          <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />在聊天模型列表中启用</label>{error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">{selected ? <button type="button" onClick={() => void remove()} className="text-xs text-danger">删除配置</button> : <span />}<div className="flex gap-2">{selected?.apiKeyConfigured && <button type="button" onClick={() => void clearAiProfileApiKey(selected.id).then(() => { onSuccess("API 密钥已清除"); return reload(selected.id); })} className="rounded-full border border-border px-3 py-1.5 text-xs text-text-muted">清除密钥</button>}{selected && <button type="button" onClick={() => onDefaultProfileChange(selected.id)} className={`rounded-full border px-3 py-1.5 text-xs ${defaultProfileId === selected.id ? "border-secondary/50 text-secondary" : "border-border text-text-muted"}`}>{defaultProfileId === selected.id ? "默认配置" : "设为默认"}</button>}<button type="button" onClick={() => void save()} disabled={saving} className="rounded-full bg-primary/15 px-3 py-1.5 text-xs text-primary disabled:opacity-50">{saving ? "保存中…" : "保存配置"}</button></div></div>
      </div>
    </div>}
  </div>;
}
