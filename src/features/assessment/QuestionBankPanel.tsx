/**
 * 题库面板（Issue #100 / #121）：列出/新建/删除题库题目。
 *
 * 建题复用同一套题型编辑器（`question-type-ui-registry`），保证题库与试卷里的题
 * 结构完全一致 —— 组卷时只是复制快照，不做任何转换。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BookMarked, Loader2, Plus, Trash2 } from 'lucide-react';
import { assessmentApi, ApiError, type BankItem } from './api';
import { assessmentQuestionTypeUiRegistry, useAssessmentQuestionTypes } from './question-type-ui-registry';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { toBankItemSummary } from './extension-slot-props';
import './register-builtin-question-uis';

const INPUT =
  'w-full px-2.5 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-indigo-500';

export function QuestionBankPanel({ lang }: { lang: 'zh' | 'en' }) {
  const zh = lang === 'zh';
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState('single_choice');
  const [stem, setStem] = useState('');
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [answerKey, setAnswerKey] = useState<unknown>(null);
  // Issue #186：默认私有；选中共享后同实例教师可见
  const [visibility, setVisibility] = useState<'private' | 'school'>('private');
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterDifficultyMin, setFilterDifficultyMin] = useState('');
  const [filterDifficultyMax, setFilterDifficultyMax] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);

  const types = useAssessmentQuestionTypes();
  const activeType = types.find((entry) => entry.type === type);
  const Editor = activeType?.Editor;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await assessmentApi.listBank({
        type: filterType || undefined,
        tags: filterTags.length > 0 ? filterTags : undefined,
        difficultyMin: filterDifficultyMin ? Number(filterDifficultyMin) : undefined,
        difficultyMax: filterDifficultyMax ? Number(filterDifficultyMax) : undefined,
      });
      setItems(res.items);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [filterType, filterTags, filterDifficultyMin, filterDifficultyMax]);

  useEffect(() => {
    void load();
  }, [load]);

  // 切题型时重置为该题型的默认配置
  useEffect(() => {
    const ui = assessmentQuestionTypeUiRegistry.get(type);
    setConfig(ui?.createDefaultConfig?.() ?? {});
    setAnswerKey(ui?.createDefaultAnswerKey?.() ?? null);
  }, [type]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stem.trim()) {
      setError(zh ? '题干不能为空' : 'Stem is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await assessmentApi.createBankItem({ type, stem: stem.trim(), config, answerKey, visibility });
      setStem('');
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <section aria-labelledby="bank-create-heading" className="border border-theme rounded-xl p-4 max-w-3xl mx-auto">
        <h2 id="bank-create-heading" className="text-xs font-bold text-main flex items-center gap-1.5 mb-3">
          <Plus size={13} />
          {zh ? '新增题库题目' : 'New bank item'}
        </h2>
        <form onSubmit={create} className="space-y-3">
          <div>
            <label htmlFor="bank-type" className="block text-2xs font-semibold text-muted mb-1">
              {zh ? '题型' : 'Type'}
            </label>
            <select id="bank-type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
              {types.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label[zh ? 'zh' : 'en']}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bank-stem" className="block text-2xs font-semibold text-muted mb-1">
              {zh ? '题干' : 'Stem'}
            </label>
            <textarea
              id="bank-stem"
              rows={2}
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              className={`${INPUT} field-sizing-auto`}
            />
          </div>
          {Editor && (
            <Editor
              config={config}
              answerKey={answerKey}
              lang={lang}
              onChange={({ config: nextConfig, answerKey: nextKey }) => {
                setConfig(nextConfig);
                setAnswerKey(nextKey);
              }}
            />
          )}
          <div>
            <label htmlFor="bank-visibility" className="block text-2xs font-semibold text-muted mb-1">
              {zh ? '可见范围' : 'Visibility'}
            </label>
            <select
              id="bank-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value === 'school' ? 'school' : 'private')}
              className={INPUT}
            >
              <option value="private">{zh ? '仅自己' : 'Private'}</option>
              <option value="school">{zh ? '同校教师可见' : 'Teachers on this instance'}</option>
            </select>
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {zh ? '存入题库' : 'Save to bank'}
          </button>
          {/* P1：批量导入 / 第三方题库同步入口；插件声明 view 或 commandType */}
          <div className="pt-1">
            <ExtensionPointRenderer
              slot="assessment.bank.import.source"
              slotProps={{ lang, refresh: load }}
              lang={lang}
            />
          </div>
        </form>
      </section>

      <section aria-labelledby="bank-list-heading" className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 id="bank-list-heading" className="text-xs font-bold text-main flex items-center gap-1.5">
            <BookMarked size={13} />
            {zh ? '题库题目' : 'Bank items'}（{items?.length ?? 0}）
          </h2>
          <ExtensionPointRenderer
            slot="assessment.bank.toolbar.action"
            slotProps={{ filters: { type: filterType || undefined }, lang, refresh: load }}
            lang={lang}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <label htmlFor="bank-filter-type" className="text-2xs font-semibold text-muted">
            {zh ? '筛选题型' : 'Filter type'}
          </label>
          <select
            id="bank-filter-type"
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
            className={`${INPUT} max-w-48`}
          >
            <option value="">{zh ? '全部题型' : 'All types'}</option>
            {types.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label[zh ? 'zh' : 'en']}
              </option>
            ))}
          </select>
          <ExtensionPointRenderer
            slot="assessment.bank.filter"
            slotProps={{
              activeFilters: {
                type: filterType || undefined,
                tags: filterTags.length > 0 ? filterTags : undefined,
                difficultyMin: filterDifficultyMin ? Number(filterDifficultyMin) : undefined,
                difficultyMax: filterDifficultyMax ? Number(filterDifficultyMax) : undefined,
              },
              lang,
              onChange: (patch: Record<string, unknown>) => {
                if (typeof patch.type === 'string') setFilterType(patch.type);
                if (Array.isArray(patch.tags)) {
                  setFilterTags(patch.tags.map((tag) => String(tag)).filter(Boolean));
                }
                if (patch.difficultyMin === null) setFilterDifficultyMin('');
                else if (typeof patch.difficultyMin === 'number') setFilterDifficultyMin(String(patch.difficultyMin));
                if (patch.difficultyMax === null) setFilterDifficultyMax('');
                else if (typeof patch.difficultyMax === 'number') setFilterDifficultyMax(String(patch.difficultyMax));
              },
            }}
            lang={lang}
          />
        </div>
        {items === null && loading ? (
          <p className="text-xs text-muted flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            {zh ? '加载中…' : 'Loading…'}
          </p>
        ) : (items?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted">{zh ? '题库还是空的。' : 'The bank is empty.'}</p>
        ) : (
          <ul data-testid="bank-list" className="space-y-2">
            {items!.map((item) => (
              <li
                key={item.id}
                data-testid={`bank-row-${item.id}`}
                className="border border-theme rounded-xl px-3 py-2 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-main line-clamp-2">{item.stem}</p>
                    <p className="text-2xs text-muted mt-0.5">
                      {assessmentQuestionTypeUiRegistry.get(item.type)?.label[zh ? 'zh' : 'en'] ?? item.type}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(zh ? '从题库删除该题？' : 'Delete this bank item?')) return;
                      try {
                        await assessmentApi.removeBankItem(item.id);
                        await load();
                      } catch (e: any) {
                        setError(e?.message ?? String(e));
                      }
                    }}
                    aria-label={zh ? `删除题库题目：${item.stem.slice(0, 20)}` : `Delete bank item`}
                    className="p-1 rounded-md text-muted hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                  <ExtensionPointRenderer
                    slot="assessment.bank.item.action"
                    slotProps={{ item: toBankItemSummary(item), lang, commandPayload: { bankItemId: item.id } }}
                    lang={lang}
                  />
                  <button
                    type="button"
                    onClick={() => setPreviewId((prev) => (prev === item.id ? null : item.id))}
                    aria-expanded={previewId === item.id}
                    className="px-2 py-1 rounded-md border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary cursor-pointer shrink-0"
                  >
                    {zh ? '预览' : 'Preview'}
                  </button>
                </div>
                {previewId === item.id && (
                  <ExtensionPointRenderer
                    slot="assessment.bank.item.preview"
                    slotProps={{ item: toBankItemSummary(item), lang }}
                    lang={lang}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
