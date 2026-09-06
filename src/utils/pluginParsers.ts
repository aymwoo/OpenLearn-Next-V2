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
    const nameMatch = manifestScope.match(/name\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const verMatch = manifestScope.match(/version\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/version\s*:\s*['"]([^'"]+)['"]/);
    const descMatch = manifestScope.match(/description\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/description\s*:\s*['"]([^'"]+)['"]/);
    const authorMatch = manifestScope.match(/author\s*:\s*['"]([^'"]+)['"]/) || sourceCode.match(/author\s*:\s*['"]([^'"]+)['"]/);

    let capabilities: string[] = [];
    const capsMatch =
      manifestScope.match(/capabilitiesProposed\s*:\s*\[([\s\S]*?)\]/) ||
      sourceCode.match(/capabilitiesProposed\s*:\s*\[([\s\S]*?)\]/);
    if (capsMatch) {
      capabilities = capsMatch[1]
        .split(',')
        .map(s => s.replace(/['"\s]/g, ''))
        .filter(s => s.length > 0);
    }

    const mergedManifest: ParsedManifest = {
      id: idMatch?.[1] || undefined,
      name: nameMatch?.[1] || undefined,
      version: verMatch?.[1] || undefined,
      description: descMatch?.[1] || undefined,
      author: authorMatch?.[1] || undefined,
      capabilitiesProposed: capabilities.length > 0 ? capabilities : undefined
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
          description: cmdDescLoc ? cmdDescLoc[1] : ''
        });
      }
    }

    return {
      manifest: mergedManifest,
      actions: actions,
      error: null
    };
  } catch (err: any) {
    return {
      manifest: null,
      actions: [],
      error: err.toString()
    };
  }
};

const parseCSV = (text: string): { name: string; email: string }[] => {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const separators = [',', ';', '\t'];
  let sep = ',';
  let maxCount = 0;
  separators.forEach(s => {
    const count = headerLine.split(s).length;
    if (count > maxCount) {
      maxCount = count;
      sep = s;
    }
  });

  const parseRow = (rowText: string): string[] => {
    const result: string[] = [];
    let insideQuote = false;
    let entry = '';
    for (let i = 0; i < rowText.length; i++) {
      const char = rowText[i];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === sep && !insideQuote) {
        result.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    result.push(entry.trim());
    return result;
  };

  const headers = parseRow(headerLine).map(h => h.toLowerCase().replace(/["'\r]/g, '').trim());

  const nameIdx = headers.findIndex(h =>
    h.includes('name') || h.includes('student') || h.includes('姓名') || h.includes('学生')
  );
  const emailIdx = headers.findIndex(h =>
    h.includes('email') || h.includes('mail') || h.includes('邮箱')
  );

  const finalNameIdx = nameIdx >= 0 ? nameIdx : 0;
  const finalEmailIdx = emailIdx >= 0 ? emailIdx : 1;

  const list: { name: string; email: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseRow(lines[i]);
    const name = cols[finalNameIdx] ? cols[finalNameIdx].replace(/["'\r]/g, '').trim() : '';
    const email = cols[finalEmailIdx] ? cols[finalEmailIdx].replace(/["'\r]/g, '').trim() : '';
    if (name) {
      list.push({ name, email });
    }
  }
  return list;
};

export { parsePluginSource, parseCSV };
export type { ParsedManifest, ParsedAction };
