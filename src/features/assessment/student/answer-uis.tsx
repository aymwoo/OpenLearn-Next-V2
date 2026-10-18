/**
 * 5 种内置题型的**学生作答组件**（Issue #100 / #122）。
 *
 * 作答值的形状必须与 `packages/core/assessment/question-types/builtin.ts` 的判分器一致：
 * | 题型 | 作答值 |
 * | --- | --- |
 * | single_choice | `number`（选项索引） |
 * | multiple_choice | `number[]`（索引数组，升序去重） |
 * | true_false | `boolean` |
 * | fill_blank | `string[]`（按空位顺序；单空也发数组，服务端两种都认） |
 * | short_answer | `string` |
 *
 * a11y：单选/多选用 fieldset + legend + 原生 input 关联 label，作答页在 a11y 门禁覆盖范围内。
 */
import React from 'react';
import type { QuestionAnswerProps } from '../question-type-ui-registry';

const INPUT_CLASS =
  'w-full px-3 py-2 border border-theme rounded-xl text-sm bg-surface text-main focus:outline-none focus:ring-2 focus:ring-indigo-500';

function readOptions(config: Record<string, unknown>): string[] {
  const raw = config.options;
  return Array.isArray(raw) ? raw.map((o) => String(o)) : [];
}

function optionLabel(idx: number): string {
  return String.fromCharCode(65 + idx);
}

const OptionList: React.FC<QuestionAnswerProps & { multiple: boolean; name: string }> = ({
  config,
  value,
  onChange,
  lang,
  readOnly,
  multiple,
  name,
}) => {
  const options = readOptions(config);
  const selectedSingle = typeof value === 'number' ? value : null;
  const selectedMulti = Array.isArray(value) ? value.map(Number).filter((n) => Number.isInteger(n)) : [];

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">
        {multiple ? (lang === 'zh' ? '可多选' : 'Select all that apply') : lang === 'zh' ? '单选' : 'Pick one'}
      </legend>
      {options.map((opt, idx) => {
        const checked = multiple ? selectedMulti.includes(idx) : selectedSingle === idx;
        return (
          <label
            key={idx}
            className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
              checked
                ? 'border-indigo-400 bg-indigo-50 text-main dark:bg-indigo-950/40'
                : 'border-theme bg-surface text-main hover:border-indigo-300'
            } ${readOnly ? 'cursor-default' : ''}`}
          >
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={name}
              checked={checked}
              disabled={readOnly}
              onChange={(e) => {
                if (readOnly) return;
                if (multiple) {
                  const next = e.target.checked
                    ? [...new Set([...selectedMulti, idx])].sort((a, b) => a - b)
                    : selectedMulti.filter((i) => i !== idx);
                  onChange(next);
                } else {
                  onChange(idx);
                }
              }}
              className="mt-0.5 accent-indigo-600 shrink-0"
            />
            <span className="text-sm leading-snug">
              <span className="font-bold text-muted mr-1.5">{optionLabel(idx)}.</span>
              {opt}
            </span>
          </label>
        );
      })}
      <p className="text-2xs text-muted">
        {multiple
          ? lang === 'zh'
            ? '可多选：全对得满分，少选按命中比例给分，错选不得分。'
            : 'Select all: full marks for all correct, partial credit for fewer, zero for wrong picks.'
          : lang === 'zh'
            ? '单选题'
            : 'Single choice'}
      </p>
    </fieldset>
  );
};

export const SingleChoiceAnswer: React.FC<QuestionAnswerProps> = (props) => (
  <OptionList {...props} multiple={false} name="answer-single" />
);

export const MultipleChoiceAnswer: React.FC<QuestionAnswerProps> = (props) => (
  <OptionList {...props} multiple name="answer-multi" />
);

export const TrueFalseAnswer: React.FC<QuestionAnswerProps> = ({ config, value, onChange, lang, readOnly }) => {
  const options = [
    { v: true, label: String(config.trueLabel ?? (lang === 'zh' ? '正确' : 'True')) },
    { v: false, label: String(config.falseLabel ?? (lang === 'zh' ? '错误' : 'False')) },
  ];
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{lang === 'zh' ? '判断' : 'True or false'}</legend>
      {options.map((opt) => (
        <label
          key={String(opt.v)}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm cursor-pointer ${
            value === opt.v
              ? 'border-indigo-400 bg-indigo-50 text-main dark:bg-indigo-950/40'
              : 'border-theme bg-surface text-main hover:border-indigo-300'
          }`}
        >
          <input
            type="radio"
            name="answer-tf"
            checked={value === opt.v}
            disabled={readOnly}
            onChange={() => !readOnly && onChange(opt.v)}
            className="accent-indigo-600"
          />
          {opt.label}
        </label>
      ))}
    </fieldset>
  );
};

interface BlankConfig {
  id: string;
  placeholder?: string;
  inputType?: 'text' | 'numeric';
}

export const FillBlankAnswer: React.FC<QuestionAnswerProps> = ({ config, value, onChange, lang, readOnly }) => {
  const blanks = Array.isArray(config.blanks) ? (config.blanks as BlankConfig[]) : [];
  const answers: unknown[] = Array.isArray(value) ? value : blanks.map(() => '');
  return (
    <div className="space-y-2">
      {blanks.map((blank, idx) => (
        <div key={blank.id}>
          <label htmlFor={`blank-${blank.id}`} className="block text-2xs font-semibold text-muted mb-1">
            {lang === 'zh' ? `第 ${idx + 1} 空` : `Blank ${idx + 1}`}
          </label>
          <input
            id={`blank-${blank.id}`}
            type={blank.inputType === 'numeric' ? 'number' : 'text'}
            value={String(answers[idx] ?? '')}
            disabled={readOnly}
            placeholder={blank.placeholder}
            onChange={(e) => {
              const next = blanks.map((_, i) => (i === idx ? e.target.value : String(answers[i] ?? '')));
              onChange(next);
            }}
            className={INPUT_CLASS}
          />
        </div>
      ))}
    </div>
  );
};

export const ShortAnswerAnswer: React.FC<QuestionAnswerProps> = ({ config, value, onChange, lang, readOnly }) => {
  const maxLength = typeof config.maxLength === 'number' ? config.maxLength : 2000;
  const text = typeof value === 'string' ? value : '';
  return (
    <div>
      <label htmlFor="short-answer" className="sr-only">
        {lang === 'zh' ? '作答内容' : 'Your answer'}
      </label>
      <textarea
        id="short-answer"
        rows={6}
        value={text}
        maxLength={maxLength}
        disabled={readOnly}
        placeholder={String(config.placeholder ?? (lang === 'zh' ? '请输入你的作答' : 'Type your answer'))}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} resize-y`}
      />
      <p className="text-2xs text-muted mt-1 text-right">
        {text.length}/{maxLength}
      </p>
    </div>
  );
};

/** 未知题型的兜底作答：把作答值当 JSON 文本处理（插件题型没提供 Answer 组件时用）。 */
export const FallbackAnswer: React.FC<QuestionAnswerProps> = ({ value, onChange, lang, readOnly }) => {
  const [text, setText] = React.useState(() => {
    try {
      return value === undefined || value === null ? '' : JSON.stringify(value);
    } catch {
      return '';
    }
  });
  return (
    <div>
      <label htmlFor="fallback-answer" className="block text-2xs font-semibold text-muted mb-1">
        {lang === 'zh' ? '作答（JSON）' : 'Answer (JSON)'}
      </label>
      <textarea
        id="fallback-answer"
        rows={4}
        value={text}
        disabled={readOnly}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(e.target.value.trim() ? JSON.parse(e.target.value) : null);
          } catch {
            onChange(e.target.value);
          }
        }}
        className={`${INPUT_CLASS} resize-y font-mono`}
      />
    </div>
  );
};
