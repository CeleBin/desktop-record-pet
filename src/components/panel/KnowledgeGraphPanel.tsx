import { useEffect, useMemo, useRef, useState } from "react";

import { listRecords } from "../../lib/tauri";
import { useSettingsStore } from "../../store/settings";
import type { KnowledgeGraphData, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphNodeStatus, KnowledgeGraphSuggestion, RecordWithRelations } from "../../types";

const GRAPH_SETTING_KEY = "knowledge_graph_data";
const NODE_RADIUS = 30;
const STATUS_META: Record<KnowledgeGraphNodeStatus, { label: string; color: string }> = {
  unseen: { label: "未接触", color: "#64748b" },
  recorded: { label: "已记录", color: "#38bdf8" },
  learning: { label: "学习中", color: "#fbbf24" },
  mastered: { label: "已掌握", color: "#34d399" },
  review: { label: "待复习", color: "#c084fc" },
};
const EDGE_LABELS: Record<KnowledgeGraphEdge["type"], string> = {
  broader: "包含",
  related: "相关",
  prerequisite: "前置",
  "applies-to": "应用于",
};

function seedGraph(): KnowledgeGraphData {
  const nodes: KnowledgeGraphNode[] = [
    ["python", "Python", "Python 语言与生态", null, 500, 110, "#fbbf24"],
    ["basics", "基础语法", "变量、表达式和控制流", "python", 280, 260, "#38bdf8"],
    ["data", "数据结构", "Python 内置数据结构", "python", 500, 260, "#38bdf8"],
    ["functions", "函数", "定义、参数、作用域与装饰器", "python", 720, 260, "#38bdf8"],
    ["list", "list", "有序可变序列", "data", 390, 430, "#60a5fa"],
    ["dict", "dict", "键值映射结构", "data", 560, 430, "#60a5fa"],
    ["set", "set", "无序不重复集合", "data", 730, 430, "#60a5fa"],
    ["async", "异步编程", "async / await 与事件循环", "python", 860, 430, "#c084fc"],
  ].map(([id, label, description, parentId, x, y, color]) => ({
    id: String(id), label: String(label), description: String(description), parentId: parentId ? String(parentId) : null,
    status: id === "python" ? "recorded" : "unseen", x: Number(x), y: Number(y), color: String(color), officialUrl: id === "python" ? "https://docs.python.org/3/" : id === "data" ? "https://docs.python.org/3/tutorial/datastructures.html" : id === "async" ? "https://docs.python.org/3/library/asyncio.html" : null, userCreated: false, linkedRecordIds: [],
  }));
  const edges: KnowledgeGraphEdge[] = [
    ["python-basics", "python", "basics", "broader"], ["python-data", "python", "data", "broader"], ["python-functions", "python", "functions", "broader"],
    ["data-list", "data", "list", "broader"], ["data-dict", "data", "dict", "broader"], ["data-set", "data", "set", "broader"],
    ["python-async", "python", "async", "broader"], ["dict-json", "dict", "async", "related"],
  ].map(([id, source, target, type]) => ({ id, source, target, type } as KnowledgeGraphEdge));
  return { format: "desktop-record-pet-knowledge-graph", version: 1, schemeId: "personal", schemeName: "个人知识库", nodes, edges, suggestions: [] };
}

function parseGraph(raw?: string): KnowledgeGraphData {
  if (!raw) return seedGraph();
  try {
    const parsed = JSON.parse(raw) as KnowledgeGraphData;
    if (parsed?.format === "desktop-record-pet-knowledge-graph" && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed.schemeName === "Python 知识地图" ? { ...parsed, schemeName: "个人知识库" } : parsed;
    }
  } catch { /* fall back to the starter graph */ }
  return seedGraph();
}

function downloadJson(filename: string, content: unknown) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/ld+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function toJsonLd(graph: KnowledgeGraphData) {
  return {
    format: graph.format,
    version: graph.version,
    schemeId: graph.schemeId,
    schemeName: graph.schemeName,
    "@context": { "@vocab": "https://desktop-record-pet.local/knowledge#", broader: "skos:broader", related: "skos:related", prerequisite: "drp:prerequisite" },
    "@type": "skos:ConceptScheme",
    concepts: graph.nodes.map((node) => ({ "@id": `drp:${node.id}`, "@type": "skos:Concept", id: node.id, prefLabel: node.label, definition: node.description, parentId: node.parentId, status: node.status, x: node.x, y: node.y, color: node.color, officialUrl: node.officialUrl, userCreated: node.userCreated, linkedRecordIds: node.linkedRecordIds })),
    relations: graph.edges.map((edge) => ({ "@id": `drp:relation/${edge.id}`, id: edge.id, source: `drp:${edge.source}`, target: `drp:${edge.target}`, type: edge.type })),
    suggestions: graph.suggestions ?? [],
  };
}

function parseLearningPoints(raw: string | null): Array<{ name: string; confidence: number; example: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { knowledge_points?: Array<{ name?: unknown; confidence?: unknown; example_from_note?: unknown }> };
    if (!Array.isArray(parsed.knowledge_points)) return [];
    return parsed.knowledge_points.flatMap((point) => {
      if (typeof point.name !== "string" || !point.name.trim()) return [];
      return [{ name: point.name.trim(), confidence: typeof point.confidence === "number" ? point.confidence : 0.5, example: typeof point.example_from_note === "string" ? point.example_from_note : "" }];
    });
  } catch {
    return [];
  }
}

function buildSuggestions(graph: KnowledgeGraphData, records: RecordWithRelations[]): KnowledgeGraphSuggestion[] {
  const saved = graph.suggestions ?? [];
  const savedIds = new Set(saved.map((item) => item.id));
  const generated: KnowledgeGraphSuggestion[] = [];
  for (const record of records) {
    const latest = record.ai_results?.[record.ai_results.length - 1];
    for (const point of parseLearningPoints(latest?.research_result ?? null)) {
      const matchingNode = graph.nodes.find((node) => node.label.trim().toLocaleLowerCase() === point.name.toLocaleLowerCase());
      const type = matchingNode ? "link-record" : "create-node";
      const id = `suggestion-${type}-${record.id}-${point.name.toLocaleLowerCase()}`;
      if (savedIds.has(id) || (matchingNode && matchingNode.linkedRecordIds.includes(record.id))) continue;
      generated.push({
        id,
        type,
        state: "pending",
        recordId: record.id,
        recordTitle: record.title,
        sourceNodeId: matchingNode?.id ?? null,
        suggestedLabel: point.name,
        suggestedDescription: point.example || `来自“${record.title || "未命名记录"}”的知识点`,
        suggestedStatus: matchingNode?.status === "unseen" ? "recorded" : null,
        reason: matchingNode ? `AI 分析认为这条记录涉及“${matchingNode.label}”` : "AI 分析发现了图谱中尚未收录的知识点",
        confidence: Math.max(0, Math.min(1, point.confidence)),
        createdAt: new Date().toISOString(),
      });
    }
  }
  return [...saved.filter((item) => item.state === "pending"), ...generated];
}

export function KnowledgeGraphPanel({ onOpenRecord, initialNodeId }: { onOpenRecord: (recordId: string, nodeId: string) => void; initialNodeId?: string | null }) {
  const settings = useSettingsStore((state) => state.settings);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const [graph, setGraph] = useState<KnowledgeGraphData>(() => parseGraph(settings[GRAPH_SETTING_KEY]));
  const [selectedId, setSelectedId] = useState(initialNodeId || "python");
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [records, setRecords] = useState<RecordWithRelations[]>([]);
  const [recordQuery, setRecordQuery] = useState("");
  const [relationType, setRelationType] = useState<KnowledgeGraphEdge["type"]>("related");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [pointerPoint, setPointerPoint] = useState<{ x: number; y: number } | null>(null);
  const [relationMenu, setRelationMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const next = parseGraph(settings[GRAPH_SETTING_KEY]);
    setGraph(next);
    if (!next.nodes.some((node) => node.id === selectedId)) setSelectedId(next.nodes[0]?.id ?? "");
  }, [settings[GRAPH_SETTING_KEY]]);

  useEffect(() => {
    void listRecords({ limit: 100 }).then(setRecords).catch(() => setRecords([]));
  }, []);

  const persist = (next: KnowledgeGraphData) => {
    setGraph(next);
    void setSetting(GRAPH_SETTING_KEY, JSON.stringify(next));
  };
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const visibleNodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? graph.nodes.filter((node) => `${node.label} ${node.description}`.toLowerCase().includes(query)) : graph.nodes;
  }, [graph.nodes, search]);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const linkedRecords = selected ? selected.linkedRecordIds.map((id) => records.find((record) => record.id === id)).filter((record): record is RecordWithRelations => Boolean(record && record.type !== "task")) : [];
  const noteRecords = useMemo(() => records.filter((record) => record.type !== "task"), [records]);
  const filteredNotes = useMemo(() => noteRecords.filter((record) => `${record.title ?? ""} ${record.content ?? ""}`.toLowerCase().includes(recordQuery.toLowerCase())).slice(0, 8), [noteRecords, recordQuery]);
  const suggestions = useMemo(() => buildSuggestions(graph, noteRecords), [graph, noteRecords]);
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const updateSelected = (patch: Partial<KnowledgeGraphNode>) => {
    if (!selected) return;
    persist({ ...graph, nodes: graph.nodes.map((node) => node.id === selected.id ? { ...node, ...patch } : node) });
  };
  const addNode = () => {
    const id = `custom-${Date.now()}`;
    const node: KnowledgeGraphNode = { id, label: "新知识点", description: "补充你的理解、例子或学习目标", parentId: selected?.id ?? null, status: "unseen", x: 520, y: 540, color: "#f472b6", officialUrl: null, userCreated: true, linkedRecordIds: [] };
    persist({ ...graph, nodes: [...graph.nodes, node] }); setSelectedId(id); setMessage("已创建自定义知识点");
  };
  const deleteSelected = () => {
    if (!selected || !window.confirm(`确定删除“${selected.label}”吗？关联笔记不会被删除。`)) return;
    persist({ ...graph, nodes: graph.nodes.filter((node) => node.id !== selected.id), edges: graph.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id) });
    setSelectedId(graph.nodes.find((node) => node.id !== selected.id)?.id ?? "");
  };
  const handleNodeClick = (id: string) => {
    setSelectedEdgeId(null);
    if (linkFrom && linkFrom !== id) {
      const exists = graph.edges.some((edge) => edge.source === linkFrom && edge.target === id && edge.type === relationType);
      if (!exists) persist({ ...graph, edges: [...graph.edges, { id: `edge-${Date.now()}`, source: linkFrom, target: id, type: relationType }] });
      setLinkFrom(null); setPointerPoint(null); setMessage("已建立知识关系");
    }
    setSelectedId(id);
  };
  const toggleRecord = (recordId: string) => updateSelected({ linkedRecordIds: selected?.linkedRecordIds.includes(recordId) ? selected.linkedRecordIds.filter((id) => id !== recordId) : [...(selected?.linkedRecordIds ?? []), recordId] });
  const ignoreSuggestion = (suggestion: KnowledgeGraphSuggestion) => {
    const saved = graph.suggestions ?? [];
    persist({ ...graph, suggestions: [...saved.filter((item) => item.id !== suggestion.id), { ...suggestion, state: "ignored" }] });
    setMessage("已忽略这条知识库建议");
  };
  const acceptSuggestion = (suggestion: KnowledgeGraphSuggestion) => {
    const record = records.find((item) => item.id === suggestion.recordId);
    if (!record) return;
    let nextNodes = graph.nodes;
    let nodeId = suggestion.sourceNodeId;
    if (suggestion.type === "create-node") {
      nodeId = `custom-${Date.now()}`;
      nextNodes = [...graph.nodes, { id: nodeId, label: suggestion.suggestedLabel, description: suggestion.suggestedDescription, parentId: null, status: "recorded", x: 500 + (graph.nodes.length % 3) * 150, y: 180 + (graph.nodes.length % 4) * 120, color: "#f472b6", officialUrl: null, userCreated: true, linkedRecordIds: [record.id] }];
    } else if (nodeId) {
      nextNodes = graph.nodes.map((node) => node.id === nodeId ? { ...node, linkedRecordIds: node.linkedRecordIds.includes(record.id) ? node.linkedRecordIds : [...node.linkedRecordIds, record.id], status: suggestion.suggestedStatus ?? node.status } : node);
    }
    persist({ ...graph, nodes: nextNodes, suggestions: (graph.suggestions ?? []).filter((item) => item.id !== suggestion.id) });
    if (nodeId) setSelectedId(nodeId);
    setMessage(suggestion.type === "create-node" ? "已创建知识点并关联记录" : "已关联记录到知识点");
  };
  const resetView = () => { setZoom(0.9); setPan({ x: 0, y: 0 }); };
  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => { panRef.current = { x: pan.x, y: pan.y, startX: event.clientX, startY: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); };
  const handleCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const canvasX = (event.clientX - rect.left) / rect.width * 1000;
      const canvasY = (event.clientY - rect.top) / rect.height * 700;
      const next = { ...graph, nodes: graph.nodes.map((node) => node.id === dragRef.current!.id ? { ...node, x: (canvasX - pan.x) / zoom - dragRef.current!.dx, y: (canvasY - pan.y) / zoom - dragRef.current!.dy } : node) };
      setGraph(next); return;
    }
    if (panRef.current) setPan({ x: panRef.current.x + event.clientX - panRef.current.startX, y: panRef.current.y + event.clientY - panRef.current.startY });
  };
  const stopCanvasDrag = () => { if (dragRef.current) void setSetting(GRAPH_SETTING_KEY, JSON.stringify(graph)); dragRef.current = null; panRef.current = null; };
  const getCanvasPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * 1000, y: (event.clientY - rect.top) / rect.height * 700 };
  };
  const openRelationMenu = (event: React.MouseEvent<SVGGElement>, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    const canvas = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!canvas) return;
    setRelationMenu({ x: event.clientX - canvas.left, y: event.clientY - canvas.top, nodeId });
    setPointerPoint(null);
  };
  const beginRelation = (type: KnowledgeGraphEdge["type"]) => {
    if (!relationMenu) return;
    setRelationType(type);
    setSelectedEdgeId(null);
    setLinkFrom(relationMenu.nodeId);
    setSelectedId(relationMenu.nodeId);
    setRelationMenu(null);
    setMessage("请选择目标节点完成连接");
  };
  const updateSelectedEdge = (type: KnowledgeGraphEdge["type"]) => {
    if (!selectedEdge) return;
    persist({ ...graph, edges: graph.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, type } : edge) });
    setRelationType(type);
    setMessage("已更新关系类型");
  };
  const deleteSelectedEdge = () => {
    if (!selectedEdge) return;
    const source = graph.nodes.find((node) => node.id === selectedEdge.source)?.label ?? "当前节点";
    const target = graph.nodes.find((node) => node.id === selectedEdge.target)?.label ?? "目标节点";
    if (!window.confirm(`确定删除“${source}”与“${target}”之间的关系吗？`)) return;
    persist({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdge.id) });
    setSelectedEdgeId(null);
    setMessage("已删除知识关系");
  };
  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarResizeRef.current) return;
    const nextWidth = sidebarResizeRef.current.startWidth + sidebarResizeRef.current.startX - event.clientX;
    setSidebarWidth(Math.min(480, Math.max(248, nextWidth)));
  };
  const stopSidebarResize = () => { sidebarResizeRef.current = null; };

  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
      <div className="mr-auto"><p className="text-[11px] uppercase tracking-[0.2em] text-text0">个人知识库</p><h2 className="mt-1 text-lg font-semibold text-text">知识图谱</h2></div>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索知识点" className="w-36 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary/50" />
      <button type="button" onClick={addNode} className="rounded-lg bg-primary/15 px-2.5 py-1.5 text-xs text-primary">＋知识点</button>
      <button type="button" onClick={() => downloadJson("knowledge-graph.jsonld", toJsonLd(graph))} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-muted hover:text-text">导出</button>
      <button type="button" onClick={() => setMessage(suggestions.length ? `发现 ${suggestions.length} 条待确认建议` : "暂无新的知识库建议")} className={`rounded-lg px-2.5 py-1.5 text-xs ${suggestions.length ? "bg-secondary/15 text-secondary" : "border border-border text-text-muted"}`}>建议箱{suggestions.length ? ` ${suggestions.length}` : ""}</button>
      <label className="cursor-pointer rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-muted hover:text-text">导入<input type="file" accept=".json,.jsonld" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((raw) => { const imported = parseGraph(raw); persist(imported); setSelectedId(imported.nodes[0]?.id ?? ""); setMessage("已导入知识图谱"); }); }} /></label>
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1 bg-white">
        <div className="absolute left-5 top-5 z-10 max-w-xs rounded-xl border border-border bg-surface/90 px-3 py-2 text-[11px] leading-5 text-text-muted shadow-lg shadow-black/5 backdrop-blur"><span className="text-text-strong">探索你的知识网络</span><br />拖拽节点移动，滚轮缩放；选择节点后可编辑详情。</div>
        <div className="absolute bottom-3 left-3 z-10 flex gap-1.5 rounded-xl border border-border bg-surface/85 p-1 shadow-lg shadow-black/5 backdrop-blur"><button type="button" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))} className="rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text">＋</button><button type="button" onClick={() => setZoom((value) => Math.max(0.45, value - 0.1))} className="rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text">－</button><button type="button" onClick={resetView} className="rounded-lg px-2 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text">重置</button></div>
        <svg className="h-full w-full touch-none" onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(0.45, Math.min(1.8, value - event.deltaY * 0.001))); }} onPointerDown={handleCanvasPointerDown} onPointerMove={(event) => { handleCanvasPointerMove(event); if (linkFrom) setPointerPoint(getCanvasPoint(event)); }} onPointerUp={stopCanvasDrag} onPointerLeave={() => { stopCanvasDrag(); if (linkFrom) setPointerPoint(null); }} onClick={() => { setSelectedEdgeId(null); if (relationMenu) setRelationMenu(null); }} viewBox="0 0 1000 700">
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            <defs><pattern id="graph-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#e5e7eb" strokeOpacity=".8" /></pattern></defs><rect x="-1000" y="-700" width="3000" height="2100" fill="url(#graph-grid)" />
            {visibleEdges.map((edge) => { const source = graph.nodes.find((node) => node.id === edge.source); const target = graph.nodes.find((node) => node.id === edge.target); if (!source || !target) return null; const active = selectedEdgeId === edge.id; return <g key={edge.id} className="cursor-pointer" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedId(edge.source); setRelationType(edge.type); setRelationMenu(null); setMessage(""); }}><line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={active ? "#d97706" : edge.type === "broader" ? "#94a3b8" : "#8b5cf6"} strokeOpacity={active ? "1" : ".7"} strokeWidth={active ? "3.5" : "2"} strokeDasharray={edge.type === "related" ? "5 5" : undefined} /><line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="transparent" strokeWidth="14" /><text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 6} textAnchor="middle" fill={active ? "#b45309" : "#64748b"} fontSize="10">{EDGE_LABELS[edge.type]}</text></g>; })}
            {linkFrom && pointerPoint && (() => { const source = graph.nodes.find((node) => node.id === linkFrom); return source ? <line x1={source.x} y1={source.y} x2={(pointerPoint.x - pan.x) / zoom} y2={(pointerPoint.y - pan.y) / zoom} stroke="#d97706" strokeOpacity=".9" strokeWidth="2.5" strokeDasharray="7 5" /> : null; })()}
            {visibleNodes.map((node) => { const meta = STATUS_META[node.status]; const active = selectedId === node.id; const linking = linkFrom === node.id; return <g key={node.id} transform={`translate(${node.x} ${node.y})`} onPointerDown={(event) => { event.stopPropagation(); const svg = event.currentTarget.ownerSVGElement; if (!svg) return; const rect = svg.getBoundingClientRect(); const canvasX = (event.clientX - rect.left) / rect.width * 1000; const canvasY = (event.clientY - rect.top) / rect.height * 700; dragRef.current = { id: node.id, dx: (canvasX - pan.x) / zoom - node.x, dy: (canvasY - pan.y) / zoom - node.y }; }} onClick={(event) => { event.stopPropagation(); handleNodeClick(node.id); }} onContextMenu={(event) => openRelationMenu(event, node.id)} className={`cursor-pointer ${linking ? "opacity-80" : ""}`}><circle r={NODE_RADIUS + (active ? 7 : 0)} fill={meta.color} fillOpacity={active ? ".2" : ".08"} stroke={active ? meta.color : "transparent"} strokeWidth="2" /><circle r={NODE_RADIUS} fill="#f8fafc" stroke={linking ? "#d97706" : meta.color} strokeWidth={linking ? "3" : node.userCreated ? "3" : "2"} strokeDasharray={node.userCreated ? "4 3" : undefined} /><text y="4" textAnchor="middle" fill="#1f2937" fontSize="12" fontWeight="600">{node.label.length > 8 ? `${node.label.slice(0, 8)}…` : node.label}</text><circle cx="20" cy="-20" r="5" fill={meta.color} /></g>; })}
          </g>
        </svg>
        {relationMenu && <div className="absolute z-30 w-36 rounded-xl border border-border bg-surface p-1.5 shadow-xl" style={{ left: Math.min(relationMenu.x, 560), top: Math.min(relationMenu.y, 560) }} onClick={(event) => event.stopPropagation()}><p className="px-2 py-1 text-[10px] text-text0">连接到另一个节点</p>{Object.entries(EDGE_LABELS).map(([value, label]) => <button key={value} type="button" onClick={() => beginRelation(value as KnowledgeGraphEdge["type"])} className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-text-muted hover:bg-primary/10 hover:text-primary">{label}</button>)}</div>}
      </div>
      <div className="relative shrink-0" style={{ width: sidebarWidth }}>
        <div role="separator" aria-label="调整知识图谱侧栏宽度" aria-orientation="vertical" onPointerDown={startSidebarResize} onPointerMove={resizeSidebar} onPointerUp={stopSidebarResize} onPointerCancel={stopSidebarResize} className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-primary/30" />
      <aside className="h-full w-full overflow-y-auto border-l border-border bg-surface/70 p-5 shadow-[-12px_0_30px_rgba(0,0,0,0.08)]">
        {!selectedEdge && message && <p className="mb-3 rounded-lg bg-secondary/10 px-2.5 py-2 text-xs text-secondary">{message}</p>}
        {!selectedEdge && suggestions.length > 0 && <section className="mb-4 rounded-xl border border-secondary/25 bg-secondary/[4%] p-3">
          <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-medium text-text">知识库建议</p><p className="mt-1 text-[10px] leading-4 text-text0">来自已有 AI 分析，确认后才会修改图谱</p></div><span className="rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] text-secondary">{suggestions.length}</span></div>
          <div className="mt-3 space-y-2">{suggestions.slice(0, 6).map((suggestion) => <article key={suggestion.id} className="rounded-lg border border-border bg-surface/60 p-2.5">
            <p className="text-[11px] font-medium text-text">{suggestion.type === "create-node" ? "创建知识点" : "关联已有知识点"} · {suggestion.suggestedLabel}</p>
            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-muted">{suggestion.reason}</p>
            <p className="mt-1 truncate text-[10px] text-text0">来源：{suggestion.recordTitle || "未命名记录"} · 置信度 {Math.round(suggestion.confidence * 100)}%</p>
            <div className="mt-2 flex items-center gap-2"><button type="button" onClick={() => acceptSuggestion(suggestion)} className="rounded-md bg-primary/15 px-2 py-1 text-[10px] text-primary">接受</button><button type="button" onClick={() => ignoreSuggestion(suggestion)} className="rounded-md px-2 py-1 text-[10px] text-text0 hover:bg-white/5">忽略</button><button type="button" onClick={() => onOpenRecord(suggestion.recordId, suggestion.sourceNodeId ?? selectedId)} className="ml-auto text-[10px] text-secondary">查看记录</button></div>
          </article>)}</div>
          {suggestions.length > 6 && <p className="mt-2 text-center text-[10px] text-text0">还有 {suggestions.length - 6} 条建议</p>}
        </section>}
        {selectedEdge ? <section className="mt-2 rounded-xl border border-primary/25 bg-primary/[4%] p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-text">当前关系</p><button type="button" onClick={deleteSelectedEdge} className="text-[10px] text-text0 hover:text-danger">删除关系</button></div><p className="mt-2 truncate text-[11px] text-text-muted">{graph.nodes.find((node) => node.id === selectedEdge.source)?.label ?? "未知节点"}<span className="mx-1.5 text-text0">→</span>{graph.nodes.find((node) => node.id === selectedEdge.target)?.label ?? "未知节点"}</p><label className="mt-2 block text-[10px] text-text-muted">关系类型<select value={selectedEdge.type} onChange={(event) => updateSelectedEdge(event.target.value as KnowledgeGraphEdge["type"])} className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text">{Object.entries(EDGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></section> : !selected ? <p className="text-sm text-text-muted">选择一个知识点开始浏览。</p> : <>
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><input value={selected.label} onChange={(event) => updateSelected({ label: event.target.value })} className="w-full bg-transparent text-lg font-semibold text-text outline-none" /><p className="mt-1 text-[11px] text-text0">{selected.userCreated ? "用户创建" : "官方知识骨架"}</p></div><button type="button" onClick={deleteSelected} className="text-xs text-text0 hover:text-danger">删除</button></div>
          <textarea value={selected.description} onChange={(event) => updateSelected({ description: event.target.value })} className="mt-4 min-h-24 w-full rounded-xl border border-border bg-surface-2/60 p-3 text-xs leading-5 text-text outline-none focus:border-primary/50" />
          <label className="mt-3 block text-[11px] text-text-muted">学习状态<select value={selected.status} onChange={(event) => updateSelected({ status: event.target.value as KnowledgeGraphNodeStatus })} className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-2 text-xs text-text">{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
          {linkFrom && <button type="button" onClick={() => { setLinkFrom(null); setPointerPoint(null); setMessage(""); }} className="mt-4 w-full rounded-lg border border-border px-3 py-2 text-[11px] text-text-muted hover:border-danger/40 hover:text-danger">取消连接</button>}
          <div className="mt-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-text">关联笔记</p><span className="text-[10px] text-text0">{linkedRecords.length} 条</span></div><div className="mt-2 space-y-1.5">{linkedRecords.map((record) => <div key={record.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2"><span className="min-w-0 flex-1 truncate text-[11px] text-text">{record.title || "未命名笔记"}</span><button type="button" onClick={() => onOpenRecord(record.id, selected.id)} className="shrink-0 text-[10px] text-primary hover:text-primary/80">打开</button><button type="button" onClick={() => toggleRecord(record.id)} className="shrink-0 text-[10px] text-text0 hover:text-danger">移除</button></div>)}{!linkedRecords.length && <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[11px] text-text0">暂无关联笔记</p>}</div></div>
          <div className="mt-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-text">添加关联笔记</p><span className="text-[10px] text-text0">仅笔记</span></div><input value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} placeholder="搜索笔记" className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text outline-none focus:border-primary/50" /><div className="mt-2 space-y-1">{filteredNotes.map((record) => { const checked = selected.linkedRecordIds.includes(record.id); return <label key={record.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 ${checked ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-surface-2/60"}`}><input type="checkbox" checked={checked} onChange={() => toggleRecord(record.id)} /><span className={`min-w-0 truncate text-[11px] ${checked ? "text-primary" : "text-text-muted"}`}>{record.title || "未命名笔记"}</span></label>; })}{!filteredNotes.length && <p className="px-2 py-2 text-[11px] text-text0">没有找到笔记</p>}</div></div>
        </>}
      </aside>
      </div>
    </div>
  </div>;
}
