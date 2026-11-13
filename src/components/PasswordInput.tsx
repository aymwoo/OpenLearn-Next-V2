import React, { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface PasswordInputProps {
  id?: string;
  name?: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  pattern?: string;
  placeholder?: string;
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  error?: string | null;
  lang?: 'zh' | 'en';
  className?: string;
  labelClassName?: string;
  wrapperClassName?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  dataTestId?: string;
}

/**
 * Accessible password field with associated <label>, persistent top hint,
 * conditional inline error linked via `aria-describedby` only while shown,
 * and an accessible Show/Hide password toggle button (`aria-pressed`).
 */
export function PasswordInput({
  id,
  name,
  label,
  hint,
  value,
  onChange,
  onBlur,
  autoComplete,
  required = false,
  minLength,
  pattern,
  placeholder,
  enterKeyHint,
  error,
  lang = 'zh',
  className = 'w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-sm text-slate-800 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
  labelClassName = 'block text-xs font-medium text-slate-600 mb-1',
  wrapperClassName = 'space-y-1',
  inputRef,
  dataTestId,
}: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [revealed, setRevealed] = useState(false);

  const hasError = Boolean(error && error.trim().length > 0);
  const describedByIds = [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ') || undefined;

  const toggleLabel =
    lang === 'zh' ? (revealed ? '隐藏密码' : '显示密码') : revealed ? 'Hide password' : 'Show password';

  return (
    <div className={wrapperClassName}>
      <label htmlFor={inputId} className={labelClassName}>
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          name={name || inputId}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          pattern={pattern}
          placeholder={placeholder}
          enterKeyHint={enterKeyHint}
          aria-invalid={hasError ? 'true' : 'false'}
          aria-describedby={describedByIds}
          data-testid={dataTestId}
          className={className}
        />
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-pressed={revealed}
          aria-label={toggleLabel}
          className="absolute inset-y-0 end-0 flex items-center justify-center px-2.5 text-slate-500 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-e-lg cursor-pointer"
        >
          {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      {hasError && (
        <p id={errorId} className="text-xs text-red-600 flex items-center gap-1" role="status">
          <span role="img" aria-label={lang === 'zh' ? '错误' : 'Error'}>
            ⚠
          </span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
