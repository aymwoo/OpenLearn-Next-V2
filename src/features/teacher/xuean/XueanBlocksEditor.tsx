/**
 * 学案首页编辑器（教师端）。
 *
 * 学案首页只保留两项内容：简介文字 + 背景图片，统一存为单条 `xuean_home` 块，
 * 不再支持多块编排。学生端据此渲染学案头图。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { createLessonBlock, getLessonBlocks, updateLessonBlock } from '../../../services/lessonActivitiesService.js';
import { useOptionalAppData } from '../../../context/AppDataContext.js';

const HOME_BLOCK_TYPE = 'xuean_home';
const MAX_INTRO_LENGTH = 2000;
const MAX_IMAGE_MB = 5;

type Block = {
  id: string;
  lesson_id: string;
  block_type: string;
  order_index: number;
  content_json: string;
};

type HomeContent = { intro: string; backgroundImage: string };

function parseHomeContent(contentJson: string | undefined): HomeContent {
  if (!contentJson) return { intro: '', backgroundImage: '' };
  try {
    const parsed = JSON.parse(contentJson) as Record<string, unknown>;
    return {
      intro: typeof parsed?.intro === 'string' ? parsed.intro : '',
      backgroundImage: typeof parsed?.backgroundImage === 'string' ? parsed.backgroundImage : '',
    };
  } catch {
    return { intro: '', backgroundImage: '' };
  }
}

export function XueanBlocksEditor() {
  const appData = useOptionalAppData();
  const lessonId = appData?.selectedLesson ?? '';
  const [homeBlockId, setHomeBlockId] = useState<string | null>(null);
  const [intro, setIntro] = useState('');
  const [backgroundImage, setBackgroundImage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!lessonId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await getLessonBlocks(lessonId);
    if (res.ok && res.data) {
      const home = (res.data as Block[]).find((block) => block.block_type === HOME_BLOCK_TYPE);
      const content = parseHomeContent(home?.content_json);
      setHomeBlockId(home?.id ?? null);
      setIntro(content.intro);
      setBackgroundImage(content.backgroundImage);
      setError(null);
    } else {
      setError('学案首页加载失败，请稍后重试');
    }
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async () => {
    if (!lessonId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      blockType: HOME_BLOCK_TYPE,
      content: JSON.stringify({ intro: intro.trim(), backgroundImage }),
    };
    const res = homeBlockId
      ? await updateLessonBlock(homeBlockId, payload)
      : await createLessonBlock(lessonId, payload);
    setSaving(false);
    if (!res.ok) {
      setError((res.error as { error?: string })?.error ?? '保存失败');
      return;
    }
    const saved = (res.data as Block | undefined) ?? null;
    if (saved?.id) setHomeBlockId(saved.id);
    setNotice('已保存');
  };

  const handleImageFile = async (file: File) => {
    setError(null);
    setNotice(null);
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      setError('仅支持 JPG / PNG / GIF / WebP 图片');
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setError(`背景图不能超过 ${MAX_IMAGE_MB}MB`);
      return;
    }
    setUploading(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64Data }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; fileUrl?: string; error?: string };
      if (!res.ok || !body.success || !body.fileUrl) {
        setError(body.error ?? '背景图上传失败');
        return;
      }
      setBackgroundImage(body.fileUrl);
      setNotice('背景图已上传，记得点击保存');
    } catch (err) {
      setError((err as Error).message || '背景图上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme bg-surface/85 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-wider text-primary-theme">学案首页</span>
          <span className="text-xs text-muted truncate">· 简介与背景图</span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!lessonId || loading || saving}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="text-center text-muted py-10 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载中…
          </div>
        )}

        {!lessonId && (
          <div className="text-center text-muted py-16 border-2 border-dashed border-theme rounded-xl">
            请先选择一个课时
          </div>
        )}

        {!loading && lessonId && (
          <div className="max-w-3xl mx-auto space-y-5">
            {error && (
              <div className="text-xs text-rose-600 bg-rose-500/5 border border-rose-500/20 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span>{error}</span>
                <button type="button" onClick={refresh} className="underline shrink-0">
                  重试
                </button>
              </div>
            )}
            {notice && <div className="text-xs text-emerald-600">{notice}</div>}

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-muted">学案简介</label>
              <textarea
                value={intro}
                onChange={(e) => {
                  setIntro(e.target.value.slice(0, MAX_INTRO_LENGTH));
                  setNotice(null);
                }}
                rows={6}
                maxLength={MAX_INTRO_LENGTH}
                placeholder="介绍本节课的学习目标、情境或任务说明…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
              />
              <p className="text-[11px] text-muted/80 text-right">
                {intro.length} / {MAX_INTRO_LENGTH}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-muted">背景图片</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp,image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImageFile(file);
                  e.target.value = '';
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary disabled:opacity-40 text-main"
                >
                  <ImagePlus size={13} />
                  {uploading ? '上传中…' : backgroundImage ? '更换背景图' : '上传背景图'}
                </button>
                {backgroundImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setBackgroundImage('');
                      setNotice(null);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                  >
                    <Trash2 size={13} />
                    移除
                  </button>
                )}
                <span className="text-[11px] text-muted">JPG / PNG / GIF / WebP，≤ {MAX_IMAGE_MB}MB</span>
              </div>

              <div
                className="rounded-xl border border-theme overflow-hidden min-h-[160px] bg-surface-secondary bg-cover bg-center relative"
                style={backgroundImage ? { backgroundImage: `url("${backgroundImage}")` } : undefined}
                aria-label="学案首页预览"
              >
                {backgroundImage && <div className="absolute inset-0 bg-black/35" />}
                <p
                  className={`relative p-4 text-sm whitespace-pre-wrap ${
                    backgroundImage ? 'text-white' : 'text-muted'
                  }`}
                >
                  {intro.trim() || '简介预览'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
