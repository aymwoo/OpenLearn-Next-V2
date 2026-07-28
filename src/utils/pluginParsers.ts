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
  let manifest: ParsedManifest | null = null;
  const actions: ParsedAction[] = [];

  try {
    const cleanCode = sourceCode
      .replace(/require\s*\(.*?\)/g, '{}')
      .replace(/import\s+.*?\s+from\s*['"].*?['"]/g, '');

    try {
      const runner = new Function('exports', `
        try {
          ${cleanCode};
          exports.default = exports.default || exports;
        } catch(e) {}
      `);
      const mockExports = {} as any;
      runner(mockExports);
      const evaluated = mockExports.default || mockExports;
      if (evaluated && evaluated.manifest) {
        manifest = evaluated.manifest;
      }
    } catch (e: any) {
      // Ignore evaluation error, fallback to regex
    }

    const idMatch = sourceCode.match(/id\s*:\s*['"]([^'"]+)['"]/);
    const nameMatch = sourceCode.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const verMatch = sourceCode.match(/version\s*:\s*['"]([^'"]+)['"]/);
    const descMatch = sourceCode.match(/description\s*:\s*['"]([^'"]+)['"]/);
    const authorMatch = sourceCode.match(/author\s*:\s*['"]([^'"]+)['"]/);

    let capabilities: string[] = [];
    const capsMatch = sourceCode.match(/capabilitiesProposed\s*:\s*\[([\s\S]*?)\]/);
    if (capsMatch) {
      capabilities = capsMatch[1]
        .split(',')
        .map(s => s.replace(/['"\s]/g, ''))
        .filter(s => s.length > 0);
    }

    const mergedManifest: ParsedManifest = {
      id: manifest?.id || idMatch?.[1] || undefined,
      name: manifest?.name || nameMatch?.[1] || undefined,
      version: manifest?.version || verMatch?.[1] || undefined,
      description: manifest?.description || descMatch?.[1] || undefined,
      author: manifest?.author || authorMatch?.[1] || undefined,
      capabilitiesProposed: manifest?.capabilitiesProposed || (capabilities.length > 0 ? capabilities : undefined)
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
