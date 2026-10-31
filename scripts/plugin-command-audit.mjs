/**
 * Batch 1 前置分析（D-5）：枚举所有已注册 command handler 与 action descriptor，
 * 找出「有 handler 但无 action」的命令 —— 这些是 interceptor 改 default-deny 后会被误伤的命令。
 *
 * 用法：node scripts/plugin-command-audit.mjs
 *
 * ── 静态扫描的两个盲区（v2 修复）─────────────────────────────────────────────
 * 本脚本是正则/括号扫描，不是 TypeScript 语法树。历史上它只能识别
 * 「字面量直接写在调用点上」的注册，遇到下列两种等价写法会漏检，后果不对称：
 *
 *   1. Action 侧：`for (const spec of SPECS) actionRegistry.register({ commandType: spec.commandType, … })`
 *      —— 调用点里没有字面量，命令类型藏在数组字面量里。
 *      漏检 ⇒ **假阳性**：把已注册的命令报成缺口（`classroom.countdown.*` 5 条）。
 *   2. Handler 侧：`for (const [type, h] of Object.entries(HANDLERS)) commandBus.registerHandler(type, h)`
 *      —— 命令类型是对象的键。
 *      漏检 ⇒ **假阴性**：真缺口被静默吞掉（`resource.*` 4 条长期无人发现，即 U-11）。
 *
 * v2 为这两种写法各加一条回退解析：按 `for (const X of ARR)` / `Object.entries(NAME)`
 * 就近向上找声明，把数组项 / 对象键里的字面量收敛进来。统计口径仍是「唯一 commandType」，
 * 输出末尾会标出其中多少条来自循环/对象表解析，便于判断可信度。
 *
 * v2 同时修掉第三个口径污染：`src/` 下有两处**模板字符串里的教学示例**
 * （`pluginCenterUtils.ts` 的 `quiz.create`、`HelpView.tsx` 的 `hello.greet`），
 * 它们不是运行时注册（前端 `ctx.commandBus` 是远程代理，没有本地总线）。
 * 混进总数会让命令总数凭空虚高 2，因此 `src/` 只作「附录命中」单列，不计入配对判定。
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

/** 从 openIdx 处的开括号扫描到配对闭括号，返回 [start, end] 闭区间下标；失败返回 null。 */
function bracketSpan(s, openIdx, open = '{', close = '}') {
  if (openIdx < 0 || s[openIdx] !== open) return null;
  let depth = 0;
  for (let j = openIdx; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close) {
      depth--;
      if (depth === 0) return [openIdx, j];
    }
  }
  return null;
}

const files = [...ROOTS.flatMap((r) => walk(r)), ...EXTRA_FILES.filter((f) => fs.existsSync(f))];

const handlers = new Map(); // commandType -> file
const actions = new Map(); // commandType -> file
let handlerViaLoop = 0;
let actionViaLoop = 0;

// `src/` 里的命中**不计入命令面**：那里的 `ctx.commandBus.registerHandler(` 全部出现在
// 模板字符串里的教学示例（`pluginCenterUtils.ts` 的 `quiz.create`、`HelpView.tsx` 的
// `hello.greet`），前端也从来没有本地命令总线 —— 它的 `ctx.commandBus` 是远程代理。
// 混进总数会让「命令总数」凭空虚高 2，且改成两处示例就必须同步改文档。
const frontendHits = [];

for (const f of files) {
  const isFrontend = f === `src${path.sep}` || f.startsWith(`src${path.sep}`);
  if (isFrontend) {
    // 前端只做「收集并报告」，不参与 handler/action 配对判定
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/registerHandler\(\s*['"`]([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)['"`]/g)) {
      frontendHits.push(`${m[1]}  ${f}`);
    }
    continue;
  }
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

  /** 盲区 1：`for (const spec of ARR) … register({ commandType: spec.commandType })`
   *  → 回到 ARR 的数组字面量里收集所有 `commandType: 'x.y'`。 */
  const resolveSpecArray = (memberVar, callIdx) => {
    if (!memberVar) return [];
    const loopRe = new RegExp(`for\\s*\\(\\s*const\\s+${memberVar}\\s+of\\s+([A-Za-z_$][\\w$]*)\\s*\\)`, 'g');
    let loop = null;
    for (const m of s.matchAll(loopRe)) {
      if (m.index < callIdx) loop = m; // 取调用点之前最近的一个
    }
    if (!loop) return [];
    const arrName = loop[1];
    const declRe = new RegExp(`(?:const|let|var)\\s+${arrName}\\b[^=]*=\\s*\\[`);
    const decl = declRe.exec(s);
    if (!decl) return [];
    // 数组开括号就是匹配串的最后一个字符。不能用 `s.indexOf('[', decl.index)`：
    // 类型注解里可能有 `string[]`（如 `Array<{ required: string[] }> = [`），会先撞上它。
    const openIdx = decl.index + decl[0].length - 1;
    const span = bracketSpan(s, openIdx, '[', ']');
    if (!span) return [];
    const body = s.slice(span[0], span[1] + 1);
    return [...body.matchAll(/commandType:\s*['"`]([A-Za-z0-9_.:-]+)['"`]/g)].map((m) => m[1]);
  };

  /** 盲区 2：`for (const [type, h] of Object.entries(NAME)) registerHandler(type, h)`
   *  → 回到 NAME 的对象字面量里收集所有带引号的键。 */
  const resolveHandlerMap = (callIdx) => {
    const out = [];
    for (const m of s.matchAll(/Object\.entries\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      if (m.index > callIdx) continue;
      const mapName = m[1];
      const declRe = new RegExp(`(?:const|let|var)\\s+${mapName}\\b[^=]*=\\s*\\{`);
      const decl = declRe.exec(s);
      if (!decl) continue;
      const openIdx = decl.index + decl[0].length - 1;
      const span = bracketSpan(s, openIdx);
      if (!span) continue;
      const body = s.slice(span[0], span[1] + 1);
      for (const k of body.matchAll(/(?:^|[\s,{])['"`]([A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+)['"`]\s*:/g)) {
        out.push(k[1]);
      }
    }
    return out;
  };

  // commandBus.registerHandler(X | 'x.y' | `x.y`)
  let sawLoopHandler = false;
  for (const m of s.matchAll(/registerHandler\(\s*([A-Za-z_$][\w$]*)?[`'"]?([A-Za-z0-9_.:-]*)[`'"]?/g)) {
    const t = asCommand(resolve(m[2], m[1]));
    if (t && !handlers.has(t)) handlers.set(t, f);
    // `registerHandler(type, handler)` —— 标识符不带点、也查不到 const 绑定
    if (!t && m[1] && !m[2]) sawLoopHandler = true;
  }
  if (sawLoopHandler) {
    for (const t of resolveHandlerMap(Infinity)) {
      const cmd = asCommand(t);
      if (cmd && !handlers.has(cmd)) {
        handlers.set(cmd, f);
        handlerViaLoop++;
      }
    }
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
    // 盲区 1：`commandType: spec.commandType` → 回数组字面量里找。
    // 注意成员表达式在此正则下的落点：group1=`spec`、group2=`.commandType`
    //（字符类含 `.`），所以判据是「group2 为空或以点开头」，不能只看 `!cm[2]`。
    const isMemberExpr = cm[1] && (cm[2] === '' || cm[2].startsWith('.'));
    if (!t && isMemberExpr) {
      for (const specType of resolveSpecArray(cm[1], i)) {
        const cmd = asCommand(specType);
        if (cmd && !actions.has(cmd)) {
          actions.set(cmd, f);
          actionViaLoop++;
        }
      }
    }
    i = end;
  }
}

const sorted = (m) => [...m.keys()].sort();
const noAction = sorted(handlers).filter((t) => !actions.has(t));

console.log(`扫描文件数        : ${files.length}`);
console.log(`registerHandler   : ${handlers.size} 个唯一 commandType（其中 ${handlerViaLoop} 条由对象表解析）`);
console.log(`actionRegistry    : ${actions.size} 个唯一 commandType（其中 ${actionViaLoop} 条由规格数组解析）`);
console.log('');
console.log(`>>> 有 handler 但【无 action】（改 default-deny 后会被误伤）: ${noAction.length} 个`);
for (const t of noAction) console.log('    ' + t.padEnd(46) + handlers.get(t));

const noHandler = sorted(actions).filter((t) => !handlers.has(t));
console.log('');
console.log(`>>> 有 action 但【无 handler】（AI 工具暴露了不存在的命令）: ${noHandler.length} 个`);
for (const t of noHandler) console.log('    ' + t.padEnd(46) + actions.get(t));

if (frontendHits.length > 0) {
  console.log('');
  console.log(`>>> 附录：src/ 内命中 ${frontendHits.length} 处（模板字符串里的教学示例，不计入命令面）`);
  for (const h of frontendHits) console.log('    ' + h);
}
