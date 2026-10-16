import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { cleanStoredLessonThinkArtifacts } from '../class-passcode-crypto.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT, content TEXT)');
  return db;
}

describe('cleanStoredLessonThinkArtifacts 历史课程思维链清洗', () => {
  it('应清洗包含 <think>...</think> 的脏数据课程并保留正文大纲', () => {
    const db = createTestDb();
    const insert = db.prepare('INSERT INTO lessons (id, title, content) VALUES (?, ?, ?)');
    insert.run('les_1', 'AI 课程', '<think>模型推理过程</think>\n# 正式大纲\n## 教学目标');
    insert.run('les_2', '普通课程', '# 普通大纲\n## 教学目标');
    insert.run('les_3', '未闭合课程', '# 课程标题\n<think>未闭合思考');

    const result = cleanStoredLessonThinkArtifacts(db);
    expect(result.updated).toBe(2);
    expect(result.examined).toBe(2);

    const row1 = db.prepare('SELECT content FROM lessons WHERE id = ?').get('les_1') as { content: string };
    expect(row1.content).not.toContain('<think>');
    expect(row1.content).toBe('# 正式大纲\n## 教学目标');

    const row2 = db.prepare('SELECT content FROM lessons WHERE id = ?').get('les_2') as { content: string };
    expect(row2.content).toBe('# 普通大纲\n## 教学目标');

    const row3 = db.prepare('SELECT content FROM lessons WHERE id = ?').get('les_3') as { content: string };
    expect(row3.content).not.toContain('<think>');
    expect(row3.content).toBe('# 课程标题');
  });

  it('无脏数据时执行幂等且不更新任何行', () => {
    const db = createTestDb();
    const insert = db.prepare('INSERT INTO lessons (id, title, content) VALUES (?, ?, ?)');
    insert.run('les_1', '干净课程', '# 干净大纲');

    const first = cleanStoredLessonThinkArtifacts(db);
    expect(first.updated).toBe(0);
    expect(first.examined).toBe(0);

    const second = cleanStoredLessonThinkArtifacts(db);
    expect(second.updated).toBe(0);
  });

  it('当 lessons 表不存在时安全返回而不抛错', () => {
    const emptyDb = new Database(':memory:');
    const result = cleanStoredLessonThinkArtifacts(emptyDb);
    expect(result.updated).toBe(0);
    expect(result.examined).toBe(0);
  });
});
