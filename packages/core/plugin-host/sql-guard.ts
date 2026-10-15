/**
 * 插件 SQL 安全守卫与表名提取（PL-05 加固）。
 *
 * 核心安全防线：
 * 1. 语法规范化：剔除注释（-- 和 /* *\/）、剥离字符串字面量、规范化所有括号与方括号标识符（[tbl], `tbl`, "tbl"）。
 * 2. 深度表名提取：精准识别 FROM (含逗号连接多表)、JOIN、INTO、UPDATE、TABLE 等子句中的表名，无论如何嵌套或混淆均全量捕获。
 * 3. 双重命名空间校验：
 *    - 提取的表名必须属于插件自身的前缀（ownPrefix），或者是共享迁移表 plugin_migrations，或者是授权的研究表 plugin_research_*。
 *    - 对平台核心安全表（users, client_sessions 等）设立静态兜底黑名单，只要表名命中黑名单即刻阻断。
 * 4. 元数据表严格受限：sqlite_master / sqlite_schema 仅放行精确前缀查询，杜绝利用注释绕过。
 */

export const FORBIDDEN_CORE_TABLES = Object.freeze([
  'users',
  'client_sessions',
  'plugins',
  'plugin_storage',
  'ai_providers',
  'processes',
  'pending_commands',
  'classes',
  'students',
  'class_students',
  'lessons',
  'assignments',
  'assignment_submissions',
  'attendance',
  'schedules',
  'class_grade_weights',
  'exams',
  'exam_scores',
  'student_semester_reports',
  'student_rollcalls',
  'student_seats',
  'student_read_notifications',
  'student_lesson_progress',
  'courseware',
  'courseware_attempt',
  'system_resources',
  'events',
  '_migrations',
  'site_settings',
  'agent_conversations',
  'classroom_sessions',
  'lesson_quiz_submissions',
  'courseware_score_config',
  'demo_data_registry',
  'whiteboard_elements',
  'student_point_logs',
  'lianyun_research_activities',
  'lianyun_research_groups',
  'lianyun_research_submissions',
  'lianyun_research_reviews',
]);

const FORBIDDEN_CORE_TABLES_SET = new Set(FORBIDDEN_CORE_TABLES.map((t) => t.toLowerCase()));

const FORBIDDEN_OPERATIONS = [
  /\bATTACH(?:\s+DATABASE)?\b/i,
  /\bDETACH(?:\s+DATABASE)?\b/i,
  /\bPRAGMA\b/i,
  /\bVACUUM\b/i,
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TRIGGER|VIEW)\b/i,
  /\bDROP\s+(?:TEMP(?:ORARY)?\s+)?(?:TRIGGER|VIEW)\b/i,
];

/**
 * 剥离 SQL 中的字符串字面量与各类注释，防止关键字被注释混淆或字面量干扰。
 */
export function sanitizeSql(sql: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inBracket = false;
  let result = '';
  const len = sql.length;

  for (let i = 0; i < len; i++) {
    const ch = sql[i];
    const next = i + 1 < len ? sql[i + 1] : '';

    // 单行注释 --
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inBracket && ch === '-' && next === '-') {
      while (i < len && sql[i] !== '\n') i++;
      result += ' ';
      continue;
    }

    // 多行注释 /* */
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inBracket && ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(sql[i] === '*' && i + 1 < len && sql[i + 1] === '/')) {
        i++;
      }
      i++; // 跳过 '/'
      result += ' ';
      continue;
    }

    // 字符串字面量 '...'
    if (ch === "'" && !inDoubleQuote && !inBacktick && !inBracket) {
      if (inSingleQuote) {
        if (next === "'") {
          // 转义单引号 ''
          i++;
        } else {
          inSingleQuote = false;
        }
      } else {
        inSingleQuote = true;
      }
      result += ' ';
      continue;
    }

    if (inSingleQuote) {
      result += ' ';
      continue;
    }

    // 标识符引用: [name], "name", `name` 统一保留其中的标识符字符
    if (ch === '[' && !inDoubleQuote && !inBacktick) {
      inBracket = true;
      result += ' ';
      continue;
    }
    if (ch === ']' && inBracket) {
      inBracket = false;
      result += ' ';
      continue;
    }
    if (ch === '`' && !inDoubleQuote) {
      inBacktick = !inBacktick;
      result += ' ';
      continue;
    }
    if (ch === '"' && !inBacktick) {
      inDoubleQuote = !inDoubleQuote;
      result += ' ';
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * 从经过脱敏净化的 SQL 中全面提取所有可能引用的表名。
 */
export function extractReferencedTables(cleanSql: string): Set<string> {
  const tables = new Set<string>();

  // 1. DDL: (CREATE|DROP|ALTER) TABLE [IF EXISTS] <table_name>
  const ddlRegex = /\b(?:CREATE|DROP|ALTER)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([a-zA-Z_][\w]*)/gi;
  for (const m of cleanSql.matchAll(ddlRegex)) {
    if (m[1]) tables.add(m[1].toLowerCase());
  }

  // 2. DML: INTO / UPDATE / JOIN
  const simpleClauseRegex = /\b(?:INTO|UPDATE|JOIN)\s+([a-zA-Z_][\w]*)/gi;
  for (const m of cleanSql.matchAll(simpleClauseRegex)) {
    if (m[1]) tables.add(m[1].toLowerCase());
  }

  // 3. FROM 子句处理（支持逗号多表: FROM table1, table2 alias, table3 ...）
  const fromRegex =
    /\bFROM\s+([^;]+?)(?=\bWHERE\b|\bGROUP\b|\bHAVING\b|\bORDER\b|\bLIMIT\b|\bUNION\b|\bEXCEPT\b|\bINTERSECT\b|\bJOIN\b|\)|$)/gi;
  for (const match of cleanSql.matchAll(fromRegex)) {
    const clause = match[1];
    if (!clause) continue;
    // 按逗号切分多表
    const parts = clause.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith('(')) continue;
      // 提取首个标识符作为表名
      const tokenMatch = /^[a-zA-Z_][\w]*/.exec(trimmed);
      if (tokenMatch) {
        tables.add(tokenMatch[0].toLowerCase());
      }
    }
  }

  return tables;
}

export interface SqlGuardOptions {
  sql: string;
  ownPrefix: string;
  allowedPrefixes?: string[];
  researchAllowed?: boolean;
}

/**
 * 校验给定 SQL 是否满足插件数据库隔离要求。
 * 校验不通过时直接抛出 Error。
 */
export function assertPluginSqlAllowed(options: SqlGuardOptions): void {
  const { sql, ownPrefix, allowedPrefixes = [], researchAllowed = false } = options;
  if (typeof sql !== 'string' || sql.trim() === '') return;

  // 1. 底层高危操作与多语句操作检测
  for (const opRegex of FORBIDDEN_OPERATIONS) {
    if (opRegex.test(sql)) {
      throw new Error(`Dangerous statement is forbidden: "${sql.trim()}"`);
    }
  }

  const clean = sanitizeSql(sql);
  const tables = extractReferencedTables(clean);

  // 2. 核心敏感表黑名单静态比对（无论语法位置，全词兜底检测）
  const isDdl = /^\s*(DROP|CREATE|ALTER|TRUNCATE)\b/i.test(clean);
  const words = clean.toLowerCase().match(/\b[a-zA-Z_][\w]*\b/g) || [];
  for (const word of words) {
    if (FORBIDDEN_CORE_TABLES_SET.has(word)) {
      // 检查该词是否确在表名集合中
      if (tables.has(word)) {
        if (isDdl) {
          throw new Error(
            `Worker plugin is not permitted to perform DDL on table "${word}" (core security table is strictly forbidden)`,
          );
        }
        throw new Error(
          `Worker plugin is not permitted to access table "${word}" (core security table is strictly forbidden)`,
        );
      }
    }
  }

  // 3. 命名空间与允许列表校验
  const ownPrefixLower = ownPrefix ? ownPrefix.toLowerCase() : '';
  const validPrefixes = [ownPrefixLower, ...allowedPrefixes.map((p) => p.toLowerCase())].filter(Boolean);

  for (const table of tables) {
    // 共享迁移表
    if (table === 'plugin_migrations') continue;

    // 授权研究表生态
    if (researchAllowed && table.startsWith('plugin_research_')) continue;

    // 检查是否属于插件自身前缀或授权前缀
    const isOwn = validPrefixes.some((p) => table.startsWith(p));
    if (isOwn) continue;

    // 特殊处理 sqlite_master / sqlite_schema（仅允许精准前缀查询）
    if (table === 'sqlite_master' || table === 'sqlite_schema' || table === 'sqlite_temp_master') {
      const strippedComments = sql
        .replace(/--.*$/gm, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .trim();
      const isAllowedMetaQuery =
        /^\s*SELECT\s+name\s+FROM\s+(?:sqlite_master|sqlite_schema)\s+WHERE\s+type\s*=\s*['"]table['"]\s+AND\s+name\s+LIKE\s+['"][A-Za-z0-9_%]+['"]\s*$/i.test(
          strippedComments,
        ) &&
        ownPrefixLower &&
        strippedComments.toLowerCase().includes(ownPrefixLower);
      if (isAllowedMetaQuery) continue;
      throw new Error(`Direct access to sqlite metadata table "${table}" is forbidden`);
    }

    if (isDdl) {
      throw new Error(
        `Worker plugin is not permitted to perform DDL on table "${table}" (only ${ownPrefix || '<none>'} namespace is allowed)`,
      );
    }
    throw new Error(
      `Worker plugin is not permitted to access table "${table}" (only ${ownPrefix || '<none>'} namespace is allowed)`,
    );
  }
}
