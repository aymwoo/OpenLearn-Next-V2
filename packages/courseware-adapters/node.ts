/**
 * 课件协议识别的 Node 侧能力（磁盘扫描 + 旁车文件）。
 *
 * 之所以不新增数据库列：Issue IKYP8P 阶段 A 明确允许「本阶段可不改表」。
 * 上传时把识别结果写到课件存储根目录的旁车文件，渲染时优先读旁车；
 * 老课件没有旁车则现场扫描清单文件，仍可被适配器覆盖。
 */
import fs from 'fs';
import path from 'path';
import { detectProtocolFromManifestFiles, normalizeCoursewareProtocol } from './protocol.js';
import type { CoursewareProtocol, ManifestFileLike, ProtocolDetectionResult } from './types.js';

/** 旁车文件名（不参与 ZIP 资源加载，带点前缀隐藏）。 */
export const PROTOCOL_SIDECAR_FILENAME = '.openlearn-courseware.json';

export interface ProtocolSidecar {
  protocol: CoursewareProtocol;
  detected_at: number;
  evidence?: string[];
}

export interface DirectoryDetectionOptions {
  /** 最大目录深度，默认 2（ZIP 常在最外层套一层文件夹） */
  maxDepth?: number;
  /** 最多检查的文件数，防御超大包，默认 5000 */
  maxFiles?: number;
}

function isManifestName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'imsmanifest.xml' || lower === 'tincan.xml' || lower === 'activity.json' || lower === 'h5p.json';
}

/** 扫描目录内（有界深度）的协议清单文件。 */
export function detectProtocolInDirectory(
  dir: string,
  options: DirectoryDetectionOptions = {},
): ProtocolDetectionResult {
  const maxDepth = options.maxDepth ?? 2;
  const maxFiles = options.maxFiles ?? 5000;
  const files: ManifestFileLike[] = [];
  let scanned = 0;

  const walk = (current: string, depth: number): void => {
    if (depth > maxDepth || scanned >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= maxFiles) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(current, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      scanned += 1;
      if (!isManifestName(entry.name)) continue;
      const relativePath = path.relative(dir, fullPath).split(path.sep).join('/');
      let content: string | undefined;
      if (entry.name.toLowerCase() === 'imsmanifest.xml') {
        try {
          if (stat.size <= 512 * 1024) content = fs.readFileSync(fullPath, 'utf8');
        } catch {
          content = undefined;
        }
      }
      files.push({ path: relativePath, content });
    }
  };

  walk(dir, 0);
  return detectProtocolFromManifestFiles(files);
}

export function readProtocolSidecar(dir: string): CoursewareProtocol | null {
  try {
    const raw = fs.readFileSync(path.join(dir, PROTOCOL_SIDECAR_FILENAME), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProtocolSidecar>;
    if (!parsed || typeof parsed.protocol !== 'string') return null;
    return normalizeCoursewareProtocol(parsed.protocol);
  } catch {
    return null;
  }
}

export function writeProtocolSidecar(dir: string, protocol: CoursewareProtocol, evidence: string[] = []): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const payload: ProtocolSidecar = {
      protocol: normalizeCoursewareProtocol(protocol),
      detected_at: Date.now(),
      evidence,
    };
    fs.writeFileSync(path.join(dir, PROTOCOL_SIDECAR_FILENAME), JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // 旁车只是加速缓存，写失败不影响渲染（渲染时会现场扫描）
  }
}

/**
 * 解析某个课件存储目录的协议：旁车优先，其次现场扫描，最后回落 html。
 * 目录不存在（内联 HTML / 系统资源）直接返回 html。
 */
export function resolveProtocolForStorageDir(dir: string): CoursewareProtocol {
  if (!dir) return 'html';
  const sidecar = readProtocolSidecar(dir);
  if (sidecar) return sidecar;
  if (!fs.existsSync(dir)) return 'html';
  return detectProtocolInDirectory(dir).protocol;
}
