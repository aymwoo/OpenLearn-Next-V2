/**
 * 5 种内置题型的出题编辑器（Issue #100 / #121）。
 *
 * 与 `packages/core/assessment/question-types/builtin.ts` 的默认配置、答案格式**逐字段对齐**：
 * 编辑器只产出 core 判分器认识的结构，不给用户造出"能存不能判"的题。
 *
 * a11y：所有输入都有可见 label 关联（`<label htmlFor>`），单选/复选组用 fieldset + legend，
 * 选项删除按钮带 `aria-label`（`e2e/a11y-gate.spec.ts` 的门禁覆盖本页）。
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { QuestionEditorProps } from './question-type-ui-registry';

const INPUT_CLASS =
  'w-full px-2.5 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-indigo-500';

function readOptions(config: Record<string, unknown>): string[] {
  const raw = config.options;
  return Array.isArray(raw) ? raw.map((o) => String(o)) : [];
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-muted mb-1">
      {children}
    </label>
  );
}

/* ─────────────────────────── 选项编辑（单选/多选共用） ─────────────────────────── */

function OptionsEditor({
  config,
  answerKey,
  onChange,
  lang,
  disabled,
  multiple,
  idPrefix,
}: QuestionEditorProps & { multiple: boolean; idPrefix: string }) {
  const options = readOptions(config);
  const selected: number[] = multiple
    ? Array.isArray((answerKey as any)?.indexes)
      ? ((answerKey as any).indexes as unknown[]).map(Number).filter((n) => Number.isInteger(n))
      : []
    : typeof (answerKey as any)?.index === 'number'
      ? [(answerKey as any).index as number]
      : [];

  const setOptions = (next: string[]) => onChange({ config: { ...config, options: next }, answerKey });
  const setSelection = (index: number, checked: boolean) => {
    if (multiple) {
      const next = checked
        ? [...new Set([...selected, index])].sort((a, b) => a - b)
        : selected.filter((i) => i !== index);
      onChange({ config, answerKey: next.length > 0 ? { indexes: next } : null });
    } else {
      onChange({ config, answerKey: { index } });
    }
  };

  const label = (idx: number) => String.fromCharCode(65 + idx);

  return (
    <div className="space-y-2">
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold text-muted mb-1">
          {lang === 'zh' ? '选项与正确答案' : 'Options & correct answer'}
        </legend>
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type={multiple ? 'checkbox' : 'radio'}
              id={`${idPrefix}-opt-${idx}`}
              name={`${idPrefix}-answer`}
              checked={selected.includes(idx)}
              disabled={disabled}
              onChange={(e) => setSelection(idx, e.target.checked)}
              aria-label={`${lang === 'zh' ? '把选项' : 'Mark option'} ${label(idx)} ${lang === 'zh' ? '标为正确答案' : 'as correct'}`}
              className="shrink-0 accent-indigo-600"
            />
            <label htmlFor={`${idPrefix}-opt-${idx}`} className="sr-only">
              {lang === 'zh' ? `选项 ${label(idx)}` : `Option ${label(idx)}`}
            </label>
            <span className="text-xs font-bold text-muted w-4 shrink-0">{label(idx)}</span>
            <input
              type="text"
              value={opt}
              disabled={disabled}
              aria-label={lang === 'zh' ? `选项 ${label(idx)} 内容` : `Option ${label(idx)} text`}
              onChange={(e) => {
                const next = [...options];
                next[idx] = e.target.value;
                setOptions(next);
              }}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={disabled || options.length <= 2}
              onClick={() => {
                const next = options.filter((_, i) => i !== idx);
                // 删掉选项后，答案索引可能失效 → 直接清空，由教师重选（不猜）
                setOptions(next);
                onChange({ config: { ...config, options: next }, answerKey: null });
              }}
              aria-label={lang === 'zh' ? `删除选项 ${label(idx)}` : `Delete option ${label(idx)}`}
              className="p-1 rounded-md text-muted hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </fieldset>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          setOptions([...options, lang === 'zh' ? `选项 ${label(options.length)}` : `Option ${label(options.length)}`])
        }
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-theme text-xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
      >
        <Plus size={12} />
        {lang === 'zh' ? '添加选项' : 'Add option'}
      </button>
      {selected.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {lang === 'zh'
            ? '未设置正确答案：该题交卷后进入人工批改。'
            : 'No correct answer set: this item will need manual grading.'}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────── 单选 ─────────────────────────────── */

export const SingleChoiceEditor: React.FC<QuestionEditorProps> = (props) => (
  <OptionsEditor {...props} multiple={false} idPrefix={`sc-${props.lang}`} />
);

/* ─────────────────────────────── 多选 ─────────────────────────────── */

export const MultipleChoiceEditor: React.FC<QuestionEditorProps> = (props) => (
  <OptionsEditor {...props} multiple idPrefix={`mc-${props.lang}`} />
);

/* ─────────────────────────────── 判断 ─────────────────────────────── */

export const TrueFalseEditor: React.FC<QuestionEditorProps> = ({ config, answerKey, onChange, lang, disabled }) => {
  const key = (answerKey as any)?.value;
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-muted mb-1">{lang === 'zh' ? '正确答案' : 'Correct answer'}</legend>
      <div className="flex items-center gap-4">
        {[
          { value: true, label: String(config.trueLabel ?? (lang === 'zh' ? '正确' : 'True')) },
          { value: false, label: String(config.falseLabel ?? (lang === 'zh' ? '错误' : 'False')) },
        ].map((option) => (
          <label key={String(option.value)} className="inline-flex items-center gap-1.5 text-xs text-main">
            <input
              type="radio"
              name={`tf-${lang}`}
              checked={key === option.value}
              disabled={disabled}
              onChange={() => onChange({ config, answerKey: { value: option.value } })}
              className="accent-indigo-600"
            />
            {option.label}
          </label>
        ))}
      </div>
      {key === undefined && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {lang === 'zh' ? '未设置正确答案：该题交卷后进入人工批改。' : 'No correct answer set.'}
        </p>
      )}
    </fieldset>
  );
};

/* ─────────────────────────────── 填空 ─────────────────────────────── */

interface BlankConfig {
  id: string;
  placeholder?: string;
  inputType?: 'text' | 'numeric';
  tolerance?: number;
}

function readBlanks(config: Record<string, unknown>): BlankConfig[] {
  const raw = config.blanks;
  return Array.isArray(raw) ? (raw as BlankConfig[]) : [];
}

/** 每空的可接受答案用 `|` 分隔（比多输入框更省空间，也更容易复制粘贴）。 */
function readAccepted(answerKey: unknown, blankCount: number): string[] {
  const lists = (answerKey as any)?.blanks;
  const result: string[] = [];
  for (let i = 0; i < blankCount; i++) {
    const list = Array.isArray(lists) ? lists[i] : undefined;
    result.push(Array.isArray(list) ? list.join(' | ') : '');
  }
  return result;
}

export const FillBlankEditor: React.FC<QuestionEditorProps> = ({ config, answerKey, onChange, lang, disabled }) => {
  const blanks = readBlanks(config);
  const accepted = readAccepted(answerKey, blanks.length);

  const commit = (nextBlanks: BlankConfig[], nextAccepted: string[]) => {
    const keyLists = nextAccepted.map((text) =>
      text
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const hasAny = keyLists.some((list) => list.length > 0);
    const aligned = nextBlanks.map((_, i) => keyLists[i] ?? []);
    onChange({
      config: { ...config, blanks: nextBlanks },
      answerKey: hasAny && aligned.every((list) => list.length > 0) ? { blanks: aligned } : null,
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {lang === 'zh'
          ? '每个空一行；可接受答案用 | 分隔（任一命中即得分）。数值空按数值比较。'
          : 'One blank per row; separate accepted answers with |. Numeric blanks compare by value.'}
      </p>
      {blanks.map((blank, idx) => (
        <div key={blank.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center">
          <div>
            <FieldLabel htmlFor={`fb-accepted-${blank.id}`}>
              {lang === 'zh' ? `第 ${idx + 1} 空的可接受答案` : `Accepted answers for blank ${idx + 1}`}
            </FieldLabel>
            <input
              id={`fb-accepted-${blank.id}`}
              type="text"
              value={accepted[idx] ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const next = [...accepted];
                next[idx] = e.target.value;
                commit(blanks, next);
              }}
              placeholder={lang === 'zh' ? '光合作用 | photosynthesis' : 'photosynthesis'}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <FieldLabel htmlFor={`fb-type-${blank.id}`}>{lang === 'zh' ? '作答类型' : 'Answer type'}</FieldLabel>
            <select
              id={`fb-type-${blank.id}`}
              value={blank.inputType ?? 'text'}
              disabled={disabled}
              onChange={(e) => {
                const next = blanks.map((b, i) =>
                  i === idx ? { ...b, inputType: e.target.value as 'text' | 'numeric' } : b,
                );
                commit(next, accepted);
              }}
              className={INPUT_CLASS}
            >
              <option value="text">{lang === 'zh' ? '文本' : 'Text'}</option>
              <option value="numeric">{lang === 'zh' ? '数值' : 'Numeric'}</option>
            </select>
          </div>
          <button
            type="button"
            disabled={disabled || blanks.length <= 1}
            onClick={() => {
              const nextBlanks = blanks.filter((_, i) => i !== idx);
              commit(
                nextBlanks,
                accepted.filter((_, i) => i !== idx),
              );
            }}
            aria-label={lang === 'zh' ? `删除第 ${idx + 1} 空` : `Delete blank ${idx + 1}`}
            className="p-1 mt-4 rounded-md text-muted hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-40 cursor-pointer justify-self-start"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const id = `b${blanks.length + 1}-${Date.now().toString(36)}`;
          commit([...blanks, { id, inputType: 'text' }], [...accepted, '']);
        }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-theme text-xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
      >
        <Plus size={12} />
        {lang === 'zh' ? '添加空位' : 'Add blank'}
      </button>
      {!answerKey && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {lang === 'zh' ? '每个空都填了可接受答案后才会启用自动判分。' : 'Fill every blank to enable auto-grading.'}
        </p>
      )}
    </div>
  );
};

/* ─────────────────────────────── 简答 ─────────────────────────────── */

export const ShortAnswerEditor: React.FC<QuestionEditorProps> = ({ config, onChange, lang, disabled }) => (
  <div className="grid grid-cols-2 gap-2">
    <div>
      <FieldLabel htmlFor="sa-placeholder">{lang === 'zh' ? '作答占位提示' : 'Placeholder'}</FieldLabel>
      <input
        id="sa-placeholder"
        type="text"
        value={String(config.placeholder ?? '')}
        disabled={disabled}
        onChange={(e) => onChange({ config: { ...config, placeholder: e.target.value }, answerKey: null })}
        className={INPUT_CLASS}
      />
    </div>
    <div>
      <FieldLabel htmlFor="sa-maxlength">{lang === 'zh' ? '最多字数' : 'Max length'}</FieldLabel>
      <input
        id="sa-maxlength"
        type="number"
        min={1}
        value={Number(config.maxLength ?? 2000)}
        disabled={disabled}
        onChange={(e) =>
          onChange({ config: { ...config, maxLength: Number(e.target.value) || 2000 }, answerKey: null })
        }
        className={INPUT_CLASS}
      />
    </div>
    <p className="col-span-2 text-xs text-muted">
      {lang === 'zh' ? '简答题不自动判分，交卷后进入人工批改队列。' : 'Short answers are always graded manually.'}
    </p>
  </div>
);
