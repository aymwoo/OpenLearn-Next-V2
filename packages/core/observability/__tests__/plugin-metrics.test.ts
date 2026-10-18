/**
 * 按插件维度的运行指标（Issue #150）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_PLUGIN_METRIC_ENTRIES,
  OVERFLOW_PLUGIN_LABEL,
  pluginIdFromActor,
  pluginIdFromCommandType,
  pluginMetricEntryCount,
  recordPluginCommand,
  recordPluginEvent,
  recordPluginHttp,
  recordWorkerCrash,
  recordWorkerRestart,
  renderPluginMetrics,
  resetPluginMetricsForTests,
  setPluginNamespaceResolver,
} from '../plugin-metrics.js';

afterEach(() => {
  resetPluginMetricsForTests();
});

describe('插件指标 · 归因', () => {
  it('actor 以 plugin: 开头时取 manifest id', () => {
    expect(pluginIdFromActor('plugin:@ext/class-manager')).toBe('@ext/class-manager');
    expect(pluginIdFromActor('user:teacher-1')).toBeUndefined();
    expect(pluginIdFromActor(undefined)).toBeUndefined();
  });

  it('命令命名空间优先走内核注入的解析器（只认已安装插件）', () => {
    // 未注入解析器时，只认 npm 作用域形式
    expect(pluginIdFromCommandType('@ext/class-manager.class_list')).toBe('@ext/class-manager');
    expect(pluginIdFromCommandType('lesson.create')).toBeUndefined();

    setPluginNamespaceResolver((namespace) => (namespace === 'demo-plugin' ? namespace : undefined));
    expect(pluginIdFromCommandType('demo-plugin.do_thing')).toBe('demo-plugin');
    // 解析器说不是插件，就仍不归因（避免把核心命令记到插件头上）
    expect(pluginIdFromCommandType('lesson.create')).toBeUndefined();
  });

  it('事件只统计 source=plugin:<id>', () => {
    recordPluginEvent('plugin:@ext/demo');
    recordPluginEvent('system');
    recordPluginEvent(undefined);
    const text = renderPluginMetrics();
    expect(text).toContain('openlearn_plugin_events_total{plugin="@ext/demo"} 1');
    expect(text).not.toContain('plugin="system"');
  });
});

describe('插件指标 · 计数与渲染', () => {
  it('命令成功/失败与耗时按插件累计', () => {
    recordPluginCommand('@ext/demo', true, 10);
    recordPluginCommand('@ext/demo', true, 30);
    recordPluginCommand('@ext/demo', false, 5);

    const text = renderPluginMetrics();
    expect(text).toContain('openlearn_plugin_commands_total{plugin="@ext/demo",result="ok"} 2');
    expect(text).toContain('openlearn_plugin_commands_total{plugin="@ext/demo",result="error"} 1');
    expect(text).toContain('openlearn_plugin_command_duration_seconds_sum{plugin="@ext/demo"} 0.045');
    expect(text).toContain('openlearn_plugin_command_duration_seconds_count{plugin="@ext/demo"} 3');
  });

  it('HTTP 按状态码分类累计', () => {
    recordPluginHttp('@ext/demo', 200, 12);
    recordPluginHttp('@ext/demo', 404, 3);
    recordPluginHttp('@ext/demo', 500, 1);
    recordPluginHttp('@ext/demo', 302, 1);
    recordPluginHttp('@ext/demo', 999, 1);

    const text = renderPluginMetrics();
    expect(text).toContain('openlearn_plugin_http_requests_total{plugin="@ext/demo",status="2xx"} 1');
    expect(text).toContain('openlearn_plugin_http_requests_total{plugin="@ext/demo",status="3xx"} 1');
    expect(text).toContain('openlearn_plugin_http_requests_total{plugin="@ext/demo",status="4xx"} 1');
    expect(text).toContain('openlearn_plugin_http_requests_total{plugin="@ext/demo",status="5xx"} 1');
    expect(text).toContain('openlearn_plugin_http_requests_total{plugin="@ext/demo",status="other"} 1');
  });

  it('worker 崩溃与重启分别计数', () => {
    recordWorkerCrash('@ext/demo');
    recordWorkerCrash('@ext/demo');
    recordWorkerRestart('@ext/demo');
    const text = renderPluginMetrics();
    expect(text).toContain('openlearn_plugin_worker_crashes_total{plugin="@ext/demo"} 2');
    expect(text).toContain('openlearn_plugin_worker_restarts_total{plugin="@ext/demo"} 1');
  });

  it('没有记录时输出空串（不在无插件部署里刷空样本）', () => {
    expect(renderPluginMetrics()).toBe('');
  });

  it('label 值做 Prometheus 转义，非法输入不抛错', () => {
    recordPluginCommand('evil"plugin\\name\nline', true, 1);
    const text = renderPluginMetrics();
    expect(text).toContain('plugin="evil\\"plugin\\\\name\\nline"');
    expect(() => recordPluginCommand(undefined, true, 1)).not.toThrow();
    expect(() => recordPluginHttp(undefined, 200, 1)).not.toThrow();
  });

  it('插件数量超过上限后落到 overflow，避免 label 基数失控', () => {
    for (let i = 0; i < MAX_PLUGIN_METRIC_ENTRIES + 5; i += 1) {
      recordPluginCommand(`plugin-${i}`, true, 1);
    }
    expect(pluginMetricEntryCount()).toBe(MAX_PLUGIN_METRIC_ENTRIES + 1);
    expect(renderPluginMetrics()).toContain(`plugin="${OVERFLOW_PLUGIN_LABEL}"`);
  });
});
