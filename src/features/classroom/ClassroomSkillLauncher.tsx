/**
 * ClassroomSkillLauncher —— 课堂场景的 Skill 入口（P2）。
 *
 * 只做「生成预览 + 教师确认投屏」：技能在服务端运行，产物是 classroom_card；
 * 确认后由宿主把卡片写成白板文本元素（既有 whiteboard.draw 通道）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, Projector } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';

interface ClassroomSkill {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
}

interface ClassroomCard {
  title: string;
  body: string;
}

interface ClassroomSkillLauncherProps {
  lessonId: string | null;
  classId?: string | null;
  stage?: string;
  lang?: 'zh' | 'en';
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ClassroomSkillLauncher({
  lessonId,
  classId,
  stage,
  lang = 'zh',
  addToast,
}: ClassroomSkillLauncherProps) {
  const zh = lang === 'zh';
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<ClassroomSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState('');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ skillId: string; skillName: string; card: ClassroomCard } | null>(null);
  const [error, setError] = useState('');

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/skills?surface=classroom_live');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(zh ? '课堂技能加载失败' : 'Failed to load classroom skills');
        setSkills([]);
        return;
      }
      setSkills(Array.isArray(data.skills) ? data.skills : []);
    } catch {
      setError(zh ? '课堂技能加载失败' : 'Failed to load classroom skills');
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    if (!open) return;
    void loadSkills();
  }, [open, loadSkills]);

  const handleRun = async (skill: ClassroomSkill) => {
    if (!lessonId || !classId || runningId) return;
    setRunningId(skill.id);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.id)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'classroom_live', lessonId, classId, stage, lang }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || data?.error || (zh ? '生成失败' : 'Run failed'));
        return;
      }
      if (data.artifact?.kind !== 'classroom_card' || !data.artifact.card) {
        setError(zh ? '未返回可投屏的卡片' : 'No card returned');
        return;
      }
      setResult({ skillId: skill.id, skillName: skill.name, card: data.artifact.card });
    } catch {
      setError(zh ? '生成失败' : 'Run failed');
    } finally {
      setRunningId('');
    }
  };

  const handleApply = async () => {
    if (!result || !lessonId || !classId || applying) return;
    setApplying(true);
    setError('');
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(result.skillId)}/apply-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, classId, card: result.card }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || (zh ? '投屏失败' : 'Failed to project'));
        return;
      }
      addToast?.(
        zh ? '已投屏' : 'Projected',
        zh ? '卡片已写入当前环节白板' : 'Card was added to the current whiteboard',
        'success',
      );
      setOpen(false);
      setResult(null);
    } catch {
      setError(zh ? '投屏失败' : 'Failed to project');
    } finally {
      setApplying(false);
    }
  };

  const disabled = !lessonId || !classId;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setError('');
          setOpen(true);
        }}
        disabled={disabled}
        data-testid="classroom-skill-launcher-btn"
        className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        title={zh ? '课堂技能' : 'Classroom skills'}
      >
        <Sparkles size={13} />
        <span>{zh ? '技能' : 'Skills'}</span>
      </button>

      <AccessibleDialog
        open={open}
        onClose={() => !runningId && !applying && setOpen(false)}
        ariaLabelledBy="classroom-skill-title"
      >
        <DialogHeader>
          <DialogTitle
            id="classroom-skill-title"
            icon={<Sparkles size={18} />}
            description={
              zh ? '生成课堂卡片，确认后再投屏到白板。' : 'Generate a card, then project it to the whiteboard.'
            }
          >
            {zh ? '课堂技能' : 'Classroom skills'}
          </DialogTitle>
          <DialogCloseButton label={zh ? '关闭' : 'Close'} onClick={() => !runningId && !applying && setOpen(false)} />
        </DialogHeader>

        <DialogBody className="space-y-3">
          {error && (
            <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {!result && (
            <div className="space-y-2">
              {loading && (
                <p className="text-xs text-secondary flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" />
                  {zh ? '加载课堂技能…' : 'Loading skills…'}
                </p>
              )}
              {!loading && skills.length === 0 && !error && (
                <p className="text-xs text-secondary">{zh ? '当前没有课堂技能。' : 'No classroom skills.'}</p>
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
            <div className="space-y-2">
              <p className="text-xs text-secondary">
                {zh ? `技能「${result.skillName}」生成结果` : `Result from "${result.skillName}"`}
              </p>
              <div className="border border-border rounded-xl px-3 py-2.5">
                <p className="text-sm font-bold text-main">{result.card.title}</p>
                <p className="text-xs text-main whitespace-pre-wrap mt-1">{result.card.body}</p>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {result ? (
            <>
              <DialogButton variant="secondary" onClick={() => setResult(null)} disabled={applying}>
                {zh ? '返回' : 'Back'}
              </DialogButton>
              <DialogButton variant="primary" onClick={() => void handleApply()} disabled={applying}>
                {applying ? (
                  <>
                    <Loader2 size={12} className="animate-spin mr-1" />
                    {zh ? '投屏中' : 'Projecting'}
                  </>
                ) : (
                  <>
                    <Projector size={12} className="mr-1" />
                    {zh ? '投屏到白板' : 'Project'}
                  </>
                )}
              </DialogButton>
            </>
          ) : (
            <DialogButton variant="secondary" onClick={() => setOpen(false)}>
              {zh ? '关闭' : 'Close'}
            </DialogButton>
          )}
        </DialogFooter>
      </AccessibleDialog>
    </>
  );
}

export default ClassroomSkillLauncher;
