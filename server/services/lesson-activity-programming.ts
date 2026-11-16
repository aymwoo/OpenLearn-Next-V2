/**
 * 学案编程活动（Gitee IKVO15）：Scratch / Python / 流程图 / 思维导图。
 *
 * 平台内置的是可扩展的最小可用实现：Python 源码编辑、流程图/思维导图 JSON 编辑，
 * 以及 Scratch 作品元数据提交。不内嵌 scratch.mit.edu，也不把未安装或未完成的
 * 第三方 Scratch 插件写成已具备完整课堂提交。
 */
import { LessonActivityError } from './lesson-activity-error.js';

export const PROGRAMMING_KINDS = ['scratch', 'python', 'flowchart', 'mindmap'] as const;
export type ProgrammingKind = (typeof PROGRAMMING_KINDS)[number];

export const DEFAULT_SCRATCH_PLUGIN_ID = '@openlearn-ext/scratch';
export const MAX_PROGRAMMING_PROMPT_CHARS = 20_000;
export const MAX_PROGRAMMING_CODE_CHARS = 100_000;
export const MAX_PROGRAMMING_ARTIFACT_CHARS = 200_000;
export const MAX_GRAPH_NODES = 200;

export interface FlowchartNode {
  id: string;
  type: 'start' | 'process' | 'decision' | 'end';
  label: string;
  x: number;
  y: number;
}

export interface FlowchartEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface FlowchartGraph {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

export interface MindmapNode {
  id: string;
  label: string;
  children: MindmapNode[];
}

export interface ProgrammingArtifact {
  kind: ProgrammingKind;
  code?: string;
  graph?: FlowchartGraph | MindmapNode;
  scratch?: {
    fileName?: string;
    note?: string;
    pluginProjectId?: string;
  };
  updatedAt: number;
  submittedAt?: number | null;
}

export function isProgrammingKind(value: unknown): value is ProgrammingKind {
  return typeof value === 'string' && (PROGRAMMING_KINDS as readonly string[]).includes(value);
}

export function normalizeProgrammingConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  const kind = out.kind;
  if (kind == null || kind === '') {
    delete out.kind;
  } else if (!isProgrammingKind(kind)) {
    throw new LessonActivityError(400, 'Unsupported programming kind');
  } else {
    out.kind = kind;
  }
  if (out.prompt != null) {
    if (typeof out.prompt !== 'string') throw new LessonActivityError(400, 'Programming prompt must be text');
    if (out.prompt.length > MAX_PROGRAMMING_PROMPT_CHARS) {
      throw new LessonActivityError(400, 'Programming prompt is too long');
    }
  }
  if (out.starterCode != null) {
    if (typeof out.starterCode !== 'string') throw new LessonActivityError(400, 'Starter code must be text');
    if (out.starterCode.length > MAX_PROGRAMMING_CODE_CHARS) {
      throw new LessonActivityError(400, 'Starter code is too long');
    }
  }
  if (out.starterGraph != null) {
    out.starterGraph = normalizeGraph(out.kind === 'mindmap' ? 'mindmap' : 'flowchart', out.starterGraph);
  }
  if (out.scratchPluginId != null) {
    if (typeof out.scratchPluginId !== 'string' || out.scratchPluginId.length > 200) {
      throw new LessonActivityError(400, 'Invalid Scratch plugin id');
    }
  }
  return out;
}

export function normalizeGraph(kind: 'flowchart' | 'mindmap', raw: unknown): FlowchartGraph | MindmapNode {
  if (kind === 'mindmap') return normalizeMindmap(raw);
  return normalizeFlowchart(raw);
}

function asLabel(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, 200);
}

function normalizeFlowchart(raw: unknown): FlowchartGraph {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const nodesRaw = Array.isArray(source.nodes) ? source.nodes : [];
  if (nodesRaw.length > MAX_GRAPH_NODES) {
    throw new LessonActivityError(400, 'Flowchart has too many nodes');
  }
  const nodes: FlowchartNode[] = [];
  const ids = new Set<string>();
  for (const item of nodesRaw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 64) : '';
    if (!id || ids.has(id)) continue;
    const type = rec.type === 'start' || rec.type === 'decision' || rec.type === 'end' ? rec.type : 'process';
    ids.add(id);
    nodes.push({
      id,
      type,
      label: asLabel(rec.label, type),
      x: Number.isFinite(Number(rec.x)) ? Number(rec.x) : 40 + nodes.length * 20,
      y: Number.isFinite(Number(rec.y)) ? Number(rec.y) : 40 + nodes.length * 60,
    });
  }
  const edgesRaw = Array.isArray(source.edges) ? source.edges : [];
  const edges: FlowchartEdge[] = [];
  const edgeIds = new Set<string>();
  for (const item of edgesRaw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const from = typeof rec.from === 'string' ? rec.from : '';
    const to = typeof rec.to === 'string' ? rec.to : '';
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const id =
      typeof rec.id === 'string' && rec.id.trim() && !edgeIds.has(rec.id.trim())
        ? rec.id.trim().slice(0, 64)
        : `e_${from}_${to}_${edges.length}`;
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    edges.push({
      id,
      from,
      to,
      label: rec.label ? asLabel(rec.label) : undefined,
    });
  }
  return { nodes, edges };
}

function normalizeMindmap(raw: unknown, depth = 0, seen = 0): MindmapNode {
  if (seen > MAX_GRAPH_NODES) throw new LessonActivityError(400, 'Mind map has too many nodes');
  if (depth > 12) throw new LessonActivityError(400, 'Mind map is too deep');
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const childrenRaw = Array.isArray(source.children) ? source.children : [];
  const node: MindmapNode = {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 64) : `mm_${depth}_${seen}`,
    label: asLabel(source.label, depth === 0 ? '中心主题' : '分支'),
    children: [],
  };
  let count = seen + 1;
  for (const child of childrenRaw) {
    if (count > MAX_GRAPH_NODES) throw new LessonActivityError(400, 'Mind map has too many nodes');
    const next = normalizeMindmap(child, depth + 1, count);
    count += countMindmap(next);
    node.children.push(next);
  }
  return node;
}

function countMindmap(node: MindmapNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countMindmap(child), 0);
}

export function normalizeProgrammingArtifact(
  kind: ProgrammingKind,
  raw: unknown,
  now = Date.now(),
): ProgrammingArtifact {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const artifact: ProgrammingArtifact = {
    kind,
    updatedAt: now,
  };
  if (kind === 'python') {
    const code = typeof source.code === 'string' ? source.code : '';
    if (code.length > MAX_PROGRAMMING_CODE_CHARS) {
      throw new LessonActivityError(400, 'Python source is too long');
    }
    artifact.code = code;
  } else if (kind === 'flowchart') {
    artifact.graph = normalizeFlowchart(source.graph ?? source);
  } else if (kind === 'mindmap') {
    artifact.graph = normalizeMindmap(source.graph ?? source);
  } else {
    const scratchRaw =
      source.scratch && typeof source.scratch === 'object' ? (source.scratch as Record<string, unknown>) : source;
    const fileName = typeof scratchRaw.fileName === 'string' ? scratchRaw.fileName.trim().slice(0, 200) : '';
    const note = typeof scratchRaw.note === 'string' ? scratchRaw.note.slice(0, 8000) : '';
    const pluginProjectId =
      typeof scratchRaw.pluginProjectId === 'string' ? scratchRaw.pluginProjectId.trim().slice(0, 200) : '';
    artifact.scratch = {
      ...(fileName ? { fileName } : {}),
      ...(note ? { note } : {}),
      ...(pluginProjectId ? { pluginProjectId } : {}),
    };
  }
  if (source.submittedAt != null && Number.isFinite(Number(source.submittedAt))) {
    artifact.submittedAt = Number(source.submittedAt);
  }
  const encoded = JSON.stringify(artifact);
  if (encoded.length > MAX_PROGRAMMING_ARTIFACT_CHARS) {
    throw new LessonActivityError(400, 'Programming artifact is too large');
  }
  return artifact;
}

export function hasSubmitableProgrammingArtifact(artifact: ProgrammingArtifact | null | undefined): boolean {
  if (!artifact) return false;
  if (artifact.kind === 'python') return Boolean(artifact.code && artifact.code.trim());
  if (artifact.kind === 'flowchart') {
    const graph = artifact.graph as FlowchartGraph | undefined;
    return Boolean(graph && graph.nodes.length > 0);
  }
  if (artifact.kind === 'mindmap') {
    const root = artifact.graph as MindmapNode | undefined;
    return Boolean(root && (root.label.trim() || root.children.length > 0));
  }
  const scratch = artifact.scratch;
  return Boolean(scratch && (scratch.fileName || scratch.note || scratch.pluginProjectId));
}

export function emptyMindmap(): MindmapNode {
  return { id: 'root', label: '中心主题', children: [] };
}

export function emptyFlowchart(): FlowchartGraph {
  return {
    nodes: [
      { id: 'start', type: 'start', label: '开始', x: 160, y: 24 },
      { id: 'step', type: 'process', label: '处理', x: 160, y: 120 },
      { id: 'end', type: 'end', label: '结束', x: 160, y: 216 },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'step' },
      { id: 'e2', from: 'step', to: 'end' },
    ],
  };
}
