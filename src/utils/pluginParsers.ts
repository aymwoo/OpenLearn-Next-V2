import { splitCsvLine, findHeaderIdx } from '../services/bulkImportService';

interface ParsedManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  capabilitiesProposed?: string[];
}

interface ParsedAction {
  id: string;
  commandType: string;
  description?: string;
}

const parsePluginSource = (sourceCode: string) => {
  const actions: ParsedAction[] = [];

  try {
    // SEC-SANDBOX: 静态解析插件源码，杜绝在浏览器主线程中使用 new Function 执行任意不可信脚本
    const manifestBlockMatch = sourceCode.match(/manifest\s*:\s*\{([\s\S]*?)\}(?:\s*,|\s*\})/);
    const manifestScope = manifestBlockMatch ? manifestBlockMatch[1] : sourceCode;

    const idMatch = manifestScope.match(/id\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/id\s*:\s*['"]([^'"]+)['"]/);
    const nameMatch =
      manifestScope.match(/name\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const verMatch =
      manifestScope.match(/version\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/version\s*:\s*['"]([^'"]+)['"]/);
    const descMatch =
      manifestScope.match(/description\s*:\s*['"]([^'"]+)['"]/) ||
      sourceCode.match(/description\s*:\s*['"]([^'"]+)['"]/);
    const authorMatch =
      manifestScope.match(/author\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/author\s*:\s*['"]([^'"]+)['"]/);

    let capabilities: string[] = [];
    const capsMatch =
      manifestScope.match(/capabilitiesProposed\s*:\s*\[([\s\S]*?)\]/) ||
      sourceCode.match(/capabilitiesProposed\s*:\s*\[([\s\S]*?)\]/);
    if (capsMatch) {
      capabilities = capsMatch[1]
        .split(',')
        .map((s) => s.replace(/['"\s]/g, ''))
        .filter((s) => s.length > 0);
    }

    const mergedManifest: ParsedManifest = {
      id: idMatch?.[1] || undefined,
      name: nameMatch?.[1] || undefined,
      version: verMatch?.[1] || undefined,
      description: descMatch?.[1] || undefined,
      author: authorMatch?.[1] || undefined,
      capabilitiesProposed: capabilities.length > 0 ? capabilities : undefined,
    };

    const actionBlockRegex = /actionRegistry\.register\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
    let match;
    const codesToSearch = sourceCode;
    while ((match = actionBlockRegex.exec(codesToSearch)) !== null) {
      const block = match[1];
      const cmdIdLoc = block.match(/id\s*:\s*['"]([^'"]+)['"]/);
      const cmdTypeLoc = block.match(/commandType\s*:\s*['"]([^'"]+)['"]/);
      const cmdDescLoc = block.match(/description\s*:\s*['"]([^'"]+)['"]/);

      if (cmdIdLoc || cmdTypeLoc) {
        actions.push({
          id: cmdIdLoc ? cmdIdLoc[1] : 'unknown',
          commandType: cmdTypeLoc ? cmdTypeLoc[1] : 'unknown',
          description: cmdDescLoc ? cmdDescLoc[1] : '',
        });
      }
    }

    return {
      manifest: mergedManifest,
      actions: actions,
      error: null,
    };
  } catch (err: any) {
    return {
      manifest: null,
      actions: [],
      error: err.toString(),
    };
  }
};

/**
 * 班级面板「批量加入学生」用的 CSV 解析。
 *
 * 与 `services/bulkImportService.ts` 共用同一套拆行逻辑与列名候选表 ——
 * 此前这里是一份独立实现，只认学号/姓名/邮箱，且列名用 `includes()` 模糊匹配，
 * 导致「学生备注」这类新列可能被误判成「学生姓名」而整体错位。
 */
const parseCSV = (
  text: string,
): { name: string; email: string; student_number?: string; password?: string; private_notes?: string }[] => {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const separators = [',', ';', '\t'];
  let sep = ',';
  let maxCount = 0;
  separators.forEach((s) => {
    const count = headerLine.split(s).length;
    if (count > maxCount) {
      maxCount = count;
      sep = s;
    }
  });

  const headers = splitCsvLine(headerLine, sep).map((h) =>
    h
      .toLowerCase()
      .replace(/["'\r]/g, '')
      .trim(),
  );

  const studentNumIdx = findHeaderIdx(headers, [
    '学生学号',
    'student_number',
    'studentnumber',
    'student number',
    'student_id',
    'studentid',
    '学号',
    '编号',
  ]);
  const nameIdx = findHeaderIdx(headers, [
    '学生姓名',
    'student_name',
    'studentname',
    'student name',
    '姓名',
    '学生',
    'name',
  ]);
  const emailIdx = findHeaderIdx(headers, [
    '学生邮箱',
    'student_email',
    'studentemail',
    'student email',
    '邮箱',
    'email',
    'mail',
  ]);
  const passwordIdx = findHeaderIdx(headers, ['初始密码', 'initial password', 'password', 'passwd', 'pwd', '密码']);
  const notesIdx = findHeaderIdx(headers, [
    '学生备注',
    'student notes',
    'private_notes',
    '备注',
    'note',
    'notes',
    'remark',
  ]);

  // 无表头时沿用「第一列姓名、第二列邮箱」的位置兜底（教师随手粘贴的常见形态）
  const finalNameIdx = nameIdx >= 0 ? nameIdx : 0;
  const finalEmailIdx = emailIdx >= 0 ? emailIdx : 1;

  const list: { name: string; email: string; student_number?: string; password?: string; private_notes?: string }[] =
    [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitCsvLine(lines[i], sep);
    const clean = (idx: number) => (idx >= 0 && cols[idx] ? cols[idx].replace(/["'\r]/g, '').trim() : '');

    const name = clean(finalNameIdx);
    if (!name) continue;

    const student_number = clean(studentNumIdx);
    const password = clean(passwordIdx);
    const private_notes = clean(notesIdx);

    list.push({
      name,
      email: clean(finalEmailIdx),
      ...(student_number ? { student_number } : {}),
      ...(password ? { password } : {}),
      ...(private_notes ? { private_notes } : {}),
    });
  }
  return list;
};

export { parsePluginSource, parseCSV };
export type { ParsedManifest, ParsedAction };
