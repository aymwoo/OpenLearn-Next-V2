/**
 * Batch 1 前置分析（D-5）：枚举所有已注册 command handler 与 action descriptor，
 * 找出「有 handler 但无 action」的命令 —— 这些是 interceptor 改 default-deny 后会被误伤的命令。
 *
 * 用法：node scripts/plugin-command-audit.mjs
 */
import fs from 'fs';
import path from 'path';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '_build', '__tests__', 'coverage']);
const ROOTS = ['packages', 'src', 'server'];
const EXTRA_FILES = ['server.ts'];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes('.test.') && !e.name.includes('.d.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

const files = [...ROOTS.flatMap((r) => walk(r)), ...EXTRA_FILES.filter((f) => fs.existsSync(f))];

const handlers = new Map(); // commandType -> file
const actions = new Map(); // commandType -> file

for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');

  // 收集 const/let NAME = 'literal' 绑定（builtin.ts 用变量传参）
  const consts = new Map();
  for (const m of s.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[`'"]([A-Za-z0-9_.:-]+)[`'"]/g)) {
    consts.set(m[1], m[2]);
  }
  // 收集模板字面量绑定：const X = `${PLUGIN_ID}.foo`
  const tplConsts = new Map();
  for (const m of s.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*`([^`]*)`/g)) {
    tplConsts.set(m[1], m[2]);
  }

  // 注意：变量名本身也满足 /^[A-Za-z0-9_.:-]+$/，因此必须**先看引号内的字面量**，
  // 再回退到 const 绑定查找，否则会把变量名（如 createLessonCmdType）误当成命令类型。
  // 若「标识符 + 点号串」同时出现，说明是成员表达式（`spec.commandType`）→ 直接判为非字面量。
  const resolve = (quoted, name) => {
    if (quoted && name) return null; // obj.prop 形态
    if (quoted && /^[A-Za-z0-9_.:-]+$/.test(quoted)) return quoted;
    if (name && consts.has(name)) return consts.get(name);
    if (name && tplConsts.has(name)) return tplConsts.get(name).replace(/\$\{[^}]+\}/g, '*');
    return null;
  };
  // 命令类型必须是命名空间化的（至少含一个点），以排除 `...` `:` 之类误报。
  // 额外要求：必须是 `word(.word)*` 形态 —— 排除 `...`（rest 参数）与
  // `.commandType` 这类成员表达式（`obj.prop`）被误当成命令类型。
  const asCommand = (t) => (t && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(t) ? t : null);

  // commandBus.registerHandler(X | 'x.y' | `x.y`)
  for (const m of s.matchAll(/registerHandler\(\s*([A-Za-z_$][\w$]*)?[`'"]?([A-Za-z0-9_.:-]*)[`'"]?/g)) {
    const t = asCommand(resolve(m[2], m[1]));
    if (t && !handlers.has(t)) handlers.set(t, f);
  }

  // actionRegistry.register({ ... commandType: X | 'x.y' ... })
  //
  // 注意：**不能用 `\{([\s\S]{0,N}?)\n\s*\}\s*\)` 这类长度上限正则**。
  // builtin.ts:1727 的 `core-courseware-save-score-config` descriptor 体长 1616 字符，
  // 曾在上限 1200 时被漏检 → 误报成「有 handler 无 action」，并据此做出了错误决策。
  // 这里改用括号深度扫描，对任意长度都正确。
  for (let i = 0; i < s.length; i++) {
    if (!s.startsWith('actionRegistry.register(', i)) continue;
    const open = s.indexOf('{', i);
    if (open === -1) continue;
    let depth = 0;
    let end = -1;
    for (let j = open; j < s.length; j++) {
      const ch = s[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    const body = s.slice(open, end + 1);
    const cm = body.match(/commandType:\s*([A-Za-z_$][\w$]*)?[`'"]?([A-Za-z0-9_.:-]*)[`'"]?/);
    if (!cm) continue;
    const t = asCommand(resolve(cm[2], cm[1]));
    if (t && !actions.has(t)) actions.set(t, f);
    i = end;
  }
}

const sorted = (m) => [...m.keys()].sort();
const noAction = sorted(handlers).filter((t) => !actions.has(t));

console.log(`扫描文件数        : ${files.length}`);
console.log(`registerHandler   : ${handlers.size} 个唯一 commandType`);
console.log(`actionRegistry    : ${actions.size} 个唯一 commandType`);
console.log('');
console.log(`>>> 有 handler 但【无 action】（改 default-deny 后会被误伤）: ${noAction.length} 个`);
for (const t of noAction) console.log('    ' + t.padEnd(46) + handlers.get(t));

const noHandler = sorted(actions).filter((t) => !handlers.has(t));
console.log('');
console.log(`>>> 有 action 但【无 handler】（AI 工具暴露了不存在的命令）: ${noHandler.length} 个`);
for (const t of noHandler) console.log('    ' + t.padEnd(46) + actions.get(t));
