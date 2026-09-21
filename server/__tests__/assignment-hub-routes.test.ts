import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import { registerAssignmentHubRoutes } from '../routes/assignment-hub.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 作业中心（Assignment Hub）路由回归测试。
 *
 * 覆盖：
 *  1. 文件上传（原始二进制体）的鉴权、白名单、magic bytes 与所属权；
 *  2. 文件下载 / 删除的 IDOR 防护（学生读他人 403、已归档版本不可删 409）；
 *  3. `POST /api/assignments/:assignmentId/submit` 走真实 Cookie 会话 + 命令总线，
 *     验证学生**不再**因缺少 `lesson:write` 而被 CapabilityGuard 拒绝（P0 阻塞缺陷），
 *     且请求体里的 studentId 无法冒充他人。
 */
describe('assignment-hub 路由（上传 / 下载 / 提交）', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const studentId = 'stu-hub-0001';
  const otherStudentId = 'stu-hub-0002';
  const teacherId = 'usr-hub-teacher-0001';
  const studentToken = 'tok-hub-student-0001';
  const otherToken = 'tok-hub-other-0001';
  const teacherToken = 'tok-hub-teacher-0001';
  const assignmentId = 'asg-hub-0001';
  const otherAssignmentId = 'asg-hub-0002';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const createdFiles: string[] = [];
  const createdAssignmentIds: string[] = [];

  /** 清掉某作业下的提交 / 版本 / 附件，让用例彼此独立（DB 在同文件内共享） */
  const resetAssignmentState = (target = assignmentId) => {
    const db = kernelContainer.db;
    db.prepare('DELETE FROM plugin_assignment_files WHERE assignment_id = ?').run(target);
    db.prepare('DELETE FROM plugin_submission_versions WHERE assignment_id = ?').run(target);
    db.prepare('DELETE FROM plugin_submissions WHERE assignment_id = ?').run(target);
  };

  /** 上传一个附件并登记落盘路径（便于 afterAll 清理） */
  const uploadTracked = async (fileName: string, token = studentToken, target = assignmentId) => {
    const uploaded: any = await (await upload(pdfBytes, fileName, token, target)).json();
    const stored = kernelContainer.db
      .prepare('SELECT stored_path FROM plugin_assignment_files WHERE id = ?')
      .get(uploaded.file.id) as { stored_path: string } | undefined;
    if (stored) createdFiles.push(path.resolve(process.cwd(), stored.stored_path));
    return uploaded.file as { id: string; name: string };
  };

  const submitWork = (token: string, body: Record<string, unknown>, target = assignmentId) =>
    fetch(`${baseUrl}/api/assignments/${target}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(token) },
      body: JSON.stringify(body),
    });

  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('assignment hub test\n')]);

  const upload = (body: Buffer, fileName: string, token: string, target = assignmentId, studentHeader?: string) =>
    fetch(`${baseUrl}/api/assignments/${target}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(fileName),
        ...(studentHeader ? { 'X-Student-Id': studentHeader } : {}),
        ...(token ? cookie(token) : {}),
      },
      body: new Uint8Array(body),
    });

  beforeAll(async () => {
    const now = Date.now();
    const db = kernelContainer.db;

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, 'hub_student', 'placeholder', 'student', 'Hub 学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'hub_teacher', 'placeholder', 'teacher', 'Hub 教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(otherStudentId, 'hub_other', 'placeholder', 'student', 'Hub 另一学生', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(studentToken, JSON.stringify({ userId: studentId, role: 'student', username: 'hub_student' }), now, expiresAt);
    insertSession.run(otherToken, JSON.stringify({ userId: otherStudentId, role: 'student', username: 'hub_other' }), now, expiresAt);
    insertSession.run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher', username: 'hub_teacher' }), now, expiresAt);

    const insertAssignment = db.prepare(
      `INSERT OR REPLACE INTO plugin_assignments
         (id, class_id, lesson_id, element_id, title, description, instructions, due_at, allow_late, allow_text, allow_link,
          max_files, max_file_size, allowed_ext, peer_review_mode, peer_review_count, peer_review_due_at,
          teacher_weight, peer_weight, status, created_by, created_at, updated_at)
       VALUES (?, NULL, ?, NULL, ?, NULL, NULL, NULL, 1, 1, 0, 3, 5242880, '', 'assigned', 1, NULL, 0.6, 0.4, 'published', ?, ?, ?)`,
    );
    insertAssignment.run(assignmentId, 'lesson-hub-0001', 'Hub 测试作业', teacherId, now, now);
    insertAssignment.run(otherAssignmentId, 'lesson-hub-0002', 'Hub 另一作业', teacherId, now, now);

    app = express();
    app.use(express.json());
    const ctx: any = { app, io: { emit: () => undefined } };
    registerAssignmentHubRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = kernelContainer.db;
    db.prepare('DELETE FROM plugin_assignment_files WHERE assignment_id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM plugin_submission_versions WHERE assignment_id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM plugin_submissions WHERE assignment_id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM plugin_assignments WHERE id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(studentToken, otherToken, teacherToken);
    for (const file of createdFiles) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        /* best effort */
      }
    }
    const dir = path.join(process.cwd(), 'storage', 'assignments', assignmentId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), 'storage', 'assignments', otherAssignmentId), { recursive: true, force: true });
    for (const id of createdAssignmentIds) {
      db.prepare('DELETE FROM plugin_assignment_files WHERE assignment_id = ?').run(id);
      db.prepare('DELETE FROM plugin_submission_versions WHERE assignment_id = ?').run(id);
      db.prepare('DELETE FROM plugin_submissions WHERE assignment_id = ?').run(id);
      db.prepare('DELETE FROM plugin_assignments WHERE id = ?').run(id);
      fs.rmSync(path.join(process.cwd(), 'storage', 'assignments', id), { recursive: true, force: true });
    }
  });

  it('未登录上传 → 401', async () => {
    const res = await upload(pdfBytes, 'homework.pdf', '');
    expect(res.status).toBe(401);
  });

  it('学生上传 PDF → 200 并落盘 + 写元数据（归属本人）', async () => {
    const res = await upload(pdfBytes, '我的作业.pdf', studentToken);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.file.name).toBe('我的作业.pdf');
    expect(body.file.studentId).toBe(studentId);

    const row = kernelContainer.db
      .prepare('SELECT student_id, original_name, stored_path, size, sha256 FROM plugin_assignment_files WHERE id = ?')
      .get(body.file.id) as any;
    expect(row.student_id).toBe(studentId);
    expect(row.original_name).toBe('我的作业.pdf');
    expect(row.size).toBe(pdfBytes.length);
    expect(row.sha256).toHaveLength(64);

    const absPath = path.resolve(process.cwd(), row.stored_path);
    createdFiles.push(absPath);
    expect(fs.existsSync(absPath)).toBe(true);
    expect(fs.readFileSync(absPath).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('非白名单扩展名 / 内容与扩展名不符 → 400', async () => {
    const badExt = await upload(Buffer.from('MZ...'), 'virus.exe', studentToken);
    expect(badExt.status).toBe(400);

    const fakePdf = await upload(Buffer.from('not a pdf at all'), 'fake.pdf', studentToken);
    expect(fakePdf.status).toBe(400);

    const fakeZip = await upload(Buffer.from('not a zip'), 'archive.zip', studentToken);
    expect(fakeZip.status).toBe(400);
  });

  it('未登录下载 → 401；学生读本人 200；学生读他人 403；教师读任意 200', async () => {
    const uploaded: any = await (await upload(pdfBytes, 'own.pdf', studentToken)).json();
    const fileUrl = `${baseUrl}/api/assignments/${assignmentId}/files/${uploaded.file.id}`;

    // 记录落盘路径以便清理
    const stored = kernelContainer.db
      .prepare('SELECT stored_path FROM plugin_assignment_files WHERE id = ?')
      .get(uploaded.file.id) as { stored_path: string };
    createdFiles.push(path.resolve(process.cwd(), stored.stored_path));

    expect((await fetch(fileUrl)).status).toBe(401);

    const asStudent = await fetch(fileUrl, { headers: cookie(studentToken) });
    expect(asStudent.status, await asStudent.text()).toBe(200);
    expect(asStudent.headers.get('content-disposition') || '').toContain('attachment');

    const asOther = await fetch(fileUrl, { headers: cookie(otherToken) });
    expect(asOther.status).toBe(403);

    const asTeacher = await fetch(fileUrl, { headers: cookie(teacherToken) });
    expect(asTeacher.status, await asTeacher.text()).toBe(200);
  });

  it('未挂版本的本人文件可删（200），已挂到提交版本的文件不可删（409）', async () => {
    const uploaded: any = await (await upload(pdfBytes, 'deletable.pdf', studentToken)).json();
    const stored = kernelContainer.db
      .prepare('SELECT stored_path FROM plugin_assignment_files WHERE id = ?')
      .get(uploaded.file.id) as { stored_path: string };
    createdFiles.push(path.resolve(process.cwd(), stored.stored_path));
    const fileUrl = `${baseUrl}/api/assignments/${assignmentId}/files/${uploaded.file.id}`;

    // 他人不能删
    const asOther = await fetch(fileUrl, { method: 'DELETE', headers: cookie(otherToken) });
    expect(asOther.status).toBe(403);

    // 本人可以删（软删除）
    const asOwner = await fetch(fileUrl, { method: 'DELETE', headers: cookie(studentToken) });
    expect(asOwner.status).toBe(200);

    // 提交时引用的文件已归档，不能再删
    const attached: any = await (await upload(pdfBytes, 'attached.pdf', studentToken)).json();
    const attachedStored = kernelContainer.db
      .prepare('SELECT stored_path FROM plugin_assignment_files WHERE id = ?')
      .get(attached.file.id) as { stored_path: string };
    createdFiles.push(path.resolve(process.cwd(), attachedStored.stored_path));

    kernelContainer.db
      .prepare("UPDATE plugin_assignment_files SET version_id = 'sv-manual' WHERE id = ?")
      .run(attached.file.id);
    const deleteAttached = await fetch(`${baseUrl}/api/assignments/${assignmentId}/files/${attached.file.id}`, {
      method: 'DELETE',
      headers: cookie(studentToken),
    });
    expect(deleteAttached.status).toBe(409);
  });

  it('学生提交作业：走真实会话 + 命令总线，不需额外能力授权；请求体无法冒充他人', async () => {
    const submitted = await fetch(`${baseUrl}/api/assignments/${assignmentId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(studentToken) },
      // 故意传别人的 studentId，路由必须忽略并强制为本人
      body: JSON.stringify({ studentId: otherStudentId, textContent: '这是我的作业' }),
    });
    const body: any = await submitted.json();
    expect(submitted.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);

    const rows = kernelContainer.db
      .prepare('SELECT student_id, version FROM plugin_submissions WHERE assignment_id = ? ORDER BY student_id')
      .all(assignmentId) as { student_id: string; version: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].student_id).toBe(studentId);

    const version = kernelContainer.db
      .prepare('SELECT text_content, version FROM plugin_submission_versions WHERE assignment_id = ?')
      .get(assignmentId) as { text_content: string; version: number };
    expect(version.text_content).toBe('这是我的作业');
    expect(version.version).toBe(1);
  });

  it('学生端读路径：弹窗能拿到作业 / 待提交附件 / 版本历史，重交后版本递增且附件归档', async () => {
    resetAssignmentState();
    const file = await uploadTracked('读路径附件.pdf');

    // ① 上传后尚未提交：附件处于「待提交」状态（无 version_id）
    const pending = await fetch(`${baseUrl}/api/assignments/${assignmentId}/files`, { headers: cookie(studentToken) });
    const pendingBody: any = await pending.json();
    expect(pending.status, JSON.stringify(pendingBody)).toBe(200);
    const pendingRow = pendingBody.files.find((f: any) => f.id === file.id);
    expect(pendingRow).toBeTruthy();
    expect(pendingRow.version_id ?? null).toBeNull();

    // ② 链接作答被作业配置禁止（种子作业 allow_link = 0）：必须报错且不消耗版本号
    const rejected: any = await (await submitWork(studentToken, { linkUrl: 'https://example.com/nope' })).json();
    expect(rejected.success).toBe(false);
    expect(String(rejected.error)).toContain('Link answers are not allowed');

    // ③ 提交（附件 + 文本）
    const submitted = await submitWork(studentToken, { fileIds: [file.id], textContent: '第一版文本作答' });
    const submitBody: any = await submitted.json();
    expect(submitted.status, JSON.stringify(submitBody)).toBe(200);
    expect(submitBody.version).toBe(1);
    expect(submitBody.versionId).toBeTruthy();

    // ④ 归档后该附件不再出现在待提交列表
    const after: any = await (await fetch(`${baseUrl}/api/assignments/${assignmentId}/files`, {
      headers: cookie(studentToken),
    })).json();
    const archivedRow = after.files.find((f: any) => f.id === file.id);
    expect(archivedRow.version_id).toBe(submitBody.versionId);

    // ⑤ 弹窗详情：assignment + submission + versions + grade
    const detail: any = await (await fetch(`${baseUrl}/api/assignments/${assignmentId}`, {
      headers: cookie(studentToken),
    })).json();
    expect(detail.success).toBe(true);
    expect(detail.assignment.id).toBe(assignmentId);
    expect(detail.submission.student_id).toBe(studentId);
    expect(detail.submission.version).toBe(1);
    expect(detail.versions[0].version).toBe(1);
    expect(detail.versions[0].text_content).toBe('第一版文本作答');
    expect(detail.grade).toBeNull();
    expect(detail.stats.submissionCount).toBeGreaterThanOrEqual(1);

    // ⑥ 重交：版本递增，历史版本保留
    const resubmit: any = await (await submitWork(studentToken, { textContent: '第二版' })).json();
    expect(resubmit.version).toBe(2);
    const versions = kernelContainer.db
      .prepare('SELECT version FROM plugin_submission_versions WHERE assignment_id = ? ORDER BY version')
      .all(assignmentId) as { version: number }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('列表读路径：学生只看得到自己的提交概要，教师可按 studentId 查询', async () => {
    resetAssignmentState();
    await submitWork(studentToken, { textContent: '列表用例' });

    // 学生：列表行附带自己的 submission / grade
    const asStudent: any = await (await fetch(`${baseUrl}/api/assignments?lessonId=lesson-hub-0001`, {
      headers: cookie(studentToken),
    })).json();
    const studentRow = (asStudent.assignments || []).find((a: any) => a.id === assignmentId);
    expect(studentRow).toBeTruthy();
    expect(studentRow.submission.version).toBe(1);
    expect(studentRow.grade).toBeNull();

    // 教师：不指定学生时不附带个人提交；指定后可以看到该学生的提交
    const asTeacher: any = await (await fetch(`${baseUrl}/api/assignments?lessonId=lesson-hub-0001`, {
      headers: cookie(teacherToken),
    })).json();
    const teacherRow = (asTeacher.assignments || []).find((a: any) => a.id === assignmentId);
    expect(teacherRow).toBeTruthy();
    expect(teacherRow.submission).toBeUndefined();

    const withStudent: any = await (await fetch(
      `${baseUrl}/api/assignments?lessonId=lesson-hub-0001&studentId=${studentId}`,
      { headers: cookie(teacherToken) },
    )).json();
    const scopedRow = (withStudent.assignments || []).find((a: any) => a.id === assignmentId);
    expect(scopedRow.submission.version).toBe(1);
  });

  it('教师新建作业：不挂班级也能创建（POST /api/assignments 返回 assignmentId 供白板绑定）', async () => {
    // 回归：`ActionRegistry.getActionByCommandType()` 取的是最先注册的描述符，
    // management.ts 的 `core-assignment-create` 要求 classId。若插件未接管该描述符，
    // 这里会得到 `[PayloadValidationError] ... Missing required property "classId"`。
    const created = await fetch(`${baseUrl}/api/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({
        title: '绑定控件新建的作业',
        description: '来自白板编辑面板',
        lessonId: 'lesson-hub-0003',
        elementId: 'el-hub-0001',
        status: 'published',
      }),
    });
    const createdBody: any = await created.json();
    expect(created.status, JSON.stringify(createdBody)).toBe(200);
    expect(createdBody.success).toBe(true);
    const newId = String(createdBody.assignmentId || createdBody.assignment?.id || '');
    expect(newId).toBeTruthy();
    createdAssignmentIds.push(newId);

    const row = kernelContainer.db
      .prepare('SELECT lesson_id, element_id, title, status, created_by FROM plugin_assignments WHERE id = ?')
      .get(newId) as any;
    expect(row.lesson_id).toBe('lesson-hub-0003');
    expect(row.element_id).toBe('el-hub-0001');
    expect(row.status).toBe('published');
    expect(row.created_by).toBe(teacherId);

    // 学生能在同一课时的列表里看到这条刚发布的作业
    const asStudent: any = await (await fetch(`${baseUrl}/api/assignments?lessonId=lesson-hub-0003`, {
      headers: cookie(studentToken),
    })).json();
    expect((asStudent.assignments || []).map((a: any) => a.id)).toContain(newId);
  });

  it('CapabilityGuard：学生与教师均被授予 assignment:* 能力（P0 权限修正）', () => {
    const guard = kernelContainer.capabilityGuard;
    expect(guard.check(`user:${studentId}:student`, 'assignment:submit')).toBe(true);
    expect(guard.check(`user:${studentId}:student`, 'assignment:review')).toBe(true);
    expect(guard.check(`user:${studentId}:student`, 'assignment:read')).toBe(true);
    // 学生仍然不能改课时内容
    expect(guard.check(`user:${studentId}:student`, 'lesson:write')).toBe(false);
    expect(guard.check(`user:${teacherId}:teacher`, 'assignment:manage')).toBe(true);
    expect(guard.check(`user:${teacherId}:teacher`, 'assignment:submit')).toBe(true);
  });
});
