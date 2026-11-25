/**
 * SkillLauncher —— 备课场景的 Skill 入口（P0）。
 *
 * 流程：技能目录 → 选择技能 → 生成（预览）→ 确认插入时间线。
 * 写操作仍由父组件通过既有 `saveTimeline`（PUT /api/lessons/:id/timeline）完成，
 * 组件本身不直接落库。
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';

type LessonSegmentType = 'intro' | 'lecture' | 'practice' | 'summary';

interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  latencyClass?: 'interactive' | 'background';
}

interface LessonSegmentDraft {
  title: string;
  duration: string;
  type: LessonSegmentType;
}

interface SkillRunResult {
  skillId: string;
  skillName: string;
  text: string;
  artifact: { kind: 'lesson_segments'; segments: LessonSegmentDraft[] } | null;
}

interface SkillLauncherProps {
  lessonId: string | null;
  lang?: string;
  disabled?: boolean;
  existingSegments?: Array<Record<string, unknown>>;
  onSaveTimeline?: (lessonId: string, segments: Array<Record<string, unknown>>) => Promise<void> | void;
}

const SEGMENT_COLORS: Record<LessonSegmentType, string> = {
  intro: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  lecture: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
  practice: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
  summary: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
};

const TYPE_LABELS: Record<LessonSegmentType, { zh: string; en: string }> = {
  intro: { zh: '导入', en: 'Intro' },
  lecture: { zh: '讲授', en: 'Lecture' },
  practice: { zh: '练习', en: 'Practice' },
  summary: { zh: '总结', en: 'Summary' },
};

export function SkillLauncher({
  lessonId,
  lang = 'zh',
  disabled = false,
  existingSegments = [],
  onSaveTimeline,
}: SkillLauncherProps) {
  const zh = lang !== 'en';
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [result, setResult] = useState<SkillRunResult | null>(null);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState('');

  const loadSkills = useCallback(async () => {
    setLoadingSkills(true);
    setError('');
    try {
      const res = await fetch('/api/skills?surface=lesson_prep');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(zh ? '技能目录加载失败' : 'Failed to load skill catalog');
        setSkills([]);
        return;
      }
      setSkills(Array.isArray(data.skills) ? data.skills : []);
    } catch {
      setError(zh ? '技能目录加载失败' : 'Failed to load skill catalog');
      setSkills([]);
    } finally {
      setLoadingSkills(false);
    }
  }, [zh]);

  useEffect(() => {
    if (!open) return;
    void loadSkills();
  }, [open, loadSkills]);

  const handleOpen = () => {
    setResult(null);
    setError('');
    setOpen(true);
  };

  const handleClose = () => {
    if (runningId || inserting) return;
    setOpen(false);
    setResult(null);
  };

  const handleRun = async (skill: SkillCatalogItem) => {
    if (!lessonId || runningId) return;
    setRunningId(skill.id);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.id)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, surface: 'lesson_prep', lang }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(
          data?.message ||
            data?.error ||
            (zh ? '技能运行失败，请检查 AI 提供商配置' : 'Skill run failed. Check the AI provider configuration.'),
        );
        return;
      }
      setResult({
        skillId: skill.id,
        skillName: skill.name,
        text: typeof data.text === 'string' ? data.text : '',
        artifact: data.artifact?.kind === 'lesson_segments' ? data.artifact : null,
      });
    } catch {
      setError(zh ? '技能运行失败' : 'Skill run failed');
    } finally {
      setRunningId(null);
    }
  };

  const handleInsert = async () => {
    const segments = result?.artifact?.segments;
    if (!lessonId || !segments?.length || inserting || !onSaveTimeline) return;
    setInserting(true);
    setError('');
    try {
      const stamp = Date.now();
      const appended = segments.map((segment, index) => ({
        id: `seg-${stamp}-${index}`,
        title: segment.title,
        type: segment.type,
        duration: segment.duration,
        color: SEGMENT_COLORS[segment.type] ?? SEGMENT_COLORS.lecture,
      }));
      await onSaveTimeline(lessonId, [...existingSegments, ...appended]);
      setOpen(false);
      setResult(null);
    } catch {
      setError(zh ? '插入环节失败' : 'Failed to insert segments');
    } finally {
      setInserting(false);
    }
  };

  const segments = result?.artifact?.segments ?? [];

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled || !lessonId}
        data-testid="editor-skill-launcher-btn"
        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-2xs hover:scale-102 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
        title={zh ? '用技能生成备课环节' : 'Generate lesson segments with a skill'}
      >
        <Sparkles size={13} />
        <span>{zh ? '技能' : 'Skills'}</span>
      </button>

      <AccessibleDialog open={open} onClose={handleClose} ariaLabelledBy="skill-launcher-title">
        <DialogHeader>
          <DialogTitle
            id="skill-launcher-title"
            icon={<Sparkles size={18} />}
            description={
              zh
                ? '选择一个技能，生成结果确认后再插入当前课节。'
                : 'Pick a skill, review the result, then insert it into this lesson.'
            }
          >
            {zh ? '技能' : 'Skills'}
          </DialogTitle>
          <DialogCloseButton label={zh ? '关闭' : 'Close'} onClick={handleClose} />
        </DialogHeader>

        <DialogBody className="space-y-4">
          {error && (
            <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {!result && (
            <div className="space-y-2">
              {loadingSkills && (
                <p className="text-xs text-secondary flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" />
                  {zh ? '加载技能目录…' : 'Loading skills…'}
                </p>
              )}
              {!loadingSkills && skills.length === 0 && !error && (
                <p className="text-xs text-secondary">{zh ? '当前没有可用技能。' : 'No skills available.'}</p>
              )}
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-start justify-between gap-3 border border-border rounded-xl px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-main">{skill.name}</p>
                    <p className="text-xs text-secondary mt-0.5">{skill.whenToUse || skill.description}</p>
                  </div>
                  <DialogButton
                    variant="primary"
                    onClick={() => void handleRun(skill)}
                    disabled={!!runningId}
                    className="shrink-0"
                  >
                    {runningId === skill.id ? (
                      <>
                        <Loader2 size={12} className="animate-spin mr-1" />
                        {zh ? '生成中' : 'Running'}
                      </>
                    ) : zh ? (
                      '生成'
                    ) : (
                      'Run'
                    )}
                  </DialogButton>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <p className="text-xs text-secondary">
                {zh ? `技能「${result.skillName}」生成结果` : `Result from "${result.skillName}"`}
              </p>
              {segments.length > 0 ? (
                <ol className="space-y-2">
                  {segments.map((segment, index) => (
                    <li
                      key={`${segment.title}-${index}`}
                      className="flex items-center justify-between gap-3 border border-border rounded-xl px-3 py-2"
                    >
                      <span className="text-sm font-semibold text-main min-w-0 truncate">{segment.title}</span>
                      <span className="text-[11px] text-secondary shrink-0">
                        {TYPE_LABELS[segment.type]?.[zh ? 'zh' : 'en'] ?? segment.type} · {segment.duration}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-secondary">
                  {zh ? '模型未返回可用环节，可重试。' : 'No segments returned.'}
                </p>
              )}
              {result.text && (
                <details className="text-xs text-secondary">
                  <summary className="cursor-pointer">{zh ? '查看原始输出' : 'View raw output'}</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words bg-subtle rounded-lg p-2 max-h-48 overflow-auto">
                    {result.text}
                  </pre>
                </details>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {result ? (
            <>
              <DialogButton variant="secondary" onClick={() => setResult(null)} disabled={inserting}>
                {zh ? '返回' : 'Back'}
              </DialogButton>
              <DialogButton
                variant="primary"
                onClick={() => void handleInsert()}
                disabled={inserting || segments.length === 0 || !onSaveTimeline}
              >
                {inserting ? (
                  <>
                    <Loader2 size={12} className="animate-spin mr-1" />
                    {zh ? '插入中' : 'Inserting'}
                  </>
                ) : zh ? (
                  `插入 ${segments.length} 个环节`
                ) : (
                  `Insert ${segments.length} segment(s)`
                )}
              </DialogButton>
            </>
          ) : (
            <DialogButton variant="secondary" onClick={handleClose}>
              {zh ? '关闭' : 'Close'}
            </DialogButton>
          )}
        </DialogFooter>
      </AccessibleDialog>
    </>
  );
}

export default SkillLauncher;
