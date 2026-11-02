/**
 * 受管名册服务（Issue #366）
 *
 * 重点不是 SQL 正确性，而是「返回体只含该给的字段」——
 * 受管通道存在的意义就是让插件拿不到 email / private_notes / password / 班级口令。
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClassRosterService } from '../roster-service.js';

describe('ClassRosterService', () => {
  let db: Database.Database;
  let service: ClassRosterService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE classes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, lab_id TEXT,
        class_passcode TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE students (
        id TEXT PRIMARY KEY, student_number TEXT UNIQUE, name TEXT NOT NULL, email TEXT,
        password TEXT, private_notes TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE class_students (
        class_id TEXT NOT NULL, student_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
        PRIMARY KEY (class_id, student_id)
      );
    `);
    db.prepare('INSERT INTO classes (id, name, class_passcode, created_at) VALUES (?, ?, ?, ?)').run(
      'c1',
      '高一（1）班',
      'secret-passcode',
      100,
    );
    db.prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)').run('c2', '高一（2）班', 200);
    db.prepare(
      'INSERT INTO students (id, student_number, name, email, password, private_notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('s1', '2026001', '张三', 'z@example.com', 'hash', '家庭情况备注', 1);
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      's2',
      '2026002',
      '李四',
      'l@example.com',
      2,
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run('c1', 's1', 1);
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run('c1', 's2', 2);
  });

  afterEach(() => db.close());

  it('listClasses 返回 id / name / 人数，按创建时间倒序', async () => {
    service = new ClassRosterService(db);
    const classes = await service.listClasses();

    expect(classes).toEqual([
      { id: 'c2', name: '高一（2）班', studentCount: 0 },
      { id: 'c1', name: '高一（1）班', studentCount: 2 },
    ]);
    // 班级口令不能泄露
    expect(JSON.stringify(classes)).not.toContain('secret-passcode');
  });

  it('listClassStudents 只返回 id / name / studentNumber', async () => {
    service = new ClassRosterService(db);
    const students = await service.listClassStudents('c1');

    expect(students).toEqual([
      { id: 's1', name: '张三', studentNumber: '2026001' },
      { id: 's2', name: '李四', studentNumber: '2026002' },
    ]);
    const serialized = JSON.stringify(students);
    expect(serialized).not.toContain('z@example.com');
    expect(serialized).not.toContain('家庭情况备注');
    expect(serialized).not.toContain('hash');
  });

  it('getStudent 命中返回最小字段，未命中返回 null', async () => {
    service = new ClassRosterService(db);
    await expect(service.getStudent('s1')).resolves.toEqual({
      id: 's1',
      name: '张三',
      studentNumber: '2026001',
    });
    await expect(service.getStudent('missing')).resolves.toBeNull();
  });

  it('空班级返回空数组而不是抛错', async () => {
    service = new ClassRosterService(db);
    await expect(service.listClassStudents('c2')).resolves.toEqual([]);
  });
});
