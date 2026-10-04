/**
 * 系统公共资源库领域服务 (ResourceService)
 *
 * 承载系统资源查询、按路径解析目录包或单页面、磁盘缓存同步及路径防穿越防御、
 * 以及 AI 自适应交互课件自动提交代码注入。
 * 独立于 Express HTTP 传输层，可直接注入 mock/db 进行无状态单元测试。
 */
import path from 'path';
import fs from 'fs';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { randomId } from '../utils/id.js';
import { isPathInsideRoot } from '../utils/path-guard.js';
import {
  hasDataSubmission,
  hasScoreDisplay,
  injectScoreSubmissionUsingAI,
} from '../../packages/plugins/ai-submit-injector.js';

export interface SystemResourceItem {
  id: string;
  name: string;
  type: string;
  created_at: number;
  content?: string;
}

export interface ResourceFolderFile {
  path: string;
  content: string;
}

export interface ResolvedResourceFile {
  content: string | Buffer;
  contentType: string;
  isBinary: boolean;
  resourceId: string;
  resourceName: string;
}

export interface CreateResourceInput {
  name: string;
  type: string;
  content?: string;
}

export interface CreateResourceResult {
  success: boolean;
  id: string;
  name: string;
  type: string;
  aiAutoSubmitCreated?: boolean;
}

export class ResourceService {
  constructor(
    private readonly db: Database.Database = kernelContainer.db,
    private readonly aiScoreInjector: (
      db: Database.Database,
      htmlContent: string,
    ) => Promise<string> = injectScoreSubmissionUsingAI,
  ) {}

  // ── 1. 资源检索与查询 ────────────────────────────────────────────────────────

  /**
   * 获取所有公共系统资源列表（按创建时间倒序）
   */
  public listResources(): Array<Omit<SystemResourceItem, 'content'>> {
    return this.db
      .prepare('SELECT id, name, type, created_at FROM system_resources ORDER BY created_at DESC')
      .all() as Array<Omit<SystemResourceItem, 'content'>>;
  }

  /**
   * 获取指定资源原始记录
   */
  public getResource(id: string): SystemResourceItem | null {
    const resource = this.db.prepare('SELECT * FROM system_resources WHERE id = ?').get(id) as
      | SystemResourceItem
      | undefined;
    return resource || null;
  }

  // ── 2. 课件注册与物理缓存准备 ──────────────────────────────────────────────────

  /**
   * 确保课件元数据与物理磁盘 storage/courseware/ 缓存就绪
   */
  public prepareCoursewareCache(resource: SystemResourceItem): string {
    const storageDir = path.resolve(process.cwd(), 'storage', 'courseware', resource.id);

    if (resource.type === 'html') {
      const entryName =
        resource.name && (resource.name.endsWith('.html') || resource.name.endsWith('.htm'))
          ? path.basename(resource.name.replace(/\\/g, '/'))
          : 'index.html';

      // 1. Dynamic registration into courseware
      const existingCw = this.db.prepare('SELECT id FROM courseware WHERE id = ?').get(resource.id);
      if (!existingCw) {
        this.db
          .prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(resource.id, resource.id, resource.name, 'html', entryName, resource.created_at || Date.now());
      }

      // 2. 确保 storage/courseware 物理目录就绪，同时写入命名文件与 index.html 双重兜底
      try {
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
        }
        const namedPath = path.resolve(storageDir, entryName);
        if (!fs.existsSync(namedPath)) {
          fs.writeFileSync(namedPath, resource.content || '', 'utf8');
        }
        const indexHtmlPath = path.resolve(storageDir, 'index.html');
        if (!fs.existsSync(indexHtmlPath)) {
          fs.writeFileSync(indexHtmlPath, resource.content || '', 'utf8');
        }
      } catch (storageErr: any) {
        console.warn('[ResourceService] Failed to write courseware storage cache:', storageErr?.message);
      }

      return entryName;
    }

    if (resource.type === 'folder') {
      let files: ResourceFolderFile[] = [];
      try {
        files = JSON.parse(resource.content || '[]');
      } catch {
        files = [];
      }

      const indexFile =
        files.find((f) => {
          const p = f.path.toLowerCase();
          return p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html') || p.endsWith('/index.htm');
        }) ||
        files.find((f) => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')) ||
        files[0];

      const entryPath = indexFile ? indexFile.path : 'index.html';

      const existingCw = this.db.prepare('SELECT id FROM courseware WHERE id = ?').get(resource.id);
      if (!existingCw) {
        this.db
          .prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(resource.id, resource.id, resource.name, 'folder', entryPath, resource.created_at || Date.now());
      }

      try {
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
          for (const f of files) {
            if (f.path && f.content !== undefined) {
              const cleanRel = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
              const target = path.resolve(storageDir, cleanRel);
              if (!isPathInsideRoot(storageDir, target)) {
                console.warn('[ResourceService] skip path escape:', f.path);
                continue;
              }
              fs.mkdirSync(path.dirname(target), { recursive: true });
              const isBin = /\.(png|jpe?g|gif|webp|ico)$/i.test(cleanRel);
              if (isBin) {
                const cleanBase64 = f.content.replace(/^data:[^;]+;base64,/, '');
                fs.writeFileSync(target, Buffer.from(cleanBase64, 'base64'));
              } else {
                fs.writeFileSync(target, f.content, 'utf8');
              }
            }
          }
        }
      } catch (storageErr: any) {
        console.warn('[ResourceService] Failed to unpack folder to storage cache:', storageErr?.message);
      }

      return entryPath;
    }

    return 'index.html';
  }

  // ── 3. 资源内容与指定子路径文件解析 ──────────────────────────────────────────

  /**
   * 解析资源内容或文件夹内指定文件（处理单页面、目录包、MIME 类型及 Base64 转换）
   */
  public resolveResourceContent(resource: SystemResourceItem, subpath = ''): ResolvedResourceFile {
    let cleanSubpath = (subpath || '').replace(/^\/+/, '');

    // 单 HTML 资源
    if (resource.type === 'html') {
      if (cleanSubpath && cleanSubpath !== 'index.html') {
        const err = new Error('Not found for single page HTML resource') as any;
        err.status = 404;
        throw err;
      }
      return {
        content: resource.content || '',
        contentType: 'text/html; charset=utf-8',
        isBinary: false,
        resourceId: resource.id,
        resourceName: resource.name,
      };
    }

    // Folder 资源包
    let files: ResourceFolderFile[] = [];
    try {
      files = JSON.parse(resource.content || '[]');
    } catch {
      const err = new Error('Failed to parse folder content') as any;
      err.status = 500;
      throw err;
    }

    // 若未指定子路径，默认寻找入口文件
    if (!cleanSubpath) {
      const indexFile =
        files.find((f) => {
          const p = f.path.toLowerCase();
          return p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html') || p.endsWith('/index.htm');
        }) ||
        files.find((f) => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')) ||
        files[0];

      if (!indexFile) {
        const err = new Error('No index.html or entrypoint found in resource folder') as any;
        err.status = 404;
        throw err;
      }

      return {
        content: indexFile.content || '',
        contentType: 'text/html; charset=utf-8',
        isBinary: false,
        resourceId: resource.id,
        resourceName: resource.name,
      };
    }

    // 匹配特定子路径
    const normSubpath = cleanSubpath.toLowerCase().replace(/\\/g, '/');
    const fileObj = files.find((f) => {
      const p = f.path.toLowerCase().replace(/\\/g, '/');
      return p === normSubpath || p.endsWith('/' + normSubpath);
    });

    if (!fileObj) {
      const err = new Error(`File not found: ${cleanSubpath}`) as any;
      err.status = 404;
      throw err;
    }

    const filename = fileObj.path.split('/').pop() || '';
    let contentType = 'text/plain; charset=utf-8';
    if (filename.endsWith('.html') || filename.endsWith('.htm')) {
      contentType = 'text/html; charset=utf-8';
    } else if (filename.endsWith('.css')) {
      contentType = 'text/css; charset=utf-8';
    } else if (filename.endsWith('.js') || filename.endsWith('.mjs')) {
      contentType = 'application/javascript; charset=utf-8';
    } else if (filename.endsWith('.json')) {
      contentType = 'application/json; charset=utf-8';
    } else if (filename.endsWith('.svg')) {
      contentType = 'image/svg+xml; charset=utf-8';
    } else if (filename.endsWith('.png')) {
      contentType = 'image/png';
    } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (filename.endsWith('.gif')) {
      contentType = 'image/gif';
    } else if (filename.endsWith('.webp')) {
      contentType = 'image/webp';
    } else if (filename.endsWith('.ico')) {
      contentType = 'image/x-icon';
    }

    const isBinary =
      filename.endsWith('.png') ||
      filename.endsWith('.jpg') ||
      filename.endsWith('.jpeg') ||
      filename.endsWith('.gif') ||
      filename.endsWith('.webp') ||
      filename.endsWith('.ico');

    let outputContent: string | Buffer = fileObj.content;
    if (isBinary) {
      const cleanBase64 = fileObj.content.replace(/^data:[^;]+;base64,/, '');
      outputContent = Buffer.from(cleanBase64, 'base64');
    }

    return {
      content: outputContent,
      contentType,
      isBinary,
      resourceId: resource.id,
      resourceName: resource.name,
    };
  }

  // ── 4. 资源创建与 AI 智能变体 ────────────────────────────────────────────────

  /**
   * 创建系统资源，并在满足条件时自动派生 AI 智能自动打分提交版
   */
  public async createResource(input: CreateResourceInput): Promise<CreateResourceResult> {
    const { name, type, content = '' } = input;
    if (!name || !type) {
      const err = new Error('Name and type are required') as any;
      err.status = 400;
      throw err;
    }

    const id = randomId('res_');
    const createdAt = Date.now();

    this.db
      .prepare('INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, type, content, createdAt);

    let aiAutoSubmitCreated = false;

    // 尝试调用 AI 创建自动提交增强版本
    try {
      if (type === 'html') {
        if (!hasDataSubmission(content) && hasScoreDisplay(content)) {
          const modified = await this.aiScoreInjector(this.db, content);
          if (modified && modified !== content) {
            const newId = randomId('res_');
            const newName = `[自动提交版] ${name}`;
            this.db
              .prepare('INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(newId, newName, type, modified, createdAt + 10);
            aiAutoSubmitCreated = true;
          }
        }
      } else if (type === 'folder') {
        let files: ResourceFolderFile[] = [];
        try {
          files = JSON.parse(content || '[]');
        } catch {
          files = [];
        }

        const indexFile =
          files.find((f) => {
            const p = f.path.toLowerCase();
            return p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html') || p.endsWith('/index.htm');
          }) ||
          files.find((f) => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')) ||
          files[0];

        if (indexFile && indexFile.content) {
          if (!hasDataSubmission(indexFile.content) && hasScoreDisplay(indexFile.content)) {
            const modified = await this.aiScoreInjector(this.db, indexFile.content);
            if (modified && modified !== indexFile.content) {
              const modifiedFiles = files.map((f) => {
                if (f.path === indexFile.path) {
                  return { ...f, content: modified };
                }
                return f;
              });
              const newId = randomId('res_');
              const newName = `[自动提交版] ${name}`;
              this.db
                .prepare('INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(newId, newName, type, JSON.stringify(modifiedFiles), createdAt + 10);
              aiAutoSubmitCreated = true;
            }
          }
        }
      }
    } catch (aiErr: any) {
      console.warn('[ResourceService] Failed to create AI modified version:', aiErr?.message);
    }

    return {
      success: true,
      id,
      name,
      type,
      aiAutoSubmitCreated,
    };
  }

  /**
   * 删除系统资源
   */
  public deleteResource(id: string): boolean {
    const info = this.db.prepare('DELETE FROM system_resources WHERE id = ?').run(id);
    return info.changes > 0;
  }
}

export const resourceService = new ResourceService();
