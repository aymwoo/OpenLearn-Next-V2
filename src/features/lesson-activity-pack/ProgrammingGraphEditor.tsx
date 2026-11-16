import { useMemo } from 'react';

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

export function emptyFlowchart(): FlowchartGraph {
  return {
    nodes: [
      { id: 'start', type: 'start', label: '开始', x: 180, y: 24 },
      { id: 'step', type: 'process', label: '处理', x: 180, y: 120 },
      { id: 'end', type: 'end', label: '结束', x: 180, y: 216 },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'step' },
      { id: 'e2', from: 'step', to: 'end' },
    ],
  };
}

export function emptyMindmap(): MindmapNode {
  return { id: 'root', label: '中心主题', children: [] };
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function FlowchartEditor({
  value,
  disabled,
  lang,
  onChange,
}: {
  value: FlowchartGraph;
  disabled?: boolean;
  lang: 'zh' | 'en';
  onChange: (next: FlowchartGraph) => void;
}) {
  const width = Math.max(420, ...value.nodes.map((node) => node.x + 140));
  const height = Math.max(280, ...value.nodes.map((node) => node.y + 90));
  const nodeMap = useMemo(() => new Map(value.nodes.map((node) => [node.id, node])), [value.nodes]);

  const updateNode = (id: string, patch: Partial<FlowchartNode>) => {
    onChange({
      ...value,
      nodes: value.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="flowchart-editor">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full border border-theme rounded-lg bg-white"
        height={Math.min(height, 360)}
      >
        {value.edges.map((edge) => {
          const from = nodeMap.get(edge.from);
          const to = nodeMap.get(edge.to);
          if (!from || !to) return null;
          return (
            <g key={edge.id}>
              <line
                x1={from.x + 60}
                y1={from.y + 22}
                x2={to.x + 60}
                y2={to.y}
                stroke="#6366f1"
                strokeWidth="2"
                markerEnd="url(#arrow)"
              />
              {edge.label ? (
                <text x={(from.x + to.x) / 2 + 60} y={(from.y + to.y) / 2 + 10} fontSize="11" fill="#4338ca">
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
          </marker>
        </defs>
        {value.nodes.map((node) => (
          <g key={node.id}>
            {node.type === 'decision' ? (
              <polygon
                points={`${node.x + 60},${node.y} ${node.x + 120},${node.y + 22} ${node.x + 60},${node.y + 44} ${node.x},${node.y + 22}`}
                fill="#eef2ff"
                stroke="#4338ca"
              />
            ) : (
              <rect
                x={node.x}
                y={node.y}
                width={120}
                height={44}
                rx={node.type === 'start' || node.type === 'end' ? 22 : 8}
                fill="#eef2ff"
                stroke="#4338ca"
              />
            )}
            <text x={node.x + 60} y={node.y + 26} textAnchor="middle" fontSize="12" fill="#111827">
              {node.label}
            </text>
          </g>
        ))}
      </svg>
      {!disabled && (
        <button
          type="button"
          className="self-start px-2 py-1 text-xs rounded border border-theme"
          onClick={() =>
            onChange({
              ...value,
              nodes: [
                ...value.nodes,
                {
                  id: newId('n'),
                  type: 'process',
                  label: lang === 'zh' ? '新步骤' : 'New step',
                  x: 40,
                  y: height - 70,
                },
              ],
            })
          }
        >
          {lang === 'zh' ? '添加节点' : 'Add node'}
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {value.nodes.map((node) => (
          <li key={node.id} className="grid grid-cols-[7rem_1fr_auto] gap-2 items-center">
            <select
              className="border border-theme rounded px-1 py-1 text-xs bg-surface"
              disabled={disabled}
              value={node.type}
              onChange={(event) => updateNode(node.id, { type: event.target.value as FlowchartNode['type'] })}
            >
              <option value="start">{lang === 'zh' ? '开始' : 'Start'}</option>
              <option value="process">{lang === 'zh' ? '处理' : 'Process'}</option>
              <option value="decision">{lang === 'zh' ? '判断' : 'Decision'}</option>
              <option value="end">{lang === 'zh' ? '结束' : 'End'}</option>
            </select>
            <input
              className="border border-theme rounded px-2 py-1 text-sm bg-surface"
              disabled={disabled}
              value={node.label}
              onChange={(event) => updateNode(node.id, { label: event.target.value })}
            />
            {!disabled && (
              <button
                type="button"
                className="text-xs text-rose-600"
                onClick={() =>
                  onChange({
                    nodes: value.nodes.filter((item) => item.id !== node.id),
                    edges: value.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id),
                  })
                }
              >
                {lang === 'zh' ? '删除' : 'Delete'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && value.nodes.length >= 2 && (
        <label className="text-xs text-muted">
          {lang === 'zh' ? '连接节点' : 'Connect nodes'}
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              className="px-2 py-1 text-xs rounded border border-theme"
              onClick={() => {
                const from = value.nodes[value.nodes.length - 2];
                const to = value.nodes[value.nodes.length - 1];
                if (!from || !to) return;
                if (value.edges.some((edge) => edge.from === from.id && edge.to === to.id)) return;
                onChange({
                  ...value,
                  edges: [...value.edges, { id: newId('e'), from: from.id, to: to.id }],
                });
              }}
            >
              {lang === 'zh' ? '连接最后两个节点' : 'Connect last two nodes'}
            </button>
          </div>
        </label>
      )}
    </div>
  );
}

function MindmapBranch({
  node,
  disabled,
  lang,
  onChange,
  onDelete,
}: {
  node: MindmapNode;
  disabled?: boolean;
  lang: 'zh' | 'en';
  onChange: (next: MindmapNode) => void;
  onDelete?: () => void;
}) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex gap-2 items-center">
        <input
          className="border border-theme rounded px-2 py-1 text-sm bg-surface flex-1"
          disabled={disabled}
          value={node.label}
          onChange={(event) => onChange({ ...node, label: event.target.value })}
        />
        {!disabled && (
          <button
            type="button"
            className="text-xs"
            onClick={() =>
              onChange({
                ...node,
                children: [
                  ...node.children,
                  { id: newId('mm'), label: lang === 'zh' ? '分支' : 'Branch', children: [] },
                ],
              })
            }
          >
            {lang === 'zh' ? '加分支' : 'Add'}
          </button>
        )}
        {!disabled && onDelete && (
          <button type="button" className="text-xs text-rose-600" onClick={onDelete}>
            {lang === 'zh' ? '删除' : 'Delete'}
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="pl-4 border-l border-indigo-200 flex flex-col gap-1">
          {node.children.map((child, index) => (
            <MindmapBranch
              key={child.id}
              node={child}
              disabled={disabled}
              lang={lang}
              onChange={(next) =>
                onChange({
                  ...node,
                  children: node.children.map((item, i) => (i === index ? next : item)),
                })
              }
              onDelete={() =>
                onChange({
                  ...node,
                  children: node.children.filter((_, i) => i !== index),
                })
              }
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function MindmapEditor({
  value,
  disabled,
  lang,
  onChange,
}: {
  value: MindmapNode;
  disabled?: boolean;
  lang: 'zh' | 'en';
  onChange: (next: MindmapNode) => void;
}) {
  return (
    <div data-testid="mindmap-editor">
      <ul className="flex flex-col gap-1">
        <MindmapBranch node={value} disabled={disabled} lang={lang} onChange={onChange} />
      </ul>
    </div>
  );
}
