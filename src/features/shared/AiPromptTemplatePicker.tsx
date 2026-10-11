import React, { useMemo, useState } from 'react';
import { BookMarked, X } from 'lucide-react';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';

/**
 * AiPromptTemplatePicker —— ai.prompt.template 槽位的聊天输入区消费端。
 *
 * v0.6.0 审计遗留：该槽位此前只有 schema 与 store 登记、无任何消费方。
 * 现在挂载在 Agent 聊天输入框旁：插件贡献的提示词模板（含 {{参数}} 占位）
 * 经此选择、填参、渲染后插入输入框。
 *
 * 模板来源：extensionPoints.get('ai.prompt.template')（manifest contributes
 * 通用桥接 / 插件代码注册均可到达），slotProps 即完整模板配置
 * { title, description?, category?, prompt, parameters?[{name,label,default?}] }。
 */

interface TemplateEntry {
  id: string;
  slotProps?: {
    title?: string;
    description?: string;
    prompt?: string;
    parameters?: Array<{ name: string; label?: string; default?: string }>;
  };
}

/** 渲染模板：{{name}} 占位以填参替换（无填参时回退 default，再回退空串） */
export const renderPromptTemplate = (
  prompt: string,
  parameters: Array<{ name: string; default?: string }> | undefined,
  values: Record<string, string>,
): string =>
  prompt.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, name: string) => {
    const typed = values[name];
    if (typed !== undefined && typed !== '') return typed;
    const fallback = parameters?.find((p) => p.name === name)?.default;
    return fallback ?? `{{${name}}}`;
  });

export function AiPromptTemplatePicker({
  setInput,
  currentInput,
  lang = 'zh',
}: {
  setInput: (v: string) => void;
  currentInput?: string;
  lang?: string;
}) {
  const extensionPoints = usePluginHostStore((s) => s.extensionPoints);
  const [open, setOpen] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const templates = useMemo(
    () => (extensionPoints.get('ai.prompt.template') ?? []) as unknown as TemplateEntry[],
    [extensionPoints],
  );
  const zh = lang === 'zh';
  const activeTemplate = templates.find((t) => t.id === activeTemplateId);

  if (templates.length === 0) return null;

  const insertTemplate = (entry: TemplateEntry, values: Record<string, string>) => {
    const prompt = entry.slotProps?.prompt ?? '';
    const rendered = renderPromptTemplate(prompt, entry.slotProps?.parameters, values);
    // 追加而非覆盖：尊重输入框已有内容
    setInput(currentInput ? `${currentInput.trimEnd()}\n\n${rendered}` : rendered);
    setOpen(false);
    setActiveTemplateId(null);
    setParamValues({});
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={activeTemplateId !== null && !!activeTemplate}
        className={`p-1 px-1.5 rounded-full transition-colors cursor-pointer ${
          open ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500 hover:text-indigo-600 hover:bg-gray-100'
        }`}
        title={zh ? '插件提示词模板' : 'Plugin prompt templates'}
      >
        <BookMarked size={14} />
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-80 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-40 text-xs">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 sticky top-0 bg-white">
            <span className="font-semibold text-gray-700">{zh ? '插件提示词模板' : 'Prompt templates'}</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setActiveTemplateId(null);
              }}
              className="text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>

          {!activeTemplate ? (
            <div className="py-1">
              {templates.map((entry) => {
                const title = entry.slotProps?.title || entry.id;
                const description = entry.slotProps?.description;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      const params = entry.slotProps?.parameters ?? [];
                      if (params.length > 0) {
                        // 预填默认值后进入填参态
                        const prefilled: Record<string, string> = {};
                        for (const p of params) if (p.default) prefilled[p.name] = p.default;
                        setParamValues(prefilled);
                        setActiveTemplateId(entry.id);
                      } else {
                        insertTemplate(entry, {});
                      }
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors cursor-pointer"
                  >
                    <div className="font-medium text-gray-800">{title}</div>
                    {description && <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{description}</div>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-3 space-y-2">
              <div className="font-medium text-gray-800">{activeTemplate.slotProps?.title || activeTemplate.id}</div>
              {(activeTemplate.slotProps?.parameters ?? []).map((p) => (
                <label key={p.name} className="block">
                  <span className="text-[11px] text-gray-500">{p.label || p.name}</span>
                  <input
                    value={paramValues[p.name] ?? ''}
                    onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    className="mt-0.5 w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                    placeholder={p.default || p.name}
                  />
                </label>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => insertTemplate(activeTemplate, paramValues)}
                  className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors cursor-pointer"
                >
                  {zh ? '插入到输入框' : 'Insert'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTemplateId(null)}
                  className="px-3 py-1.5 text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition-colors cursor-pointer"
                >
                  {zh ? '返回' : 'Back'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
