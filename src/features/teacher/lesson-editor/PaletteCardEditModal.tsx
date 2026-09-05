import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { PaletteItemConfig, COLOR_THEME, SelectOption } from './paletteConfig';

interface PaletteCardEditModalProps {
  config: PaletteItemConfig;
  lang: 'zh' | 'en';
  initialData: Record<string, any>;
  onConfirm: (data: Record<string, any>) => void;
  onCancel: () => void;
}

export function PaletteCardEditModal({
  config,
  lang,
  initialData,
  onConfirm,
  onCancel,
}: PaletteCardEditModalProps) {
  const [data, setData] = useState<Record<string, any>>(() => ({ ...initialData }));
  const [selectOptions, setSelectOptions] = useState<Record<string, SelectOption[]>>({});
  const Icon = config.icon;
  const theme = COLOR_THEME[config.color];

  // 动态加载 select 字段的选项
  useEffect(() => {
    let cancelled = false;
    const selectFields = config.editFields.filter((f) => f.kind === 'select' && f.loadOptions);
    if (selectFields.length === 0) return;
    Promise.all(
      selectFields.map(async (f) => {
        try {
          const opts = await f.loadOptions!();
          return [f.key, opts] as const;
        } catch {
          return [f.key, []] as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setSelectOptions(Object.fromEntries(results));
    });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const setField = (key: string, value: any) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const options: string[] = Array.isArray(data.options) ? data.options : [];
  const setOption = (idx: number, val: string) => {
    setData((prev) => ({ ...prev, options: options.map((o, i) => (i === idx ? val : o)) }));
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${theme.iconBg} ${theme.iconText}`}>
              <Icon size={18} />
            </div>
            <h2 className="font-bold text-gray-800 text-base">
              {lang === 'zh' ? `编辑：${config.labelZh}` : `Edit: ${config.labelEn}`}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 font-bold p-1 hover:bg-gray-200 rounded transition-colors text-lg"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {config.editFields.length === 0 ? (
            <p className="text-sm text-gray-500 leading-relaxed">
              {lang === 'zh'
                ? '该组件无需预编辑内容，确认后即可添加到画板。'
                : 'No content to edit for this component. Confirm to add it to the board.'}
            </p>
          ) : (
            config.editFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600">
                  {lang === 'zh' ? f.labelZh : f.labelEn}
                </label>
                {f.kind === 'options' ? (
                  <div className="grid grid-cols-2 gap-2">
                    {options.map((opt, i) => (
                      <input
                        key={i}
                        value={opt}
                        onChange={(e) => setOption(i, e.target.value)}
                        placeholder={`${String.fromCharCode(65 + i)}`}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ))}
                  </div>
                ) : f.kind === 'textarea' ? (
                  <textarea
                    value={data[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={lang === 'zh' ? f.placeholderZh : f.placeholderEn}
                    rows={5}
                    className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y ${
                      f.key === 'code' || f.key === 'markdown' ? 'font-mono text-[12px]' : ''
                    }`}
                  />
                ) : f.kind === 'select' ? (
                  <select
                    value={data[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    <option value="">{lang === 'zh' ? '— 不选择 —' : '— None —'}</option>
                    {(selectOptions[f.key] ?? f.options ?? []).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={data[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={lang === 'zh' ? f.placeholderZh : f.placeholderEn}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer"
          >
            {lang === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={() => onConfirm(data)}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
          >
            {lang === 'zh' ? '添加到画板' : 'Add to Board'}
          </button>
        </div>
      </div>
    </div>
  );
}
