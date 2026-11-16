import { useEffect, useMemo, useState } from 'react';
import {
  PROGRAMMING_KIND_LABELS,
  saveProgrammingArtifact,
  type LessonActivity,
  type ProgrammingArtifact,
  type ProgrammingKind,
} from './api';
import {
  FlowchartEditor,
  MindmapEditor,
  emptyFlowchart,
  emptyMindmap,
  type FlowchartGraph,
  type MindmapNode,
} from './ProgrammingGraphEditor';

const DEFAULT_SCRATCH_PLUGIN_IDS = ['@openlearn-ext/scratch', 'scratch-editor-deploy'];

function labelOf(lang: 'zh' | 'en', pair: { zh: string; en: string }) {
  return lang === 'zh' ? pair.zh : pair.en;
}

function asKind(value: unknown): ProgrammingKind | null {
  return value === 'scratch' || value === 'python' || value === 'flowchart' || value === 'mindmap' ? value : null;
}

function asFlowchart(value: unknown): FlowchartGraph {
  if (value && typeof value === 'object' && Array.isArray((value as FlowchartGraph).nodes)) {
    return value as FlowchartGraph;
  }
  return emptyFlowchart();
}

function asMindmap(value: unknown): MindmapNode {
  if (value && typeof value === 'object' && typeof (value as MindmapNode).label === 'string') {
    return value as MindmapNode;
  }
  return emptyMindmap();
}

interface ScratchPluginInfo {
  pluginId: string;
  view: string;
}

export function ProgrammingActivityPanel({
  lessonId,
  activity,
  lang,
  preview = false,
  onSaved,
}: {
  lessonId: string;
  activity: LessonActivity;
  lang: 'zh' | 'en';
  preview?: boolean;
  onSaved?: () => Promise<void> | void;
}) {
  const kind = asKind(activity.config.kind);
  const prompt = typeof activity.config.prompt === 'string' ? activity.config.prompt : '';
  const existing = activity.progress?.artifact;
  const [code, setCode] = useState(
    (existing?.code as string | undefined) ||
      (typeof activity.config.starterCode === 'string' ? activity.config.starterCode : ''),
  );
  const [flowchart, setFlowchart] = useState<FlowchartGraph>(
    asFlowchart(existing?.graph ?? activity.config.starterGraph ?? emptyFlowchart()),
  );
  const [mindmap, setMindmap] = useState<MindmapNode>(
    asMindmap(existing?.graph ?? activity.config.starterGraph ?? emptyMindmap()),
  );
  const [scratchNote, setScratchNote] = useState(existing?.scratch?.note || '');
  const [scratchFileName, setScratchFileName] = useState(existing?.scratch?.fileName || '');
  const [plugin, setPlugin] = useState<ScratchPluginInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'scratch') return;
    let cancelled = false;
    const preferred =
      typeof activity.config.scratchPluginId === 'string' && activity.config.scratchPluginId.trim()
        ? activity.config.scratchPluginId.trim()
        : '';
    void fetch('/api/plugins', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : []))
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload) ? payload : payload?.plugins || payload?.items || [];
        const found = (list as Array<Record<string, unknown>>).find((item) => {
          const id = String(item.id || item.pluginId || '');
          const manifestId = String(item.manifestId || item.manifest_id || '');
          const name = String(item.name || '');
          const enabled = item.enabled !== false && item.status !== 'disabled';
          if (!enabled) return false;
          const candidates = [id, manifestId, name];
          if (preferred && candidates.includes(preferred)) return true;
          return candidates.some((value) => DEFAULT_SCRATCH_PLUGIN_IDS.includes(value) || value.includes('scratch'));
        });
        if (!found) {
          setPlugin(null);
          return;
        }
        const view = (found.view as string) || (found.studentView as string) || 'storage/player.html';
        setPlugin({ pluginId: String(found.id || found.pluginId || preferred || '@openlearn-ext/scratch'), view });
      })
      .catch(() => {
        if (!cancelled) setPlugin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activity.config.scratchPluginId, kind]);

  const artifact = useMemo<ProgrammingArtifact | null>(() => {
    if (!kind) return null;
    if (kind === 'python') return { kind, code, updatedAt: Date.now() };
    if (kind === 'flowchart') return { kind, graph: flowchart, updatedAt: Date.now() };
    if (kind === 'mindmap') return { kind, graph: mindmap, updatedAt: Date.now() };
    return {
      kind,
      scratch: { note: scratchNote, fileName: scratchFileName },
      updatedAt: Date.now(),
    };
  }, [code, flowchart, kind, mindmap, scratchFileName, scratchNote]);

  const persist = async (submit: boolean) => {
    if (preview || !artifact) return;
    setBusy(true);
    setError(null);
    try {
      await saveProgrammingArtifact(lessonId, activity.id, artifact, submit);
      await onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!kind) {
    return (
      <p className="text-sm text-muted">
        {lang === 'zh' ? '教师尚未选择编程类型。' : 'This programming activity has no kind yet.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="programming-activity-panel">
      <div>
        <h4 className="text-sm font-semibold text-main">{labelOf(lang, PROGRAMMING_KIND_LABELS[kind])}</h4>
        {prompt ? <p className="text-sm text-main whitespace-pre-wrap mt-1">{prompt}</p> : null}
      </div>
      {kind === 'python' && (
        <textarea
          data-testid="python-editor"
          className="w-full min-h-[220px] border border-theme rounded-lg px-2 py-1.5 font-mono text-sm bg-surface"
          disabled={preview}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={
            lang === 'zh'
              ? '在此编写 Python 源码。平台未内置运行时，提交后由教师批阅。'
              : 'Write Python here. No runtime is bundled; teachers review the source.'
          }
        />
      )}
      {kind === 'flowchart' && (
        <FlowchartEditor value={flowchart} disabled={preview} lang={lang} onChange={setFlowchart} />
      )}
      {kind === 'mindmap' && <MindmapEditor value={mindmap} disabled={preview} lang={lang} onChange={setMindmap} />}
      {kind === 'scratch' && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted">
            {lang === 'zh'
              ? '本平台不内嵌 scratch.mit.edu。若已安装独立的 Scratch 离线插件，会尝试打开插件视图；否则可提交作品说明，供教师批阅。完整课堂 .sb3 提交通道取决于插件本身是否可用，这里不把它写成已具备。'
              : 'The platform does not embed scratch.mit.edu. If a separate offline Scratch plugin is installed, its view may appear; otherwise submit notes for teacher review. A complete .sb3 classroom pipeline is not claimed here.'}
          </p>
          {plugin ? (
            <p
              className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"
              data-testid="scratch-plugin-hint"
            >
              {lang === 'zh'
                ? `检测到插件 ${plugin.pluginId}。请到插件提供的 Scratch 视图中创作；学案页只保存作品说明与提交状态，不把插件能力写成已完整打通。`
                : `Plugin ${plugin.pluginId} was detected. Create in the plugin view; this pack only stores notes and submission status.`}
            </p>
          ) : (
            <p className="text-xs text-muted" data-testid="scratch-fallback-hint">
              {lang === 'zh'
                ? '当前实例未检测到已启用的 Scratch 插件。'
                : 'No enabled Scratch plugin was detected on this instance.'}
            </p>
          )}
          <label className="text-xs font-semibold text-muted">
            {lang === 'zh' ? '作品文件名（可选）' : 'Project file name (optional)'}
            <input
              className="mt-1 w-full border border-theme rounded-lg px-2 py-1.5 text-sm bg-surface font-normal"
              disabled={preview}
              value={scratchFileName}
              onChange={(event) => setScratchFileName(event.target.value)}
              placeholder="project.sb3"
            />
          </label>
          <textarea
            className="w-full min-h-[120px] border border-theme rounded-lg px-2 py-1.5 text-sm bg-surface"
            disabled={preview}
            value={scratchNote}
            onChange={(event) => setScratchNote(event.target.value)}
            placeholder={lang === 'zh' ? '说明你完成了什么，或记录作品要点。' : 'Describe what you built.'}
          />
        </div>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!preview && (
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-lg border border-theme"
            disabled={busy}
            onClick={() => void persist(false)}
          >
            {lang === 'zh' ? '保存草稿' : 'Save draft'}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white"
            disabled={busy}
            onClick={() => void persist(true)}
            data-testid="submit-programming-artifact"
          >
            {lang === 'zh' ? '提交作品' : 'Submit work'}
          </button>
        </div>
      )}
      {kind === 'python' && (
        <p className="text-xs text-muted">
          {lang === 'zh'
            ? '未内置 Pyodide 或其它 Python 运行时，不能在学案页直接运行代码。'
            : 'No in-browser Python runtime is bundled, so code is not executed on this page.'}
        </p>
      )}
    </div>
  );
}
