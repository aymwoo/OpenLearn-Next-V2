/**
 * SDK 契约漂移分析器（审计 E-2）。
 *
 * 用 TypeScript 编译器 API 从两个入口出发，沿 `export … from` 广度遍历，
 * 收集「可达的导出符号 + 其成员」，从而把两侧做**成员级**比对。
 *
 * 为什么不用正则：正则只能看名字，看不到 `interface Foo { a; b }` 的成员，
 * 对 130 个幽灵类型里的 61 个「带成员」项完全失明 —— 这正是旧 parity 测试
 * 只断言 Token 名集合却对 156 项漂移无感的原因。
 *
 * 两个入口的差异：
 * - `packages/plugin-sdk/index.ts` —— 普通模块，导出带 `export` 修饰符或
 *   分散在各 `export { … } from '…'` 块里，符号本体在其源文件中；
 * - `packages/plugin-sdk/openlearn.d.ts` —— **环境声明文件**，144 个声明中
 *   只有 1 个带 `export` 修饰符，全部导出集中在文件末尾的 `export { … }` 块。
 *
 * 类成员只取 **public** 面：private/protected 不是 SDK 契约的一部分，
 * 把它们算进去会给 `PluginHost` 之类产生几十条假漂移。
 */

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

/** 一个导出符号的成员面 */
export interface SymbolSurface {
  /** 成员名（可选成员带 `?` 后缀） */
  members: string[];
  /** 声明所在文件（诊断用） */
  file: string;
  /**
   * 是否为**运行时值**（class / const / function / enum）。
   *
   * 这决定了「d.ts 声明但 index.ts 未导出」的严重性：
   * TypeScript 解析 `@openlearn/plugin-sdk` 走 package.json 的 `types` 字段
   * → `dist/index.d.ts`（即 openlearn.d.ts 的副本），**不经过 index.ts**。
   * 因此**纯类型**符号只在 d.ts 里声明是完全可用的（实测见 sdk-drift-parity.test.ts），
   * 而 class / const 这类**运行时值**若 index.ts 未导出，插件 import 即报
   * `TS2693: only refers to a type, but is being used as a value`。
   */
  isValue: boolean;
}

export interface DriftReport {
  /** 诊断：两侧实际收集到的符号总数（用于防空跑假绿 —— 解析失效时会是 0） */
  collected: { index: number; dts: number };
  /** index.ts 有、d.ts 未声明 —— 第三方插件 import 即 TS2305 */
  ghost: Array<{ name: string; surface: SymbolSurface }>;
  /**
   * d.ts 声明了、index.ts 未导出。
   *
   * - `reverseValues`：**运行时值**（class/const/function）—— 真问题，
   *   插件 `import { X }`（非 type-only）会 TS2693。必须清零。
   * - `reverseTypes`：纯类型符号 —— **无害**。TS 解析走 `dist/index.d.ts`，
   *   不经过 index.ts，故这些类型对插件完全可用（实测见 sdk-drift-parity.test.ts）。
   *   仅作信息性记录，不作为失败条件。
   */
  reverseValues: Array<{ name: string; surface: SymbolSurface }>;
  reverseTypes: Array<{ name: string; surface: SymbolSurface }>;
  /** 两侧都有符号，但成员集不同 */
  memberDrift: Array<{ name: string; onlyIndex: string[]; onlyDts: string[] }>;
}

function parseFile(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** `.js` specifier → 实际 `.ts` 源文件（ESM 风格 import 在源码里指向 .js） */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), `${base}.ts`, base];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function memberNameOf(m: ts.ClassElement | ts.TypeElement): string | null {
  if (!m.name) return null; // 构造签名 / 索引签名：SDK 侧视为不透明
  const name = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : m.name.getText();
  const optional = 'questionToken' in m && m.questionToken ? '?' : '';
  return name + optional;
}

function typeLiteralMembers(t: ts.TypeNode): string[] {
  if (!ts.isTypeLiteralNode(t)) return [];
  return t.members.map(memberNameOf).filter((x): x is string => x !== null);
}

/** 抽取单个源文件里「本文件直接声明」的符号面 */
function declaredIn(sf: ts.SourceFile): Map<string, SymbolSurface> {
  const out = new Map<string, SymbolSurface>();
  const ambient = sf.isDeclarationFile;

  for (const st of sf.statements) {
    // 非 ambient 文件里的 `export … from` 是**转发**，本体在目标文件。
    // 注意：ExportDeclaration 节点本身**没有 modifier**，所以必须放在下面的
    // export 修饰符过滤**之前**处理，否则会被 `continue` 提前跳过。
    if (!ambient && ts.isExportDeclaration(st)) {
      if (
        st.moduleSpecifier &&
        ts.isStringLiteral(st.moduleSpecifier) &&
        st.exportClause &&
        ts.isNamedExports(st.exportClause)
      ) {
        for (const e of st.exportClause.elements) {
          const local = e.name.text;
          if (!out.has(local)) out.set(local, { members: [], file: sf.fileName, isValue: false });
        }
      }
      continue;
    }

    const mods = ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (!ambient && !exported && !isDefault) continue;

    if (ts.isInterfaceDeclaration(st) && st.name) {
      out.set(st.name.text, {
        members: st.members.map(memberNameOf).filter((x): x is string => x !== null),
        file: sf.fileName,
        isValue: false,
      });
    } else if (ts.isClassDeclaration(st) && st.name) {
      const members = st.members
        .filter((m) => {
          if (!ts.isMethodDeclaration(m) && !ts.isPropertyDeclaration(m) && !ts.isGetAccessorDeclaration(m)) {
            return false;
          }
          const mm = ts.getModifiers(m) ?? [];
          return !mm.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword);
        })
        .map(memberNameOf)
        .filter((x): x is string => x !== null);
      // 注意：**不把构造函数参数属性计入成员面**。
      // `constructor(readonly pluginHost: PluginHost)` 既是构造参数也是属性，
      // 计入后会产生两类假漂移：① 与同名真实属性重复；
      // ② `version = '1.0.0'` 与 `version?: string` 的差异被误报为成员不一致
      //   （那是构造函数签名的细节，不是「插件能看到的成员」差异）。
      out.set(st.name.text, { members: [...new Set(members)].sort(), file: sf.fileName, isValue: true });
    } else if (ts.isTypeAliasDeclaration(st) && st.name) {
      out.set(st.name.text, { members: typeLiteralMembers(st.type), file: sf.fileName, isValue: false });
    } else if (ts.isEnumDeclaration(st) && st.name) {
      // **enum 是运行时值**（编译后产出对象），必须收集 ——
      // 早期版本漏了 EnumDeclaration，导致 `PluginState` 这类 declare enum
      // 在 d.ts 侧查不到，被误报成「index 导出但 d.ts 未声明」的幽灵符号。
      out.set(st.name.text, { members: [], file: sf.fileName, isValue: true });
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      out.set(st.name.text, { members: [], file: sf.fileName, isValue: true });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) out.set(d.name.text, { members: [], file: sf.fileName, isValue: true });
      }
    }
  }
  return out;
}

/**
 * 再导出目标：具名 `export { A, B } from './x.js'` → 符号名；
 * `export * from './x.js'` → `*`（表示「全部导出」，需展开）。
 *
 * **必须支持 `export * from`**：本仓库每个 barrel 文件都有十几条
 * `export * from './xxx.js'`（如 `packages/core/capability/index.ts` 有 13 条）。
 * 早期版本只处理具名再导出，导致 activity-ecosystem 等模块的所有类型
 * 在 index 侧「查不到」→ 产生大批**假反向漂移与假幽灵符号**。
 */
function reExportTargets(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st)) continue;
    if (!st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const from = st.moduleSpecifier.text;
    if (!st.exportClause) {
      out.set('*', from); // export * from
      continue;
    }
    if (ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) {
        out.set(e.propertyName?.text ?? e.name.text, from);
      }
    }
  }
  return out;
}

/**
 * 广度遍历，收集「从入口真正导出」的符号面。
 *
 * ## 关键：必须区分「可达」与「已导出」
 *
 * 早期版本只做可达性遍历（遇到 `export … from` 就跟过去），把「模块图里能走到」
 * 当成「入口导出了」。这是错的，而且错得很隐蔽：
 *
 * ```ts
 * // packages/activity-ecosystem/index.ts
 * export * from './registry.js';        // ← ActivityRegistry 从这里导出
 *
 * // packages/plugin-sdk/index.ts
 * export type { ActivityCategory, … } from '../activity-ecosystem/index.js';  // ← 但 SDK 只挑了这些
 * ```
 *
 * `ActivityRegistry` 在 activity-ecosystem 的 surface 上是导出的，但 SDK 入口用的是
 * **选择性**再导出，并未把它带出来。若按可达性判定，插件 `import { ActivityRegistry }
 * from '@openlearn/plugin-sdk'` 会被误判为「已导出」，而实际运行时报 TS2693。
 *
 * 因此这里沿链传播「允许的名字集」：
 * - `export * from X`   → 允许集 = X 的全部导出
 * - `export { A, B } from X` → 允许集 = {A, B}
 * - 本文件直接声明      → 受所在文件的允许集约束
 */
function collectExported(entry: string): Map<string, SymbolSurface> {
  const table = new Map<string, SymbolSurface>();
  /** file → 该文件被允许导出的名字（null 表示「全部」） */
  const allowed = new Map<string, Set<string> | null>();
  const visited = new Set<string>();
  const queue: Array<{ file: string; names: Set<string> | null }> = [{ file: entry, names: null }];

  while (queue.length) {
    const { file, names } = queue.shift()!;
    const prev = allowed.get(file);
    if (prev === null && names === null) {
      if (visited.has(file)) continue;
    } else if (visited.has(file)) {
      const merged = prev === null ? null : new Set(names ?? []);
      if (merged === null || merged.size === 0) continue;
      allowed.set(file, merged);
    } else {
      allowed.set(file, names);
    }
    visited.add(file);

    let sf: ts.SourceFile;
    try {
      sf = parseFile(file);
    } catch {
      continue;
    }
    const effective = allowed.get(file) ?? null;

    for (const [name, surface] of declaredIn(sf)) {
      if (effective && !effective.has(name)) continue;
      if (!table.has(name)) table.set(name, surface);
    }

    for (const st of sf.statements) {
      if (!ts.isExportDeclaration(st)) continue;
      if (!st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const target = resolveSpecifier(file, st.moduleSpecifier.text);
      if (!target) continue;

      if (!st.exportClause) {
        // `export * from X` —— 传递的允许集必须沿用**当前文件**的允许集，
        // 不能置为「不受限」：本文件若是靠选择性再导出（如
        // `export { ICommandBusService } from '../core/di/index.js'`）到达的，
        // 那么它内部 `export * from './interfaces.js'` 也只能带出 ICommandBusService。
        // 早期版本这里直接传 null，导致 core/di 下的 CommandBus 等符号被误判为
        // 「SDK 已导出」—— 而实测 `import { CommandBus } from '@openlearn/plugin-sdk'`
        // 报 TS2305。
        queue.push({ file: target, names: effective ?? null });
      } else if (ts.isNamedExports(st.exportClause)) {
        const names = new Set(st.exportClause.elements.map((e) => e.name.text));
        // 再与本文件当前允许集求交（选择性再导出不能超出上游允许范围）
        if (effective) for (const n of [...names]) if (!effective.has(n)) names.delete(n);
        if (names.size) queue.push({ file: target, names });
      }
    }
  }
  return table;
}

/** d.ts 末尾 `export { … }` 块里的名字 = 真实导出集合 */
function exportedNamesOfText(text: string): Set<string> {
  const names = new Set<string>();
  for (const st of parseSynthetic(text, 'openlearn+generated.d.ts').statements) {
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) names.add(e.name.text);
    }
  }
  return names;
}

/** 解析一段虚拟/拼接的 d.ts 文本（无对应磁盘文件） */
function parseSynthetic(text: string, name: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** `collectExported` 的文本版本：只解析单个虚拟文件，不跟随磁盘再导出 */
function collectExportedText(text: string, name: string): Map<string, SymbolSurface> {
  const table = new Map<string, SymbolSurface>();
  const sf = parseSynthetic(text, name);
  for (const [n, surface] of declaredIn(sf)) table.set(n, surface);
  return table;
}

/**
 * 对比 SDK 两个入口，产出成员级漂移报告。
 *
 * @param sdkDir `packages/plugin-sdk` 目录
 */
export function analyzeSdkDrift(sdkDir: string): DriftReport {
  const indexEntry = path.join(sdkDir, 'index.ts');
  /**
   * 消费侧真正看到的 d.ts = 手写 `openlearn.d.ts` + 生成 `generated.d.ts`
   * （build.mjs 拼接后产出 `dist/index.d.ts`）。分析必须读**拼接结果**，
   * 否则会把这 158 个生成符号全部误报成幽灵符号。
   *
   * 两个文件都是 ambient（无顶层 value import），拼接后共用一个全局作用域，
   * 所以这里直接拼文本再交给 `collectExported` 解析即可。
   */
  const dtsParts = ['openlearn.d.ts', 'generated.d.ts']
    .map((f) => path.join(sdkDir, f))
    .filter((f) => fs.existsSync(f));
  const dtsEntry = dtsParts[0];
  const dtsText = dtsParts.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  const indexSurface = collectExported(indexEntry);
  const dtsSurface = collectExportedText(dtsText, path.join(sdkDir, 'openlearn.d.ts'));
  const dtsExported = exportedNamesOfText(dtsText);

  const dtsPublic = new Map<string, SymbolSurface>();
  for (const [name, surface] of dtsSurface) {
    if (dtsExported.has(name)) dtsPublic.set(name, surface);
  }

  const ghost: DriftReport['ghost'] = [];
  for (const [name, surface] of indexSurface) {
    if (!dtsPublic.has(name)) ghost.push({ name, surface });
  }

  const reverseValues: DriftReport['reverseValues'] = [];
  const reverseTypes: DriftReport['reverseTypes'] = [];
  for (const name of dtsExported) {
    if (!dtsSurface.has(name) || indexSurface.has(name)) continue;
    const surface = dtsSurface.get(name)!;
    (surface.isValue ? reverseValues : reverseTypes).push({ name, surface });
  }

  const memberDrift: DriftReport['memberDrift'] = [];
  for (const [name, idxSurface] of indexSurface) {
    const d = dtsPublic.get(name);
    if (!d) continue;
    if (idxSurface.members.length === 0 || d.members.length === 0) continue; // 无成员可比
    const dSet = new Set(d.members);
    const idxSet = new Set(idxSurface.members);
    const onlyIndex = idxSurface.members.filter((m) => !dSet.has(m));
    const onlyDts = d.members.filter((m) => !idxSet.has(m));
    if (onlyIndex.length || onlyDts.length) memberDrift.push({ name, onlyIndex, onlyDts });
  }

  ghost.sort((a, b) => a.name.localeCompare(b.name));
  reverseValues.sort((a, b) => a.name.localeCompare(b.name));
  reverseTypes.sort((a, b) => a.name.localeCompare(b.name));
  memberDrift.sort((a, b) => a.name.localeCompare(b.name));

  return {
    collected: { index: indexSurface.size, dts: dtsPublic.size },
    ghost,
    reverseValues,
    reverseTypes,
    memberDrift,
  };
}

/** 生成人类可读的漂移清单（供 E-3 批量修复时逐项勾选） */
export function formatDrift(report: DriftReport): string {
  const lines: string[] = [];
  const withMembers = report.ghost.filter((g) => g.surface.members.length > 0);
  lines.push(`幽灵符号（index.ts 导出但 openlearn.d.ts 未声明）: ${report.ghost.length}`);
  lines.push(`  其中带成员（插件最可能用到）: ${withMembers.length}`);
  for (const g of withMembers) {
    lines.push(
      `    - ${g.name}  { ${g.surface.members.slice(0, 6).join('; ')}${g.surface.members.length > 6 ? '; …' : ''} }`,
    );
  }
  lines.push(
    `反向漂移·运行时值（d.ts 声明但 index.ts 未导出 → 插件 import 即 TS2693）: ${report.reverseValues.length}`,
  );
  for (const r of report.reverseValues) lines.push(`    - ${r.name}`);
  lines.push(`反向漂移·纯类型（无害：TS 走 dist/index.d.ts，不经 index.ts）: ${report.reverseTypes.length}`);
  lines.push(`成员级差异: ${report.memberDrift.length}`);
  for (const m of report.memberDrift) {
    const parts: string[] = [];
    if (m.onlyIndex.length) parts.push(`d.ts 缺 [${m.onlyIndex.join(', ')}]`);
    if (m.onlyDts.length) parts.push(`实现缺 [${m.onlyDts.join(', ')}]`);
    lines.push(`    - ${m.name}: ${parts.join('；')}`);
  }
  return lines.join('\n');
}
