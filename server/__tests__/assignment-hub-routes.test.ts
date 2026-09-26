import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import { registerAssignmentHubRoutes, gcSoftDeletedAssignmentFiles } from '../routes/assignment-hub.js';
import {
  ALLOWED_ASSIGNMENT_EXT,
  STUDENT_ASSIGNMENT_QUOTA_BYTES,
  parseAllowedExt,
} from '../../server/utils/assignment-upload-policy.js';
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
/** 模块级共享：供文件末尾「修复回归」describe 使用（同一 server 实例与 helper） */
let app: express.Express;
let server: Server;
let baseUrl: string;

  const studentId = 'stu-hub-0001';
const otherStudentId = 'stu-hub-0002';
const teacherId = 'usr-hub-teacher-0001';
const studentToken = 'tok-hub-student-0001';
const otherToken = 'tok-hub-other-0001';
const teacherToken = 'tok-hub-teacher-0001';
const thirdStudentId = 'stu-hub-0003';
const thirdToken = 'tok-hub-third-0001';
const assignmentId = 'asg-hub-0001';
const otherAssignmentId = 'asg-hub-0002';
const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
const createdFiles: string[] = [];
const createdAssignmentIds: string[] = [];
const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('assignment hub test\n')]);
const submitWork = (token: string, body: Record<string, unknown>, target = assignmentId) =>
    fetch(`${baseUrl}/api/assignments/${target}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(token) },
      body: JSON.stringify(body),
    });


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


describe('assignment-hub 路由（上传 / 下载 / 提交）', () => {



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
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(thirdStudentId, 'hub_third', 'placeholder', 'student', 'Hub 第三学生', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(studentToken, JSON.stringify({ userId: studentId, role: 'student', username: 'hub_student' }), now, expiresAt);
    insertSession.run(otherToken, JSON.stringify({ userId: otherStudentId, role: 'student', username: 'hub_other' }), now, expiresAt);
    insertSession.run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher', username: 'hub_teacher' }), now, expiresAt);
    insertSession.run(thirdToken, JSON.stringify({ userId: thirdStudentId, role: 'student', username: 'hub_third' }), now, expiresAt);

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
    const db = kernelContainer.db;
    db.prepare('DELETE FROM plugin_assignment_files WHERE assignment_id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM plugin_submission_versions WHERE assignment_id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM plugin_submissions WHERE assignment_id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM plugin_assignments WHERE id IN (?, ?)').run(assignmentId, otherAssignmentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(studentToken, otherToken, teacherToken, thirdToken);
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

  it('P2 学生互评端点：只有被分配到的互评人能评价，评语不能冒充他人', async () => {
    const db = kernelContainer.db;
    resetAssignmentState();
    db.prepare('DELETE FROM plugin_peer_review_tasks WHERE assignment_id = ?').run(assignmentId);
    db.prepare('DELETE FROM plugin_peer_reviews WHERE assignment_id = ?').run(assignmentId);

    await submitWork(studentToken, { textContent: '学生一的作业' });
    await submitWork(otherToken, { textContent: '学生二的作业' });
    await submitWork(thirdToken, { textContent: '学生三的作业' });
    const subs = db
      .prepare('SELECT id, student_id FROM plugin_submissions WHERE assignment_id = ?')
      .all(assignmentId) as { id: string; student_id: string }[];
    expect(subs).toHaveLength(3);

    const assignRes = await fetch(`${baseUrl}/api/assignments/${assignmentId}/assign-peer-reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ reviewerCount: 1 }),
    });
    const assigned: any = await assignRes.json();
    expect(assignRes.status, JSON.stringify(assigned)).toBe(200);
    expect(assigned.created).toBe(3);

    const mine = subs.find((item) => item.student_id === studentId)!;
    const task = db
      .prepare('SELECT reviewer_id FROM plugin_peer_review_tasks WHERE submission_id = ?')
      .get(mine.id) as { reviewer_id: string };
    expect(task.reviewer_id).not.toBe(studentId);
    const tokenOf = (id: string) =>
      id === studentId ? studentToken : id === otherStudentId ? otherToken : thirdToken;
    const reviewerToken = tokenOf(task.reviewer_id);
    const outsiderId = [studentId, otherStudentId, thirdStudentId].find(
      (id) => id !== studentId && id !== task.reviewer_id,
    )!;

    const reviewWith = (token: string, body: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/assignments/${assignmentId}/peer-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(token) },
        body: JSON.stringify(body),
      });

    // 1) 未被分配到的学生不能评（已建立互评任务后只认任务持有人）
    const notAssigned = await reviewWith(tokenOf(outsiderId), {
      submissionId: mine.id,
      reviewerId: task.reviewer_id,
      score: 100,
    });
    const notAssignedBody: any = await notAssigned.json();
    expect(notAssignedBody.success).toBe(false);
    expect(String(notAssignedBody.error)).toContain('not assigned to you for peer review');

    // 2) 作者本人不能通过请求体冒充互评人给自己打分（reviewerId 由会话决定）
    const spoofed = await reviewWith(studentToken, {
      submissionId: mine.id,
      reviewerId: task.reviewer_id,
      score: 100,
    });
    const spoofedBody: any = await spoofed.json();
    expect(spoofedBody.success).toBe(false);
    expect(String(spoofedBody.error)).toContain('not allowed to evaluate their own assignments');

    // 3) 被分配到的互评人可以提交，且再次提交只更新同一条记录
    const ok = await reviewWith(reviewerToken, {
      submissionId: mine.id,
      reviewerId: task.reviewer_id,
      score: 88,
      comment: '第一次意见',
    });
    expect(ok.status, await ok.text()).toBe(200);

    const again = await reviewWith(reviewerToken, {
      submissionId: mine.id,
      score: 75,
      comment: '改后的意见',
    });
    expect(again.status, await again.text()).toBe(200);

    const reviews = db
      .prepare('SELECT reviewer_id, score, comment FROM plugin_peer_reviews WHERE submission_id = ?')
      .all(mine.id) as any[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reviewer_id).toBe(task.reviewer_id);
    expect(reviews[0].score).toBe(75);
    expect(reviews[0].comment).toBe('改后的意见');

    const taskRow = db
      .prepare('SELECT status FROM plugin_peer_review_tasks WHERE submission_id = ? AND reviewer_id = ?')
      .get(mine.id, task.reviewer_id) as any;
    expect(taskRow.status).toBe('submitted');
  });

  it('P2 附件下载：互评人可读被分配到的提交附件，未分配者仍然 403', async () => {
    const db = kernelContainer.db;
    resetAssignmentState();
    db.prepare('DELETE FROM plugin_peer_review_tasks WHERE assignment_id = ?').run(assignmentId);
    db.prepare('DELETE FROM plugin_peer_reviews WHERE assignment_id = ?').run(assignmentId);

    const file = await uploadTracked('review-me.pdf', studentToken);
    const submitted = await submitWork(studentToken, { fileIds: [file.id] });
    expect(submitted.status, await submitted.text()).toBe(200);
    await submitWork(otherToken, { textContent: '作品二' });
    await submitWork(thirdToken, { textContent: '作品三' });

    const assignRes = await fetch(`${baseUrl}/api/assignments/${assignmentId}/assign-peer-reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ reviewerCount: 1 }),
    });
    expect(assignRes.status).toBe(200);

    const fileUrl = `${baseUrl}/api/assignments/${assignmentId}/files/${file.id}`;
    const task = db
      .prepare(
        `SELECT t.reviewer_id FROM plugin_peer_review_tasks t
         JOIN plugin_submission_versions v ON v.submission_id = t.submission_id
         JOIN plugin_assignment_files f ON f.version_id = v.id
         WHERE f.id = ?`,
      )
      .get(file.id) as { reviewer_id: string };
    const tokenOf = (id: string) =>
      id === studentId ? studentToken : id === otherStudentId ? otherToken : thirdToken;
    const reviewerToken = tokenOf(task.reviewer_id);
    const outsiderId = [studentId, otherStudentId, thirdStudentId].find(
      (id) => id !== studentId && id !== task.reviewer_id,
    )!;

    // 互评人可下载（用于评价别人的作品）
    const asReviewer = await fetch(fileUrl, { headers: cookie(reviewerToken) });
    expect(asReviewer.status, await asReviewer.text()).toBe(200);
    // 作者本人与教师照旧可下载
    expect((await fetch(fileUrl, { headers: cookie(studentToken) })).status).toBe(200);
    expect((await fetch(fileUrl, { headers: cookie(teacherToken) })).status).toBe(200);
    // 未分配到的学生依然被拒绝
    const asOutsider = await fetch(fileUrl, { headers: cookie(tokenOf(outsiderId)) });
    expect(asOutsider.status).toBe(403);
  });

  it('P2 教师详情带互评进度，学生拿不到（含姓名）', async () => {
    const db = kernelContainer.db;
    resetAssignmentState();
    db.prepare('DELETE FROM plugin_peer_review_tasks WHERE assignment_id = ?').run(assignmentId);
    db.prepare('DELETE FROM plugin_peer_reviews WHERE assignment_id = ?').run(assignmentId);

    await submitWork(studentToken, { textContent: '待互评的作品' });
    await submitWork(otherToken, { textContent: '另一份作品' });
    await fetch(`${baseUrl}/api/assignments/${assignmentId}/assign-peer-reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ reviewerCount: 1, dueAt: Date.now() + 86_400_000 }),
    });

    const teacherView: any = await (await fetch(`${baseUrl}/api/assignments/${assignmentId}`, {
      headers: cookie(teacherToken),
    })).json();
    expect(teacherView.success).toBe(true);
    expect(teacherView.peerProgress.tasks).toBe(2);
    expect(teacherView.peerProgress.completed).toBe(0);
    expect(teacherView.peerProgress.pending).toBe(2);
    expect(teacherView.peerProgress.reviewers.map((item: any) => item.studentId).sort()).toEqual(
      [studentId, otherStudentId].sort(),
    );

    const studentView: any = await (await fetch(`${baseUrl}/api/assignments/${assignmentId}`, {
      headers: cookie(studentToken),
    })).json();
    expect(studentView.peerProgress).toBeUndefined();
    // 互评人的身份不出现在学生可见的互评任务里
    expect(JSON.stringify(studentView.peerReviewTasks || [])).not.toContain(otherStudentId);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 修复回归：班级归属（H1）/ 状态与截止（H2）/ 软删除文件物理 GC（M4）
// 共享上方 describe 的 server 实例与 helper（app/server/baseUrl 已提升到模块级）。
// ══════════════════════════════════════════════════════════════════════════
describe('修复回归：H1 班级归属 / H2 状态截止 / M4 文件 GC', () => {
  const guardClassId = 'cls-hub-guard-001';
  const memberStudentId = 'stu-hub-member-0001';
  const outsiderStudentId = 'stu-hub-outsider-01';
  const memberToken = 'tok-hub-member-0001';
  const outsiderToken = 'tok-hub-outsider-001';
  const guardTeacherId = 'usr-hub-guard-teacher';
  const guardTeacherToken = 'tok-hub-guard-teacher';
  const classBoundAssignmentId = 'asg-hub-guard-001';
  const draftAssignmentId = 'asg-hub-draft-001';
  const closedDueAssignmentId = 'asg-hub-due-0001';
  const lateAllowedAssignmentId = 'asg-hub-late-001';
  const legacyAssignmentId = 'asg-hub-legacy-001';

  beforeAll(async () => {
    const db = kernelContainer.db;
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(memberToken, JSON.stringify({ userId: memberStudentId, role: 'student', username: 'hub_member' }), now, expiresAt);
    insertSession.run(outsiderToken, JSON.stringify({ userId: outsiderStudentId, role: 'student', username: 'hub_outsider' }), now, expiresAt);
    // 独立教师会话：首个 describe 的 afterAll 会清理共享 teacherToken
    insertSession.run(guardTeacherToken, JSON.stringify({ userId: guardTeacherId, role: 'teacher', username: 'hub_guard_teacher' }), now, expiresAt);
    // 班级与选课关系：member 在班内，outsider 不在
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(guardClassId, '归属校验班', 'H1 测试班级', 'pass-guard', now);
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      guardClassId,
      memberStudentId,
      now,
    );
    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(memberStudentId, 'hub-member-01', '班内学生', 'member@test', now);
    insertStudent.run(outsiderStudentId, 'hub-out-01', '外班学生', 'out@test', now);

    const insertGuardAssignment = db.prepare(
      `INSERT OR REPLACE INTO plugin_assignments
         (id, class_id, lesson_id, element_id, title, description, instructions, due_at, allow_late, allow_text, allow_link,
          max_files, max_file_size, allowed_ext, peer_review_mode, peer_review_count, peer_review_due_at,
          teacher_weight, peer_weight, status, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, 1, 0, 3, 5242880, '', 'assigned', 1, NULL, 0.6, 0.4, ?, ?, ?, ?)`,
    );
    // 班级作业：未截止
    insertGuardAssignment.run(classBoundAssignmentId, guardClassId, 'H1 班级作业', null, 1, 'published', guardTeacherId, now, now);
    // 草稿作业
    insertGuardAssignment.run(draftAssignmentId, guardClassId, '草稿作业', null, 1, 'draft', guardTeacherId, now, now);
    // 已截止且不允许迟交
    insertGuardAssignment.run(closedDueAssignmentId, guardClassId, '已截止作业', now - 3_600_000, 0, 'published', guardTeacherId, now, now);
    // 已截止但允许迟交
    insertGuardAssignment.run(lateAllowedAssignmentId, guardClassId, '允许迟交作业', now - 3_600_000, 1, 'published', guardTeacherId, now, now);
    // 课时作业（class_id NULL）— 验证无班级归属约束的旧行为不变
    insertGuardAssignment.run('asg-hub-legacy-001', null, '课时作业-无归属', null, 1, 'published', guardTeacherId, now, now);
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    const ids = [classBoundAssignmentId, draftAssignmentId, closedDueAssignmentId, lateAllowedAssignmentId, legacyAssignmentId];
    db.prepare(`DELETE FROM plugin_assignment_files WHERE assignment_id IN (${ids.map(() => '?').join(', ')})`).run(...ids);
    db.prepare(`DELETE FROM plugin_submission_versions WHERE assignment_id IN (${ids.map(() => '?').join(', ')})`).run(...ids);
    db.prepare(`DELETE FROM plugin_submissions WHERE assignment_id IN (${ids.map(() => '?').join(', ')})`).run(...ids);
    db.prepare(`DELETE FROM plugin_assignments WHERE id IN (${ids.map(() => '?').join(', ')})`).run(...ids);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(guardClassId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(guardClassId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(memberStudentId, outsiderStudentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(memberToken, outsiderToken, guardTeacherToken);
    for (const id of ids) {
      fs.rmSync(path.join(process.cwd(), 'storage', 'assignments', id), { recursive: true, force: true });
    }
  });

  // ── H1 班级归属 ─────────────────────────────────────────────────────────
  it('H1: 外班学生读班级作业详情 → 403；班内学生 → 200', async () => {
    const url = `${baseUrl}/api/assignments/${classBoundAssignmentId}`;
    const asOutsider = await fetch(url, { headers: cookie(outsiderToken) });
    expect(asOutsider.status).toBe(403);
    const asMember = await fetch(url, { headers: cookie(memberToken) });
    expect(asMember.status).toBe(200);
  });

  it('H1: 外班学生上传/提交班级作业 → 403（成绩册不被外班污染）', async () => {
    const upRes = await upload(pdfBytes, 'intruder.pdf', outsiderToken, classBoundAssignmentId);
    expect(upRes.status).toBe(403);

    const subRes = await submitWork(outsiderToken, { textContent: '外班入侵提交' }, classBoundAssignmentId);
    expect(subRes.status).toBe(403);
    expect(
      (kernelContainer.db
        .prepare('SELECT COUNT(*) AS c FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?')
        .get(classBoundAssignmentId, outsiderStudentId) as { c: number }).c,
    ).toBe(0);
  });

  it('H1: 教师不受班级归属限制；课时作业（class_id NULL）行为不变', async () => {
    const asTeacher = await fetch(`${baseUrl}/api/assignments/${classBoundAssignmentId}`, {
      headers: cookie(guardTeacherToken),
    });
    expect(asTeacher.status).toBe(200);
    // 课时作业（class_id = NULL）仍对所有登录学生可读（无归属约束，行为不变）
    const legacyOk = await fetch(`${baseUrl}/api/assignments/${legacyAssignmentId}`, { headers: cookie(memberToken) });
    expect(legacyOk.status).toBe(200);
  });

  // ── H2 状态与截止 ───────────────────────────────────────────────────────
  it('H2: 草稿作业禁止上传 → 409', async () => {
    const res = await upload(pdfBytes, 'draft.pdf', memberToken, draftAssignmentId);
    expect(res.status).toBe(409);
  });

  it('H2: 已截止且不允许迟交 → 上传 409；允许迟交 → 上传 200', async () => {
    const blocked = await upload(pdfBytes, 'late-blocked.pdf', memberToken, closedDueAssignmentId);
    expect(blocked.status).toBe(409);

    const allowed = await upload(pdfBytes, 'late-ok.pdf', memberToken, lateAllowedAssignmentId);
    expect(allowed.status).toBe(200);
  });

  // ── M4 软删除文件物理 GC ────────────────────────────────────────────────
  it('M4: gcSoftDeletedAssignmentFiles 物理删除超期软删文件，保留期内不动', async () => {
    const uploaded: any = await (await upload(pdfBytes, 'gc-target.pdf', memberToken, classBoundAssignmentId)).json();
    const row = kernelContainer.db
      .prepare('SELECT stored_path FROM plugin_assignment_files WHERE id = ?')
      .get(uploaded.file.id) as { stored_path: string };
    const absPath = path.resolve(process.cwd(), row.stored_path);
    expect(fs.existsSync(absPath)).toBe(true);

    // 刚软删除（保留期内）：不物理删除
    kernelContainer.db.prepare('UPDATE plugin_assignment_files SET deleted_at = ? WHERE id = ?').run(
      Date.now(),
      uploaded.file.id,
    );
    gcSoftDeletedAssignmentFiles(kernelContainer.db as any, 7 * 86_400_000);
    expect(fs.existsSync(absPath)).toBe(true);

    // 标记为 8 天前：物理删除
    kernelContainer.db.prepare('UPDATE plugin_assignment_files SET deleted_at = ? WHERE id = ?').run(
      Date.now() - 8 * 86_400_000,
      uploaded.file.id,
    );
    gcSoftDeletedAssignmentFiles(kernelContainer.db as any, 7 * 86_400_000);
    expect(fs.existsSync(absPath)).toBe(false);
  });

  it('M4: GC 拒绝 stored_path 逃逸 storage/assignments 根目录的行', () => {
    const canaryPath = path.resolve(process.cwd(), 'package.json');
    expect(fs.existsSync(canaryPath)).toBe(true);
    kernelContainer.db
      .prepare(
        `INSERT OR REPLACE INTO plugin_assignment_files
           (id, assignment_id, submission_id, version_id, student_id, original_name, stored_path, size, mime, sha256, uploaded_at, deleted_at)
         VALUES ('af-gc-escape-probe', 'asg-nonexistent', NULL, NULL, 'ghost', 'evil', '../../package.json', 1, NULL, NULL, ?, ?)`,
      )
      .run(Date.now(), Date.now() - 8 * 86_400_000);
    gcSoftDeletedAssignmentFiles(kernelContainer.db as any, 7 * 86_400_000);
    expect(fs.existsSync(canaryPath)).toBe(true);
    kernelContainer.db.prepare("DELETE FROM plugin_assignment_files WHERE id = 'af-gc-escape-probe'").run();
  });
  // ── L1 每作业扩展名限制（allowed_ext）───────────────────────────────────
  it('L1: 作业配置 allowed_ext=".docx" 时，pdf 被拒、docx 通过；未配置作业回落全局白名单', async () => {
    const db = kernelContainer.db;
    const extAssignmentId = 'asg-hub-ext-001';
    db.prepare(
      `INSERT OR REPLACE INTO plugin_assignments
         (id, class_id, lesson_id, element_id, title, description, instructions, due_at, allow_late, allow_text, allow_link,
          max_files, max_file_size, allowed_ext, peer_review_mode, peer_review_count, peer_review_due_at,
          teacher_weight, peer_weight, status, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, '仅 docx 作业', NULL, NULL, NULL, 1, 1, 0, 3, 5242880, '.docx', 'assigned', 1, NULL, 0.6, 0.4, 'published', ?, ?, ?)`,
    ).run(extAssignmentId, guardClassId, guardTeacherId, Date.now(), Date.now());

    // pdf 不在该作业白名单 → 400
    const pdfRes = await upload(pdfBytes, 'should-fail.pdf', memberToken, extAssignmentId);
    expect(pdfRes.status).toBe(400);

    // docx（ZIP 容器族 magic bytes）→ 200
    const docxBytes = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('fake docx')]);
    const docxRes = await upload(docxBytes, 'real.docx', memberToken, extAssignmentId);
    expect(docxRes.status, await docxRes.text()).toBe(200);

    db.prepare('DELETE FROM plugin_assignment_files WHERE assignment_id = ?').run(extAssignmentId);
    db.prepare('DELETE FROM plugin_assignments WHERE id = ?').run(extAssignmentId);
  });

  it('L1: parseAllowedExt 只能收紧全局白名单（越界项被过滤，全空回落 null）', () => {
    expect(parseAllowedExt('.pdf, .docx')!.has('.pdf')).toBe(true);
    expect(parseAllowedExt('.pdf, .docx')!.has('.exe')).toBe(false);
    // .exe 不在全局白名单 → 解析结果剔除；剩余为空 → null
    expect(parseAllowedExt('.exe, .msi')).toBeNull();
    expect(parseAllowedExt('')).toBeNull();
    expect(parseAllowedExt(null)).toBeNull();
  });

  // ── M3 学生存储配额 ─────────────────────────────────────────────────────
  it('M3: 学生累计用量达到配额 → 上传 413；教师代传不受配额限制', async () => {
    const db = kernelContainer.db;
    // 直接注入一条接近配额的历史用量（免传真实大文件）
    db.prepare(
      `INSERT OR REPLACE INTO plugin_assignment_files
         (id, assignment_id, submission_id, version_id, student_id, original_name, stored_path, size, mime, sha256, uploaded_at)
       VALUES ('af-quota-fill', '${classBoundAssignmentId}', NULL, NULL, ?, 'heavy.bin', 'storage/assignments/fake.bin', ?, NULL, NULL, ?)`,
    ).run(memberStudentId, STUDENT_ASSIGNMENT_QUOTA_BYTES - 10, Date.now());

    // 班内学生：剩余配额不足 1MB，上传 5KB 文件也能触发（差值 < 文件大小？否——剩余 1000 字节 < 文件大小）
    const res = await upload(pdfBytes, 'over-quota.pdf', memberToken, classBoundAssignmentId);
    expect(res.status).toBe(413);

    // 清理注入行，教师代传同文件应成功
    db.prepare("DELETE FROM plugin_assignment_files WHERE id = 'af-quota-fill'").run();
    const teacherProxy = await upload(pdfBytes, 'proxy.pdf', guardTeacherToken, classBoundAssignmentId, memberStudentId);
    expect(teacherProxy.status, await teacherProxy.text()).toBe(200);
    const stored = db
      .prepare("SELECT stored_path FROM plugin_assignment_files WHERE original_name = 'proxy.pdf' AND student_id = ?")
      .get(memberStudentId) as { stored_path: string };
    createdFiles.push(path.resolve(process.cwd(), stored.stored_path));
  });

  // ── L2 前后端白名单同步守护 ─────────────────────────────────────────────
  it('L2: 前端 AssignmentSubmitDialog 的 ACCEPT_EXT 与服务端白名单一致', () => {
    const dialogSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/whiteboard/components/AssignmentSubmitDialog.tsx'),
      'utf8',
    );
    const m = dialogSource.match(/const ACCEPT_EXT[\s\S]*?;/);
    expect(m, 'ACCEPT_EXT not found in dialog source').toBeTruthy();
    const clientExts = new Set(
      (m![0].match(/\.[a-z0-9]+/g) ?? []).map((e) => e.toLowerCase()),
    );
    expect(clientExts).toEqual(ALLOWED_ASSIGNMENT_EXT);
  });
});


// 共享 server 生命周期：所有 describe 结束后统一关闭
// （首个 describe 的 afterAll 只做数据清理；close 放文件级，避免后续 describe 拿到已关闭的 server）
afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});