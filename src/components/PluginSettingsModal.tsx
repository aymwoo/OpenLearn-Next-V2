/**
 * PluginSettingsModal — auto-generated settings form from manifest.configuration (V3.1).
 *
 * Renders form fields based on JSON Schema declarations:
 * - string → text input
 * - number/integer → number input with min/max
 * - boolean → toggle switch
 * - enum → select dropdown
 *
 * Reads current values from GET /api/plugins/:id/config, saves via POST.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Save, Settings } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'integer';
  default?: unknown;
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

interface ConfigSchema {
  [key: string]: ConfigProperty;
}

interface PluginSettingsModalProps {
  pluginId: string;
  pluginName: string;
  manifestStr: string;
  lang: string;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────

export function PluginSettingsModal({
  pluginId,
  pluginName,
  manifestStr,
  lang,
  onClose,
}: PluginSettingsModalProps) {
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Load config on mount — try server first, fallback to manifest
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      // Try REST API first
      const res = await fetch(`/api/plugins/${pluginId}/config`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSchema(data.result.schema);
          setValues(data.result.values);
          return;
        }
      }
    } catch {
      // Fallback: parse manifest locally
    }

    // Fallback: extract from manifest
    try {
      const manifest = JSON.parse(manifestStr);
      const props = manifest.configuration?.properties ?? {};
      setSchema(props);
      const defaults: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(props as Record<string, ConfigProperty>)) {
        defaults[key] = prop.default;
      }
      setValues(defaults);
    } catch {
      setSchema({});
    }
    setLoading(false);
  }, [pluginId, manifestStr]);

  useEffect(() => {
    loadConfig().finally(() => setLoading(false));
  }, [loadConfig]);

  // Save config
  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/plugins/${pluginId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg(lang === 'zh' ? '✓ 已保存' : '✓ Saved');
      } else {
        setSaveMsg(`✗ ${data.error}`);
      }
    } catch (e: any) {
      setSaveMsg(`✗ ${e.message}`);
    }
    setSaving(false);
  };

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaveMsg(null);
  };

  // ── Render helpers ──────────────────────────────────────────────────

  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  const renderField = (key: string, prop: ConfigProperty) => {
    const val = values[key];
    const desc = prop.description ?? '';

    switch (prop.type) {
      case 'boolean':
        return (
          <div key={key} className="flex items-center justify-between py-2.5 border-b border-gray-100">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700">{key}</label>
              {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
            </div>
            <button
              type="button"
              onClick={() => handleChange(key, !val)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                val ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  val ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        );

      case 'number':
      case 'integer':
        return (
          <div key={key} className="py-2.5 border-b border-gray-100">
            <label className="text-sm font-medium text-gray-700 block mb-1">{key}</label>
            {desc && <p className="text-xs text-gray-400 mb-1.5">{desc}</p>}
            <input
              type="number"
              step={prop.type === 'integer' ? 1 : 'any'}
              min={prop.minimum}
              max={prop.maximum}
              value={val !== undefined && val !== null ? String(val) : ''}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                handleChange(key, v);
              }}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
              placeholder={prop.default !== undefined ? String(prop.default) : ''}
            />
          </div>
        );

      default: // string
        if (prop.enum && prop.enum.length > 0) {
          return (
            <div key={key} className="py-2.5 border-b border-gray-100">
              <label className="text-sm font-medium text-gray-700 block mb-1">{key}</label>
              {desc && <p className="text-xs text-gray-400 mb-1.5">{desc}</p>}
              <select
                value={String(val ?? prop.default ?? '')}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none bg-white"
              >
                {prop.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        return (
          <div key={key} className="py-2.5 border-b border-gray-100">
            <label className="text-sm font-medium text-gray-700 block mb-1">{key}</label>
            {desc && <p className="text-xs text-gray-400 mb-1.5">{desc}</p>}
            <input
              type="text"
              value={val !== undefined && val !== null ? String(val) : ''}
              onChange={(e) => handleChange(key, e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
              placeholder={prop.default !== undefined ? String(prop.default) : ''}
            />
          </div>
        );
    }
  };

  const hasSchema = schema && Object.keys(schema).length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-gray-500" />
            <div>
              <h3 className="font-semibold text-gray-800 text-sm">
                {t('插件设置', 'Plugin Settings')}
              </h3>
              <p className="text-xs text-gray-400">{pluginName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-gray-400 animate-spin" />
            </div>
          ) : !hasSchema ? (
            <div className="text-center py-8">
              <Settings size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-400">
                {t('此插件没有可配置项。', 'This plugin has no configurable settings.')}
              </p>
              <p className="text-xs text-gray-300 mt-1">
                {t('在 manifest.configuration 中声明配置项即可在此处显示。', 'Declare settings in manifest.configuration to see them here.')}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {Object.entries(schema).map(([key, prop]) => renderField(key, prop))}
            </div>
          )}
        </div>

        {/* Footer */}
        {hasSchema && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-between">
            {saveMsg && (
              <span className={`text-xs ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                {saveMsg}
              </span>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {t('保存', 'Save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
