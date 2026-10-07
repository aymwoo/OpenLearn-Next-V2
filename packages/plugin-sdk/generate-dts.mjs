/**
 * @openlearn/plugin-sdk — d.ts 声明生成器
 *
 * ## 为什么需要它
 *
 * `openlearn.d.ts` 是**手写**镜像 `packages/core/` 源码的声明文件。历史上它靠人工
 * 同步，源码一改就漂移 —— 这正是审计项 H-6 的成因，也让漂移累积到 145 项
 * （`index.ts` 导出 251 个名字，d.ts 只声明了 127 个）。
 *
 * 本脚本用 TypeScript Compiler API 从源码**抽出**这些声明，生成
 * `generated.d.ts`；`build.mjs` 把它拼接到 `openlearn.d.ts` 之后产出
 * `dist/index.d.ts`。这样「源码改了但 d.ts 没跟上」在结构上不再可能。
 *
 * ## 边界（刻意为之）
 *
 * 生成器只负责**能从源码推导**的声明。以下留在 `openlearn.d.ts` 手写区，
 * 因为它们没有源码真相，或需要人工裁剪：
 *   - `Token`、`PluginContext`、`PluginHttpRouter` 等宿主注入面
 *   - 前端专有类型（`PaletteItemConfig`、`FullscreenRenderer` 等）——
 *     源码在 `src/` 下，SDK 是后端产物，不该引用
 *   - 已人工校对过的宿主契约声明
 *
 * 生成器**不会**覆盖 d.ts 里已有的声明（按名跳过），因此两者拼接不会重名。
 *
 * ## 外部类型降级
 *
 * 发布包只有 `zod` 一个 peerDependency，没有 express / @types/node。
 * 若生成的声明引用 `express.Request` 之类的类型，消费者会编译失败。
 * 因此引用到**仓库外**类型时降级为 `any`，并在 `--report` 里列出，
 * 让降级可见而不是静默。
 *
 * 用法：
 *   node packages/plugin-sdk/generate-dts.mjs           # 写入 generated.d.ts
 *   node packages/plugin-sdk/generate-dts.mjs --check   # 只校验是否最新（CI 用）
 *   node packages/plugin-sdk/generate-dts.mjs --report  # 打印外部类型降级清单
 */

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SDK = __dirname;
const OUT_FILE = path.join(SDK, 'generated.d.ts');

// ────────────────────────────────────────────────────────────────────────────
// 1. 模块索引：跟随 export * / export … from，建立「符号名 → 声明节点」
// ────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, { decl: ts.Node, file: string }>} 符号名 → 声明 */
const symbolIndex = new Map();
/** @type {Map<string, ts.SourceFile>} */
const fileCache = new Map();

function parse(file) {
  if (!fileCache.has(file)) {
    fileCache.set(
      file,
      ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    );
  }
  return fileCache.get(file);
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec).replace(/\.js$/, '');
  for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

/** 该节点在**源文件**里是否对外可见 */
function isExported(st) {
  if (ts.canHaveModifiers(st)) {
    const mods = ts.getModifiers(st) ?? [];
    if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return true;
    if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return true;
  }
  return false;
}

/**
 * 收集单文件里的顶层导出声明。
 * 返回 `[{ name, node, varDecl }]`：
 *  - `node`：interface / type / class / enum / function 的 AST 声明节点
 *  - `varDecl`：`export const X = …` 里的 `VariableDeclaration`（仅 const/let/var 有）
 *
 * 注意不要在这里再包一层 —— 早期版本返回 `[name, {kind:'var', …}]`，
 * 索引处又包成 `{decl: entry}`，于是 `entry.kind` 恒为 undefined，
 * const 全被当成 AST 节点去打印，产出裸 `any` 语句。
 */
function localExports(sf) {
  const out = [];
  for (const st of sf.statements) {
    if (
      ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st) ||
      ts.isEnumDeclaration(st) ||
      ts.isClassDeclaration(st) ||
      ts.isFunctionDeclaration(st)
    ) {
      if (st.name && isExported(st)) out.push({ name: st.name.text, node: st, varDecl: null });
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) out.push({ name: d.name.text, node: st, varDecl: d });
      }
    }
  }
  return out;
}

/**
 * 索引一个文件及其所有再导出目标（传递闭包）。
 * `seen` 防止循环。
 */
function indexFile(file, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  const sf = parse(file);

  for (const { name, node, varDecl } of localExports(sf)) {
    // 已有的同名声明不覆盖 —— barrel 的 `export *` 优先级低于本文件显式声明
    if (!symbolIndex.has(name)) symbolIndex.set(name, { node, varDecl, file });
  }

  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const target = resolveSpecifier(file, st.moduleSpecifier.text);
    if (!target) continue;
    indexFile(target, seen);
    // 具名再导出会改名（`export { A as B } from './x.js'`）
    if (st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) {
        const src = e.propertyName?.text ?? e.name.text;
        const hit = symbolIndex.get(src);
        if (hit && e.name.text !== src) symbolIndex.set(e.name.text, hit);
      }
    }
  }
}

indexFile(path.join(SDK, 'index.ts'));

// 再把所有内核源码纳入索引（**不覆盖**已有条目）。
//
// 闭包会引用到 index.ts 可达图之外的名字 —— 例如 `ManifestV3` 引用
// `manifestSchemaV3`，后者引用的类型来自 packages/core/bootstrap/integration/，
// 而那个目录并不在 index.ts 的再导出链上。若只索引可达图，生成物会留下
// `Cannot find name 'IPluginHostAdapter'` 这类悬空引用。
// 真正「要声明哪些」由闭包决定，索引范围放宽只会让闭包更完整。
for (const pkg of ['core', 'activity-ecosystem']) {
  const base = path.join(ROOT, 'packages', pkg);
  for (const dir of [base, ...walkDirs(base)]) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.d.ts')) continue;
      const full = path.join(dir, f);
      if (full.includes('/__tests__/') || full.includes('/test/')) continue;
      indexFileLoose(full);
    }
  }
}

function walkDirs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name === 'dist') continue;
    out.push(path.join(dir, e.name));
    out.push(...walkDirs(path.join(dir, e.name)));
  }
  return out;
}

/** 宽松索引：只补 symbolIndex，不跟随再导出 */
function indexFileLoose(file) {
  if (fileCache.has(file)) return;
  fileCache.set(
    file,
    ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  );
  for (const { name, node, varDecl } of localExports(fileCache.get(file))) {
    if (!symbolIndex.has(name)) symbolIndex.set(name, { node, varDecl, file });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 2. 读取手写 d.ts，知道哪些名字已经声明过（避免拼接重名）
// ────────────────────────────────────────────────────────────────────────────

const handDtsPath = path.join(SDK, 'openlearn.d.ts');
const handDtsText = fs.readFileSync(handDtsPath, 'utf8');
const handDtsSf = ts.createSourceFile('openlearn.d.ts', handDtsText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const handDeclared = new Set();
function collectHandDeclared(sf) {
  for (const st of sf.statements) {
    if (
      ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st) ||
      ts.isEnumDeclaration(st) ||
      ts.isClassDeclaration(st) ||
      ts.isFunctionDeclaration(st)
    ) {
      if (st.name) handDeclared.add(st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) handDeclared.add(d.name.text);
      }
    } else if (ts.isModuleDeclaration(st) && st.name && ts.isIdentifier(st.name)) {
      handDeclared.add(st.name.text);
    }
  }
}
collectHandDeclared(handDtsSf);

// openlearn.d.ts 末尾导出块里**已导出**的名字
const handExported = new Set();
for (const st of handDtsSf.statements) {
  if (!ts.isExportDeclaration(st) || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
  for (const e of st.exportClause.elements) handExported.add(e.name.text);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. 入口导出清单（index.ts 真正导出的名字）
// ────────────────────────────────────────────────────────────────────────────

/** @type {{ name: string, isValue: boolean }[]} */
const entryExports = [];
{
  const sf = parse(path.join(SDK, 'index.ts'));
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    const typeOnly = st.isTypeOnly;
    for (const e of st.exportClause.elements) {
      entryExports.push({ name: e.name.text, isValue: !typeOnly });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 4. 闭包计算：从「入口导出但手写 d.ts 未声明」的名字出发，广度优先收集
//    全部被引用的本地类型 / 常量
// ────────────────────────────────────────────────────────────────────────────

const TS_BUILTINS = new Set([
  'Array',
  'ReadonlyArray',
  'Promise',
  'Record',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'Parameters',
  'ReturnType',
  'Awaited',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Date',
  'Error',
  'Object',
  'Function',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'JSON',
  'Math',
  'RegExp',
  'Uint8Array',
  'ArrayBuffer',
  'Buffer',
  'Iterable',
  'Iterator',
  'Generator',
  'this',
  'void',
  'any',
  'unknown',
  'never',
  'null',
  'undefined',
  'boolean',
  'number',
  'string',
  'object',
  'true',
  'false',
  'globalThis',
  'Omit',
  'Uppercase',
  'Lowercase',
  'Capitalize',
  'Uncapitalize',
  'InstanceType',
  'ConstructorParameters',
  'OmitThisParameter',
  'ThisType',
]);

/** 被降级成 any 的仓库外类型：标识符 → 出现位置 */
const downgraded = new Map();

/** 收集节点内引用的所有标识符（跳过属性名的假阳性：`.foo` 的 foo 不算引用） */
function collectRefs(node) {
  const refs = new Set();
  const walk = (n, isMemberAccessName) => {
    if (ts.isIdentifier(n) && !isMemberAccessName) refs.add(n.text);
    if (ts.isPropertyAccessExpression(n)) {
      ts.forEachChild(n.expression, (c) => walk(c, false));
      return; // .name 不算引用
    }
    if (ts.isQualifiedName(n)) {
      walk(n.left, false);
      return; // A.B 的 B 不算独立引用
    }
    if (ts.isPropertyAssignment(n) && !ts.isComputedPropertyName(n.name)) {
      // { foo: 1 } 的 foo 是键不是引用；但 shorthand { foo } 是
      if (ts.isShorthandPropertyAssignment(n)) refs.add(n.name.text);
      ts.forEachChild(n.initializer, (c) => walk(c, false));
      return;
    }
    ts.forEachChild(n, (c) => walk(c, false));
  };
  walk(node, false);
  return refs;
}

const need = new Set();
const queue = [];
const missing = [];

for (const { name } of entryExports) {
  if (handDeclared.has(name)) continue;
  if (!symbolIndex.has(name)) {
    missing.push(name);
    continue;
  }
  if (!need.has(name)) {
    need.add(name);
    queue.push(name);
  }
}

while (queue.length) {
  const name = queue.shift();
  const entry = symbolIndex.get(name);
  const node = entry.varDecl ? entry.varDecl : entry.node;
  for (const ref of collectRefs(node)) {
    if (need.has(ref) || handDeclared.has(ref) || TS_BUILTINS.has(ref)) continue;
    if (!symbolIndex.has(ref)) continue;
    if (!need.has(ref)) {
      need.add(ref);
      queue.push(ref);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 5. 发射声明
// ────────────────────────────────────────────────────────────────────────────

const printer = ts.createPrinter({ removeComments: false, newLine: ts.NewLineKind.LineFeed });
const SF = ts.createSourceFile('emit.ts', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

function print(node) {
  // 源码里大量方法没有显式返回类型 / 参数类型（依赖推断）。.d.ts 必须写出
  // 完整类型，此处降级为 `any` —— 宁可就空，不可让整份生成物崩掉。
  if (!node) return 'any';
  try {
    // 必须传节点**真实的** SourceFile：printer 打印字符串字面量类型
    // （`'idle' | 'active'`）时要回源文件取原文。传空 SF 会把每个成员打印成
    // 空串，产出 `type ActivityStatus =  |  | ;` 这种语法错误。
    const sf = node.getSourceFile?.() ?? SF;
    return printer.printNode(ts.EmitHint.Unspecified, node, sf);
  } catch (err) {
    printFailures.set(name0, `${ts.SyntaxKind[node.kind] ?? '?'} ← ${err.message}`);
    return 'any';
  }
}

/** print() 降级为 any 的记录（诊断用） */
const printFailures = new Map();

/** 判断类型注解里是否引用了仓库外类型（express 等），需要降级 */
function usesForeignTypes(typeNode) {
  if (!typeNode) return false;
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) {
      const nm = n.typeName.text;
      if (!symbolIndex.has(nm) && !need.has(nm) && !TS_BUILTINS.has(nm)) {
        downgraded.set(nm, (downgraded.get(nm) ?? '') + name0);
        found = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(typeNode);
  return found;
}

/** 降级：把仓库外类型引用换成 any */
const foreignSubstitutes = new Map();

function sanitizeTypeText(text) {
  // 把 `import("express").Request` / `express.Request` / 未知标识符替换为 any
  let out = text;
  for (const nm of downgraded.keys()) {
    if (nm === 'any') continue;
    out = out.replace(new RegExp(`\\b${nm.replace(/[$]/g, '\\$&')}\\b`, 'g'), 'any');
  }
  return out;
}

/** 合成 `as const` 字面量的类型文本 */
function literalTypeOf(expr) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return `'${expr.text}'`;
  if (ts.isNumericLiteral(expr)) return String(expr.text);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
    const inner = literalTypeOf(expr.operand);
    return inner ? `-${inner}` : null;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const parts = expr.elements.map((e) => (ts.isSpreadElement(e) ? null : literalTypeOf(e)));
    if (parts.some((p) => p === null)) return null;
    return `readonly [${parts.join(', ')}]`;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const parts = [];
    for (const p of expr.properties) {
      if (!ts.isPropertyAssignment(p)) return null;
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      const val = literalTypeOf(p.initializer);
      if (key === null || val === null) return null;
      parts.push(`  readonly ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${val};`);
    }
    return `{\n${parts.join('\n')}\n}`;
  }
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return literalTypeOf(expr.expression);
  if (ts.isParenthesizedExpression(expr)) return literalTypeOf(expr.expression);
  if (ts.isTypeOfExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    return literalTypeOf(expr.expression);
  }
  return null;
}

let name0 = '';
const chunks = [];
const emitted = new Set();
/** 同名函数的额外重载签名 */
const extraOverloads = [];

/** 符号是否产生**运行时值**（决定它该进哪个导出块） */
function isValueSymbol(name) {
  const e = symbolIndex.get(name);
  if (!e) return false;
  if (e.varDecl) return true;
  return ts.isClassDeclaration(e.node) || ts.isFunctionDeclaration(e.node) || ts.isEnumDeclaration(e.node);
}

/**
 * 打印声明，摘掉 `export` 修饰符。
 *
 * 不能用 `text.replace(/^export\s+/, '')` —— printer 会把**前置注释**一起打出来，
 * 于是文本以 `// ── 某段注释 ──` 开头，`^export` 永远匹配不上，产物里留下一堆
 * `export interface …`（ambient 上下文里再被导出块重复导出 → TS2484）。
 * 直接改 AST 上的 modifier 再打印，打完还原，确定且不受注释影响。
 */
function printDecl(node) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!mods?.length) return print(node);
  const exportMod = mods.find((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!exportMod) return print(node);
  const kept = node.modifiers;
  node.modifiers = kept.filter((m) => m !== exportMod);
  try {
    return print(node);
  } finally {
    node.modifiers = kept;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 5b. 用 checker 解析「非字面量 const」的真实类型
//
// `export const manifestSchemaV3 = z.object({ … })` 这类声明，`literalTypeOf`
// 只能给出 null。若直接写 `any`，则 `type ManifestV3 = z.infer<typeof
// manifestSchemaV3>` 会退化成 `any`，插件写错 manifest 也不再报错 ——
// 用类型当 schema 的那层保护就没了。
//
// 这里开一个 ts.Program 把真实类型求出来打印。只在需要时建，且设长度上限：
// 打印结果过长或含 `import(` 时退回 `any`，避免把 monorepo 内部路径写进产物。
// ────────────────────────────────────────────────────────────────────────────

let checker = null;
/** checker 的 Program（TypeChecker 没有 getProgram()，必须自己留引用） */
let checkProgram = null;
/** checker 解析失败的记录（诊断用） */
const checkerMisses = [];
function resolveCheckedType(name, varDecl) {
  if (!checker) {
    const files = [...new Set([...symbolIndex.values()].map((e) => e.file))].filter((f) => fs.existsSync(f));
    checkProgram = ts.createProgram(files, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    });
    checker = checkProgram.getTypeChecker();
  }
  const sf = varDecl.getSourceFile();
  const boundSf =
    checkProgram.getSourceFile(sf.fileName) ??
    checkProgram.getSourceFile(ts.sys.realpath?.(sf.fileName) ?? sf.fileName);
  if (!boundSf) {
    checkerMisses.push(`${name}: checker 程序里找不到 ${path.relative(ROOT, sf.fileName)}`);
    return null;
  }
  const node = findDeclaration(boundSf, name, varDecl);
  if (!node) {
    checkerMisses.push(`${name}: 在 checker 源文件里没找到声明`);
    return null;
  }
  const type = checker.getTypeAtLocation(node);
  const text = checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias);
  if (text.length > 4000 || text.includes('import(')) return null;
  if (!isSelfContained(text)) {
    checkerMisses.push(`${name}: 解析结果引用了消费侧没有的外部类型`);
    return null;
  }
  return text;
}

/**
 * 消费侧自包含性检查。
 *
 * 产物要发布到 npm，而本包只有 `zod` 一个 peerDependency —— 没有
 * `better-sqlite3`、没有 `pino`。checker 给 `db` 求出的类型是
 * `BetterSqlite3.Database`，给 `logger` 求出的是 `pino.Logger`，直接写进
 * 产物会让消费侧报 `TS2503: Cannot find namespace 'pino'`。
 *
 * 规则：去掉限定名（`z.X`、`Foo.Bar`）之后，剩下的裸标识符必须都在
 * 「作用域内」——已声明的符号、TS 内建、或原始类型关键字。zod 作为
 * peerDependency 显式放行。
 */
const PRIMITIVES = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'never',
  'void',
  'null',
  'undefined',
  'object',
  'symbol',
  'bigint',
  'true',
  'false',
  'typeof',
  'keyof',
  'readonly',
  'infer',
  'extends',
  'const',
  'new',
]);

function isSelfContained(typeText) {
  // 限定名的**基名**要查：`BetterSqlite3.Database` / `pino.Logger` 的基名在
  // 消费侧不存在，直接整段剥掉会把它们一起放过 —— 那样产物里就留下
  // `declare const db: BetterSqlite3.Database`，消费侧报 TS2503。
  const qualified = typeText.match(/\b([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*/g) ?? [];
  for (const q of qualified) {
    const base = q.split('.')[0].trim();
    if (base === 'z') continue;
    if (need.has(base) || handDeclared.has(base) || TS_BUILTINS.has(base)) continue;
    return false;
  }
  const bare = typeText
    .replace(/\b[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*/g, ' ')
    // 剥掉对象/类型的属性键 —— `{ id: string }` 里的 `id` 不是类型引用，
    // 不剥会把它们误判成「消费侧不认识的外部类型」。
    .replace(/\b[A-Za-z_$][\w$]*\s*\??\s*:/g, ' ')
    .replace(/'[^']*'\s*\??\s*:/g, ' ')
    .replace(/\b\d+\s*\??\s*:/g, ' ');
  const idents = bare.match(/[A-Za-z_$][\w$]*/g) ?? [];
  for (const id of idents) {
    if (PRIMITIVES.has(id) || TS_BUILTINS.has(id)) continue;
    if (need.has(id) || handDeclared.has(id)) continue;
    // zod 用 `$` 前缀的内部名义类型做类型品牌（如 `z.core.$loose`）。
    // 它们只在 z.d.ts 里声明，`z` 已放行，故 `$` 开头的标识符一并放行。
    if (id.startsWith('$')) continue;
    return false;
  }
  return true;
}

/** 在 checker 的源文件里重新定位同一条声明（checker 用的是它自己的解析树） */
function findDeclaration(sf, name, fallback) {
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return d;
      }
    }
  }
  return fallback;
}

function emit(name, entry) {
  if (emitted.has(name)) {
    // 函数重载：同名的多个签名都要发出来（只有第一个带 body）
    if (ts.isFunctionDeclaration(entry.node) && !entry.node.body) {
      extraOverloads.push(renderFunction(entry.node));
    }
    return;
  }
  emitted.add(name);

  if (entry.varDecl) {
    const lit = literalTypeOf(entry.varDecl.initializer);
    let typeText = lit;
    if (!typeText) {
      try {
        typeText = resolveCheckedType(name, entry.varDecl);
      } catch (err) {
        checkerMisses.push(`${name}: ${err.message}`);
        typeText = null;
      }
    }
    chunks.push(
      typeText
        ? `/** @see ${path.relative(ROOT, entry.file)} */\ndeclare const ${name}: ${typeText};`
        : `/** @see ${path.relative(ROOT, entry.file)} */\ndeclare const ${name}: any; // 初始化器非字面量，未收敛`,
    );
    return;
  }

  const node = entry.node;
  if (ts.isClassDeclaration(node)) {
    chunks.push(renderClass(name, node));
    return;
  }
  if (ts.isFunctionDeclaration(node)) {
    chunks.push(renderFunction(node));
    return;
  }
  if (ts.isEnumDeclaration(node)) {
    chunks.push(renderEnum(name, node));
    return;
  }

  let text = printDecl(node);
  // print() 降级时会给纯 `any`，那在 ambient 里是非法语句 —— 必须显式兜住
  if (text.trim() === 'any') text = `declare const ${name}: any;`;
  chunks.push(`/** @see ${path.relative(ROOT, entry.file)} */\n${text}`);
}

/** 函数 → `declare function` 签名（环境声明里不能有函数体，TS1183） */
function renderFunction(node) {
  const generics = node.typeParameters?.length ? '<' + node.typeParameters.map((t) => print(t)).join(', ') + '>' : '';
  return `declare function ${print(node.name)}${generics}(${(node.parameters ?? []).map(paramSignature).join(', ')}): ${print(node.type)};`;
}

/** enum → `declare enum`（成员值原样保留） */
function renderEnum(name, node) {
  const members = node.members
    .map((m) => {
      const init = m.initializer ? ` = ${print(m.initializer)}` : '';
      return `  ${print(m.name)}${init},`;
    })
    .join('\n');
  return `/** @see ${path.relative(ROOT, symbolIndex.get(name)?.file ?? '')} */\ndeclare enum ${name} {\n${members}\n}`;
}

/**
 * class → declare class
 *
 * 要点：
 *  - **类型参数必须带上**，否则成员里的 `T` 悬空（TS2304）。
 *  - **构造器参数属性**（`constructor(private x: T)`）在环境声明里是语法错误
 *    （TS2369）。tsc 的做法是把它提到类体里当属性，构造器签名只留 `x: T`。
 *  - **参数默认值**（`constructor(x = 1)`）在 ambient 里也是语法错误（TS2371）。
 *  - 私有成员不进 .d.ts。
 */
function renderClass(name, node) {
  const nodeMods = ts.getModifiers(node) ?? [];
  const abstractKw = nodeMods.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ? 'abstract ' : '';
  const typeParams = node.typeParameters?.length ? '<' + node.typeParameters.map((t) => print(t)).join(', ') + '>' : '';
  const heritage = node.heritageClauses?.map((h) => ' ' + print(h).trim()).join('') ?? '';
  const lines = [];
  lines.push(`/** @see ${path.relative(ROOT, symbolIndex.get(name)?.file ?? '')} */`);
  lines.push(`declare ${abstractKw}class ${name}${typeParams}${heritage} {`);
  /** 参数属性 → 类体属性 */
  const promoted = [];
  for (const m of node.members) {
    const mMods = ts.getModifiers(m) ?? [];
    if (mMods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword)) continue;
    const kw = mMods.some((x) => x.kind === ts.SyntaxKind.ProtectedKeyword) ? 'protected ' : '';
    if (ts.isConstructorDeclaration(m)) {
      const sig = m.parameters.map((p) => {
        const pMods = ts.getModifiers(p) ?? [];
        const isProp =
          pMods.some((x) => x.kind === ts.SyntaxKind.PublicKeyword) ||
          pMods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword) ||
          pMods.some((x) => x.kind === ts.SyntaxKind.ProtectedKeyword) ||
          pMods.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);
        if (isProp) {
          const ro = pMods.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword) ? 'readonly ' : '';
          const pk = pMods.some((x) => x.kind === ts.SyntaxKind.ProtectedKeyword) ? 'protected ' : '';
          promoted.push(`  ${pk}${ro}${print(p.name)}${p.questionToken ? '?' : ''}: ${print(p.type)};`);
        }
        // 只留 `name: type`，去掉修饰符与默认值
        return `${print(p.name)}${p.questionToken ? '?' : ''}: ${print(p.type)}`;
      });
      lines.push(`  ${kw}constructor(${sig.join(', ')});`);
    } else if (ts.isGetAccessor(m)) {
      lines.push(`  ${kw}get ${print(m.name)}(): ${print(m.type)};`);
    } else if (ts.isSetAccessor(m)) {
      lines.push(`  ${kw}set ${print(m.name)}(${paramSignature(m.parameters[0])});`);
    } else if (ts.isPropertyDeclaration(m)) {
      const ro = mMods.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword) ? 'readonly ' : '';
      const opt = m.questionToken ? '?' : '';
      lines.push(`  ${kw}${ro}${print(m.name)}${opt}: ${print(m.type)};`);
    } else if (ts.isMethodDeclaration(m)) {
      const st = mMods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) ? 'static ' : '';
      const ab = mMods.some((x) => x.kind === ts.SyntaxKind.AbstractKeyword) ? 'abstract ' : '';
      const generics = m.typeParameters?.length ? '<' + m.typeParameters.map((t) => print(t)).join(', ') + '>' : '';
      lines.push(
        `  ${kw}${st}${ab}${print(m.name)}${generics}(${m.parameters.map(paramSignature).join(', ')}): ${print(m.type)};`,
      );
    }
  }
  lines.push(...promoted);
  lines.push('}');
  return lines.join('\n');
}

/** 参数签名文本：去修饰符、去默认值 */
function paramSignature(p) {
  if (!p) return 'any';
  const prefix = p.dotDotDotToken ? '...' : '';
  return `${prefix}${print(p.name)}${p.questionToken ? '?' : ''}: ${print(p.type)}`;
}

for (const name of [...need].sort()) {
  name0 = name;
  const entry = symbolIndex.get(name);
  if (!entry) continue;
  try {
    emit(name, entry);
  } catch (err) {
    process.stderr.write(`⚠️  生成 ${name} 失败：${err.message}\n${err.stack?.split('\n').slice(1, 3).join('\n')}\n`);
  }
}

const header = `/**
 * @openlearn/plugin-sdk — **自动生成，请勿手工编辑**
 *
 * 由 packages/plugin-sdk/generate-dts.mts 从 packages/core/ 源码抽取。
 * 手写契约请改 openlearn.d.ts —— 本文件会在 build 时被覆盖。
 *
 * 覆盖符号：${need.size} 个（入口导出但手写 d.ts 未声明的 ${[...need].length} 项及其类型引用闭包）
 */

`;

/**
 * 导出块。
 *
 * `openlearn.d.ts` 末尾的手写 `export type { … }` / `export { … }` 不会覆盖到
 * 本区块追加的声明，所以这里必须自己再导出一遍，否则消费侧会得到
 * `TS2459: declares 'X' locally, but it is not exported`。
 *
 * 分类必须按**符号真实种类**而非 index.ts 的写法来分：值（class / const /
 * function / enum）必须进值导出块。若像 index.ts 对 `PluginState` 那样用
 * `export type` 导出一个 enum，消费侧写 `PluginState.ACTIVE` 会拿到
 * `TS1362: cannot be used as a value because it was exported using 'export type'`。
 */
const valueExports = [];
const typeExports = [];
for (const { name } of entryExports) {
  if (!need.has(name)) continue;
  (isValueSymbol(name) ? valueExports : typeExports).push(name);
}

/**
 * 补 openlearn.d.ts 自己的导出漏洞。
 *
 * 有 16 个符号在 openlearn.d.ts 里**声明了**、index.ts 也**导出了**，但没进
 * d.ts 末尾的导出块 —— 消费侧会拿到 `TS2459: declares 'X' locally, but it is
 * not exported`。这里机械补齐，而不是手改导出块：手改的东西会随源码继续漂移。
 */
const handExportGaps = entryExports.map((e) => e.name).filter((n) => handDeclared.has(n) && !handExported.has(n));
const gapValues = handExportGaps.filter(isValueSymbol);
const gapTypes = handExportGaps.filter((n) => !isValueSymbol(n));

/**
 * 已收回对外承诺的符号（D-2 / D-6 决策，SDK 3.8.0）。
 *
 * 这些符号在 openlearn.d.ts 里**仍有声明**（内核侧继续可用，`core/di/interfaces.ts`
 * 是它们的规范源），但刻意**不进**任何导出块 —— `index.ts` 已移除对应 export，
 * 对外承诺被收回。对外承诺一个零消费者 API 比不承诺更糟。
 *
 * 为什么要显式列出来，而不是靠「index.ts 没导出」自然生效：
 * `handExportGaps` 那段会机械补齐「声明了但没进导出块」的符号 —— 它按
 * `handDeclared ∧ ¬handExported ∧ ∈ entryExports` 判定，而这些名字已经不在
 * `entryExports` 里了，所以本来就不会被补。但把它们显式记下来有两个作用：
 *   ① 把「有意不导出」和「漏导出」在产物里区分开，避免后来者当成 bug 又加回去
 *   ② 让反向漂移的预期值可解释 —— 见下方 reverseTypes 说明
 *
 * 若将来接入真实消费者：删掉这里的名字，并把 index.ts 的 export 加回去
 * （生成器会自动重新纳入导出）。
 */
const WITHDRAWN_FROM_SDK = Object.freeze([
  // M-10 / F-3：kernel/index.ts:224-226 注册，零生产 resolve。
  // 全仓唯一提及是 index.ts 顶部注释示例；v2_plugins/ 与 assets/ 零命中。
  'IPluginRuntimeCompositionToken',
  'IUnifiedExtensionRegistryToken',
  'IPluginCapabilityGatewayToken',
  // M-9 / F-2：capability-governance 子系统（529 行）整体零 resolve。
  'ICapabilityGovernanceServiceToken',
]);

/** 撤回名单里的符号若重新出现在 index.ts 导出面，说明消费方已就位，提示移除名单 */
const reinstated = WITHDRAWN_FROM_SDK.filter((n) => entryExports.some((e) => e.name === n));

// 反向体检：index.ts 用 `export type` 导出了值符号 → 消费侧会踩 TS1362
const typeExportedValues = entryExports.filter((e) => !e.isValue && isValueSymbol(e.name)).map((e) => e.name);

function renderExportBlock(kind, names) {
  if (names.length === 0) return '';
  const kw = kind === 'type' ? 'export type {' : 'export {';
  return `${kw}\n${names.map((n) => '  ' + n + ',').join('\n')}\n};`;
}

const out =
  header +
  chunks.join('\n\n') +
  '\n' +
  extraOverloads.join('\n') +
  '\n' +
  renderExportBlock('type', [...typeExports, ...gapTypes].sort()) +
  '\n' +
  renderExportBlock('value', [...valueExports, ...gapValues].sort()) +
  '\n';

// ────────────────────────────────────────────────────────────────────────────
// 6. 输出 / 校验
// ────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--report')) {
  process.stderr.write('\n外部类型降级清单（仓库外 → any）：\n');
  if (downgraded.size === 0) process.stderr.write('  （无）\n');
  for (const [k, v] of [...downgraded].sort()) process.stderr.write(`  ${k}  ← ${v}\n`);
  process.stderr.write('\n入口导出但源码索引里找不到：\n');
  if (missing.length === 0) process.stderr.write('  （无）\n');
  else process.stderr.write(`  ${missing.join(', ')}\n`);
  // index.ts 用 `export type` 导出了运行时值符号 —— 消费侧踩 TS1362
  process.stderr.write('\nindex.ts 用 export type 导出了值符号（消费侧 TS1362）：\n');
  if (typeExportedValues.length === 0) process.stderr.write('  （无）\n');
  else for (const n of typeExportedValues) process.stderr.write(`  ${n}\n`);
  process.stderr.write(
    `\n生成符号：${need.size}｜type 导出 ${typeExports.length + gapTypes.length}｜value 导出 ${valueExports.length + gapValues.length}\n`,
  );
  process.stderr.write(
    `\nopenlearn.d.ts 导出块补齐（TS2459 修复）: ${gapTypes.length + gapValues.length}\n  ${handExportGaps.join(', ')}\n`,
  );
  if (checkerMisses.length) {
    process.stderr.write('\nchecker 解析失败（已退回 any）：\n');
    for (const m of [...new Set(checkerMisses)]) process.stderr.write(`  ${m}\n`);
  }
  if (printFailures.size) {
    process.stderr.write('\nprint() 降级为 any：\n');
    for (const [k, v] of [...printFailures].sort()) process.stderr.write(`  ${k}: ${v}\n`);
  }
  // 导出名去重自检：entryExports 里同一名字出现多次会产出 TS2484 重复导出
  const seenExport = new Set();
  const dupExports = entryExports
    .map((e) => e.name)
    .filter((n) => (seenExport.has(n) ? true : (seenExport.add(n), false)));
  if (dupExports.length) {
    process.stderr.write('\nindex.ts 里重复导出的名字：\n  ' + [...new Set(dupExports)].join(', ') + '\n');
  }
}

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
  if (existing !== out) {
    process.stderr.write('❌ generated.d.ts 与源码不一致 —— 请跑 `node packages/plugin-sdk/generate-dts.mjs`\n');
    process.exit(1);
  }
  process.stderr.write('✅ generated.d.ts 与源码一致\n');
} else {
  fs.writeFileSync(OUT_FILE, out);
  process.stderr.write(
    `✅ 生成 ${path.relative(ROOT, OUT_FILE)} —— ${need.size} 个符号，${(out.length / 1024).toFixed(1)} KB\n`,
  );
  if (missing.length)
    process.stderr.write(`⚠️  入口导出但源码无声明：${missing.length} 个（${missing.slice(0, 5).join(', ')}…）\n`);
}
