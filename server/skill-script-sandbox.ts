/**
 * skill-script-sandbox — 脚本类技能的隔离执行器。
 *
 * 边界（有意保守）：
 * - 只执行插件 manifest 内联的 JavaScript 函数体（≤32KB），不读写文件、不联网；
 * - `node:vm` 新上下文 + 禁用代码生成（eval / Function / WebAssembly）；
 * - 同步执行，硬超时（50–3000ms，默认 800ms）；
 * - 只暴露 `input`（冻结 JSON）与受限 `console`（最多 20 条 / 4KB）；
 * - 返回值必须是 JSON，并按技能 `outputKind` 归一化，非法即失败（fail-closed）。
 *
 * 注意：`vm` 不是完整的进程级安全边界。需要更强隔离的脚本应等待后续
 * worker/进程沙箱；当前实现用于「可信插件 + 管理员批准 skill:script」的场景。
 */

import vm from 'node:vm';
import {
  normalizeConfigPatch,
  normalizeLessonSegments,
  type SkillArtifact,
  type SkillDescriptor,
  type SkillSurface,
} from './skill-registry.js';

export interface SkillScriptInput {
  surface: SkillSurface;
  lessonId?: string | null;
  classId?: string | null;
  stage?: string | null;
  userInput?: string;
  lang?: 'zh' | 'en';
}

export interface SkillScriptResult {
  artifact: SkillArtifact;
  logs: string[];
  durationMs: number;
}

export class SkillScriptError extends Error {
  constructor(
    public readonly code:
      'SCRIPT_DISABLED' | 'SCRIPT_TIMEOUT' | 'SCRIPT_SYNTAX_ERROR' | 'SCRIPT_ERROR' | 'SCRIPT_INVALID_OUTPUT',
    message: string,
  ) {
    super(message);
    this.name = 'SkillScriptError';
  }
}

const MAX_LOGS = 20;
const MAX_LOG_CHARS = 4000;
const MAX_OUTPUT_BYTES = 65536;
const DEFAULT_TIMEOUT_MS = 800;
const MAX_TIMEOUT_MS = 3000;

const toSafeJson = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'Script output is not JSON-serializable');
  if (Buffer.byteLength(json, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'Script output exceeds 64KB');
  }
  return json;
};

const normalizeScriptArtifact = (skill: SkillDescriptor, raw: unknown): SkillArtifact => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'Script must return an object');
  }
  const output = JSON.parse(toSafeJson(raw)) as Record<string, unknown>;

  if (skill.outputKind === 'lesson_segments') {
    const segments = normalizeLessonSegments(output.segments);
    if (segments.length === 0) {
      throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'lesson_segments requires at least one valid segment');
    }
    return { kind: 'lesson_segments', segments };
  }
  if (skill.outputKind === 'config_patch') {
    const changes = normalizeConfigPatch(output);
    if (!changes) {
      throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'config_patch output is invalid');
    }
    return { kind: 'config_patch', changes };
  }
  if (skill.outputKind === 'classroom_card') {
    const title = typeof output.title === 'string' ? output.title.trim().slice(0, 60) : '';
    const body = typeof output.body === 'string' ? output.body.trim().slice(0, 2000) : '';
    if (!title && !body) {
      throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'classroom_card requires title or body');
    }
    return { kind: 'classroom_card', card: { title: title || '课堂小结', body } };
  }
  throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'Unsupported skill outputKind');
};

export function executeSkillScript(skill: SkillDescriptor, input: SkillScriptInput): SkillScriptResult {
  const script = skill.script;
  if (!script) {
    throw new SkillScriptError('SCRIPT_DISABLED', 'Skill has no executable script');
  }
  if (!skill.outputKind) {
    throw new SkillScriptError('SCRIPT_INVALID_OUTPUT', 'Script skill must declare outputKind');
  }

  const logs: string[] = [];
  const pushLog = (prefix: string, args: unknown[]) => {
    if (logs.length >= MAX_LOGS) return;
    const text = args
      .map((arg) => {
        try {
          return typeof arg === 'string' ? arg : JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ')
      .slice(0, 300);
    const next = `${prefix}${text}`;
    const total = logs.join('\n').length + next.length;
    if (total > MAX_LOG_CHARS) return;
    logs.push(next);
  };

  const safeConsole = Object.freeze({
    log: (...args: unknown[]) => pushLog('', args),
    info: (...args: unknown[]) => pushLog('[info] ', args),
    warn: (...args: unknown[]) => pushLog('[warn] ', args),
    error: (...args: unknown[]) => pushLog('[error] ', args),
  });

  const inputJson = toSafeJson({
    surface: input.surface,
    lessonId: input.lessonId ?? null,
    classId: input.classId ?? null,
    stage: input.stage ?? null,
    userInput: input.userInput ?? '',
    lang: input.lang ?? 'zh',
  });

  const sandbox: Record<string, unknown> = {
    __inputJson: inputJson,
    console: safeConsole,
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: `skill:${skill.id}`,
  });

  const compiled = new vm.Script(`(function(input){"use strict";\n${script.source}\n})(JSON.parse(__inputJson))`, {
    filename: `skill-script:${skill.id}`,
  });

  const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(50, script.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const startedAt = Date.now();
  let raw: unknown;
  try {
    raw = compiled.runInContext(context, { timeout, displayErrors: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Script execution timed out/i.test(message)) {
      throw new SkillScriptError('SCRIPT_TIMEOUT', `Script timed out after ${timeout}ms`);
    }
    if (err instanceof SyntaxError) {
      throw new SkillScriptError('SCRIPT_SYNTAX_ERROR', message);
    }
    throw new SkillScriptError('SCRIPT_ERROR', message);
  }

  return {
    artifact: normalizeScriptArtifact(skill, raw),
    logs,
    durationMs: Date.now() - startedAt,
  };
}
