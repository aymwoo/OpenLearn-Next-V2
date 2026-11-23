/**
 * 填表活动：按教师配置的字段收集结构化信息。
 */
import { useState } from 'react';
import { parseActivityConfig, readFormConfig, readSubmittedAnswers } from '../../../xuean/activity-config';
import { isActivityDone, submitActivityModule, type StudentActivityModuleProps } from './module-shared';

type FieldValue = string | boolean;

export function FormActivityCard({
  activity,
  progress,
  lang = 'zh',
  onProgressUpdated,
  onActivityProgressReported,
}: StudentActivityModuleProps) {
  const zh = lang === 'zh';
  const config = parseActivityConfig(activity.config_json);
  const { description, fields } = readFormConfig(config);
  const initialAnswers = readSubmittedAnswers(progress?.submission_json).payload?.answers ?? {};

  const [answers, setAnswers] = useState<Record<string, FieldValue>>(() => {
    const next: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(initialAnswers)) {
      next[key] = Array.isArray(value) ? value.join('、') : value;
    }
    return next;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const done = isActivityDone(progress);

  const update = (fieldId: string, value: FieldValue) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  };

  const submit = async () => {
    for (const field of fields) {
      if (!field.required) continue;
      const value = answers[field.id];
      const empty = field.type === 'checkbox' ? value !== true : !String(value ?? '').trim();
      if (empty) {
        setError(
          zh
            ? `请填写「${field.label || `字段 ${fields.indexOf(field) + 1}`}」`
            : 'Please complete all required fields',
        );
        return;
      }
    }
    setBusy(true);
    setError(null);
    const result = await submitActivityModule(
      activity.id,
      { type: 'text', content: JSON.stringify({ answers }) },
      { onProgressUpdated, onActivityProgressReported },
    );
    if (result.ok) setSaved(true);
    else setError(result.error);
    setBusy(false);
  };

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40';

  return (
    <form
      className="mt-3 space-y-3"
      data-testid="form-activity-module"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {description ? (
        <div className="rounded-lg border border-theme/60 bg-surface-secondary/40 p-3 text-sm text-main whitespace-pre-wrap">
          {description}
        </div>
      ) : null}
      {fields.length === 0 ? (
        <p className="text-xs text-muted">{zh ? '教师尚未添加表单字段。' : 'No form fields yet.'}</p>
      ) : null}
      {fields.map((field, index) => {
        const value = answers[field.id];
        const label = field.label || (zh ? `字段 ${index + 1}` : `Field ${index + 1}`);
        const empty = field.type === 'checkbox' ? value !== true : !String(value ?? '').trim();
        const invalid = Boolean(error) && field.required && empty;
        return (
          <div key={field.id} className="space-y-1">
            <label className="block text-xs font-semibold text-main" htmlFor={`form-${activity.id}-${field.id}`}>
              {label}
              {field.required ? <span className="ml-1 text-rose-600">*</span> : null}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                id={`form-${activity.id}-${field.id}`}
                value={String(value ?? '')}
                onChange={(event) => update(field.id, event.target.value)}
                required={field.required}
                aria-invalid={invalid}
                aria-describedby="form-activity-error"
                rows={3}
                className={inputClass}
              />
            ) : field.type === 'select' ? (
              <select
                id={`form-${activity.id}-${field.id}`}
                value={String(value ?? '')}
                onChange={(event) => update(field.id, event.target.value)}
                required={field.required}
                aria-invalid={invalid}
                aria-describedby="form-activity-error"
                className={inputClass}
              >
                <option value="">{zh ? '请选择' : 'Select'}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm text-main cursor-pointer">
                <input
                  id={`form-${activity.id}-${field.id}`}
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => update(field.id, event.target.checked)}
                  required={field.required}
                  aria-invalid={invalid}
                  aria-describedby="form-activity-error"
                  className="accent-primary-theme"
                />
                {zh ? '是' : 'Yes'}
              </label>
            ) : (
              <input
                id={`form-${activity.id}-${field.id}`}
                type={field.type === 'number' ? 'number' : 'text'}
                value={String(value ?? '')}
                onChange={(event) => update(field.id, event.target.value)}
                required={field.required}
                aria-invalid={invalid}
                aria-describedby="form-activity-error"
                className={inputClass}
              />
            )}
          </div>
        );
      })}
      {fields.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? zh
                ? '提交中…'
                : 'Submitting…'
              : done || saved
                ? zh
                  ? '更新填表'
                  : 'Update'
                : zh
                  ? '提交填表'
                  : 'Submit'}
          </button>
          {(done || saved) && !error ? (
            <span className="text-xs font-semibold text-emerald-600">{zh ? '已提交' : 'Submitted'}</span>
          ) : null}
          {error && (
            <span id="form-activity-error" role="alert" className="text-xs text-rose-600">
              {error}
            </span>
          )}
        </div>
      ) : null}
    </form>
  );
}
