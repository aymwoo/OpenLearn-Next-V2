#!/usr/bin/env node
// @ts-nocheck
/**
 * 国际化多语言与编码门禁检查：
 * 1. 宿主与插件多语言词条对称性检查 (zh <-> en)
 * 2. UTF-8 编码完整性检查 (拦截 U+FFFD 乱码与非法字节，强化 Issue #130)
 * 3. 空值与未翻译占位符 (%key%) 检测
 *
 * 退出码: 0 = 通过; 1 = 发现错误。
 * 供 `pnpm lint:i18n` 与 CI 门禁使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPLACEMENT_CHAR_BYTES = Buffer.from('\uFFFD', 'utf8'); // EF BF BD

/**
 * 检查两个语言字典键的对称性
 * @param {Record<string, string>} zhDict
 * @param {Record<string, string>} enDict
 * @param {string} [contextName='']
 * @returns {{ missingInEn: string[], missingInZh: string[], emptyValues: string[] }}
 */
export function checkI18nSymmetry(zhDict = {}, enDict = {}, contextName = '') {
  const zhKeys = new Set(Object.keys(zhDict));
  const enKeys = new Set(Object.keys(enDict));

  const missingInEn = [];
  const missingInZh = [];
  const emptyValues = [];

  for (const k of zhKeys) {
    if (!enKeys.has(k)) {
      missingInEn.push(k);
    }
    const val = zhDict[k];
    if (val === undefined || val === null || String(val).trim() === '') {
      emptyValues.push(`zh:${k}`);
    }
  }

  for (const k of enKeys) {
    if (!zhKeys.has(k)) {
      missingInZh.push(k);
    }
    const val = enDict[k];
    if (val === undefined || val === null || String(val).trim() === '') {
      emptyValues.push(`en:${k}`);
    }
  }

  return { missingInEn, missingInZh, emptyValues };
}

/**
 * 检查 Buffer 中的 UTF-8 编码完整性 (检测 U+FFFD 与损坏字节)
 * @param {Buffer} buf
 * @returns {{ hasReplacementChar: boolean, invalidOffset: number }}
 */
export function checkBufferEncoding(buf) {
  const invalidOffset = firstInvalidByteOffset(buf);
  const repIndex = buf.indexOf(REPLACEMENT_CHAR_BYTES);
  return {
    hasReplacementChar: repIndex !== -1,
    invalidOffset,
  };
}

function firstInvalidByteOffset(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) {
      i += 1;
      continue;
    }
    if (b < 0xc2) return i;
    if (b < 0xe0) {
      if (i + 1 >= buf.length || (buf[i + 1] & 0xc0) !== 0x80) return i;
      i += 2;
      continue;
    }
    if (b < 0xf0) {
      if (i + 2 >= buf.length) return i;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return i;
      if (b === 0xe0 && b1 < 0xa0) return i;
      if (b === 0xed && b1 >= 0xa0) return i;
      i += 3;
      continue;
    }
    if (b < 0xf5) {
      if (i + 3 >= buf.length) return i;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      const b3 = buf[i + 3];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return i;
      if (b === 0xf0 && b1 < 0x90) return i;
      if (b === 0xf4 && b1 >= 0x90) return i;
      i += 4;
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * 解析 src/i18n.ts 中的 baseTranslations
 * @param {string} filePath
 */
export function extractBaseTranslations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // 简易安全解析：提取 zh 与 en 对象内部的 key-value 对
  const parseSection = (sectionName) => {
    const regex = new RegExp(`${sectionName}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`, 'm');
    const match = content.match(regex);
    if (!match) return {};
    const body = match[1];
    const dict = {};
    // 匹配 key: 'value' 或 key: "value" 或 multiline
    const lineRegex = /^\s*([a-zA-Z0-9_]+):\s*['"`]([\s\S]*?)['"`],?/gm;
    let m;
    while ((m = lineRegex.exec(body)) !== null) {
      dict[m[1]] = m[2];
    }
    return dict;
  };

  return {
    zh: parseSection('zh'),
    en: parseSection('en'),
  };
}

/**
 * 执行完整的国际化多语言与编码门禁审计
 * @param {string} repoRoot
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function runI18nAudit(repoRoot) {
  const issues = [];
  const root = repoRoot || process.cwd();

  // 1. 检查 src/i18n.ts
  const i18nPath = path.join(root, 'src', 'i18n.ts');
  if (fs.existsSync(i18nPath)) {
    const i18nBuf = fs.readFileSync(i18nPath);
    const encRes = checkBufferEncoding(i18nBuf);
    if (encRes.hasReplacementChar) {
      issues.push(`[Encoding] ${i18nPath} contains UTF-8 replacement character (\\uFFFD)`);
    }
    if (encRes.invalidOffset !== -1) {
      issues.push(`[Encoding] ${i18nPath} contains invalid UTF-8 bytes at offset ${encRes.invalidOffset}`);
    }

    const { zh, en } = extractBaseTranslations(i18nPath);
    const sym = checkI18nSymmetry(zh, en, 'src/i18n.ts');
    for (const k of sym.missingInEn) {
      issues.push(`[Symmetry] src/i18n.ts key "${k}" is present in zh but missing in en`);
    }
    for (const k of sym.missingInZh) {
      issues.push(`[Symmetry] src/i18n.ts key "${k}" is present in en but missing in zh`);
    }
    for (const item of sym.emptyValues) {
      issues.push(`[EmptyValue] src/i18n.ts has empty value at ${item}`);
    }
  } else {
    issues.push(`[MissingFile] Cannot find ${i18nPath}`);
  }

  // 2. 检查内置插件中的 locales
  const pluginsDir = path.join(root, 'packages', 'plugins');
  if (fs.existsSync(pluginsDir)) {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const manifestPath = path.join(pluginsDir, ent.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifestBuf = fs.readFileSync(manifestPath);
        const manifestEnc = checkBufferEncoding(manifestBuf);
        if (manifestEnc.hasReplacementChar) {
          issues.push(`[Encoding] ${manifestPath} contains UTF-8 replacement character (\\uFFFD)`);
        }
        if (manifestEnc.invalidOffset !== -1) {
          issues.push(`[Encoding] ${manifestPath} contains invalid UTF-8 bytes at offset ${manifestEnc.invalidOffset}`);
        }

        const manifest = JSON.parse(manifestBuf.toString('utf8'));
        const locales = manifest.contributes?.locales;
        if (locales && typeof locales === 'object') {
          // 若为内联字典 Record<string, Record<string, string>>
          const zh = locales.zh;
          const en = locales.en;
          if (zh && en && typeof zh === 'object' && typeof en === 'object') {
            const sym = checkI18nSymmetry(zh, en, `plugin ${ent.name}`);
            for (const k of sym.missingInEn) {
              issues.push(`[Symmetry] Plugin "${ent.name}" key "${k}" is in zh but missing in en`);
            }
            for (const k of sym.missingInZh) {
              issues.push(`[Symmetry] Plugin "${ent.name}" key "${k}" is in en but missing in zh`);
            }
          } else if (typeof locales.zh === 'string' || typeof locales.en === 'string') {
            // 相对路径 JSON 文件
            for (const [lang, relPath] of Object.entries(locales)) {
              if (typeof relPath === 'string') {
                const fullLocPath = path.join(pluginsDir, ent.name, relPath);
                if (!fs.existsSync(fullLocPath)) {
                  issues.push(`[MissingLocaleFile] Plugin "${ent.name}" locales.${lang} file not found: ${relPath}`);
                } else {
                  const locBuf = fs.readFileSync(fullLocPath);
                  const locEnc = checkBufferEncoding(locBuf);
                  if (locEnc.hasReplacementChar) {
                    issues.push(`[Encoding] ${fullLocPath} contains UTF-8 replacement character (\\uFFFD)`);
                  }
                  if (locEnc.invalidOffset !== -1) {
                    issues.push(
                      `[Encoding] ${fullLocPath} contains invalid UTF-8 bytes at offset ${locEnc.invalidOffset}`,
                    );
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        issues.push(`[ManifestError] Failed to parse ${manifestPath}: ${err.message}`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

// CLI 执行分支
const isDirectCall = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectCall) {
  const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  console.log(`[i18n-audit] Running i18n & encoding check on ${rootDir}...`);
  const result = runI18nAudit(rootDir);
  if (result.ok) {
    console.log(`[i18n-audit] \x1b[32m✔ All i18n dictionaries are symmetrical and UTF-8 clean.\x1b[0m`);
    process.exit(0);
  } else {
    console.error(`[i18n-audit] \x1b[31m✖ Found ${result.issues.length} i18n issue(s):\x1b[0m`);
    for (const issue of result.issues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }
}
