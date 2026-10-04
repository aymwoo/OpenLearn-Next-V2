import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerAdminRoutes } from '../routes/admin.js';
import { registerRosterRoutes } from '../routes/roster.js';
import { runStartupMigrations } from '../bootstrap-db.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 客户端 CSV 容错解析核心逻辑（镜像 src/services/bulkImportService.ts 中的解析机制）
 * 用于在无浏览器 DOM 环境下对恶魔数据集进行真实端到端清洗与装配
 */
function parseClassCsvForJourney(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('CSV has empty or insufficient data');
  }

  // 剔除可能的 UTF-8 BOM (\uFEFF)
  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

  const classNameIdx = headers.findIndex(
    (h) =>
      h.includes('class name') ||
      h.includes('班級名稱') ||
      h.includes('班级名称') ||
      h.includes('班级') ||
      h.includes('classname') ||
      h.includes('class_name'),
  );
  const classDescIdx = headers.findIndex(
    (h) =>
      h.includes('class desc') ||
      h.includes('班級描述') ||
      h.includes('班级描述') ||
      h.includes('描述') ||
      h.includes('class_desc'),
  );
  const studentNameIdx = headers.findIndex(
    (h) =>
      h.includes('student name') ||
      h.includes('學生姓名') ||
      h.includes('学生姓名') ||
      h.includes('姓名') ||
      h.includes('学生') ||
      h.includes('studentname') ||
      h.includes('student_name'),
  );
  const studentEmailIdx = headers.findIndex(
    (h) =>
      h.includes('student email') ||
      h.includes('電子郵箱') ||
      h.includes('学生邮箱') ||
      h.includes('邮箱') ||
      h.includes('email') ||
      h.includes('studentemail') ||
      h.includes('student_email'),
  );

  if (studentNameIdx === -1) {
    throw new Error('CSV is missing column: "Student Name"');
  }

  const classesMap: Record<string, { name: string; description: string; students: { name: string; email: string }[] }> =
    {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 匹配双引号包裹或者非逗号字段
    const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || line.split(',');
    const cleanParts = parts.map((p) => p.replace(/^"|"$/g, '').trim());

    const className = classNameIdx !== -1 ? cleanParts[classNameIdx] : '';
    if (!className) continue;

    const classDesc = classDescIdx !== -1 ? cleanParts[classDescIdx] || '' : '';
    const studentName = cleanParts[studentNameIdx] || '';
    const studentEmail = studentEmailIdx !== -1 ? cleanParts[studentEmailIdx] || '' : '';

    if (!classesMap[className]) {
      classesMap[className] = {
        name: className,
        description: classDesc,
        students: [],
      };
    }

    if (studentName) {
      classesMap[className].students.push({
        name: studentName,
        email: studentEmail,
      });
    }
  }

  return Object.values(classesMap);
}

describe('业务黄金旅程场景测试：班级与学生全生命周期 (Roster Lifecycle Journey)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const adminId = 'usr-journey-admin';
  const teacherId = 'usr-journey-teacher';
  const studentId = 'usr-journey-student';

  const adminToken = 'tok-journey-admin';
  const teacherToken = 'tok-journey-teacher';
  const studentToken = 'tok-journey-student';

  const adminHeaders = { 'Content-Type': 'application/json', Cookie: `edu_os_token=${adminToken}` };
  const teacherHeaders = { 'Content-Type': 'application/json', Cookie: `edu_os_token=${teacherToken}` };
  const studentHeaders = { 'Content-Type': 'application/json', Cookie: `edu_os_token=${studentToken}` };

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;
    const db = kernelContainer.db;
    await runStartupMigrations(db);

    // 清理可能遗留的历史旅程数据
    try {
      db.prepare("DELETE FROM students WHERE id = ? OR student_number LIKE 'STU_JOURNEY_%' OR email LIKE '%_journey@test.com'").run(studentId);
      db.prepare("DELETE FROM classes WHERE name LIKE '旅程测试%' OR name LIKE '高一(1)班%'").run();
      db.prepare("DELETE FROM assignments WHERE id LIKE 'asg_journey_%'").run();
      db.prepare("DELETE FROM assignment_submissions WHERE assignment_id LIKE 'asg_journey_%'").run();
      db.prepare("DELETE FROM schedules WHERE id LIKE 'sched_journey_%'").run();
      db.prepare("DELETE FROM attendance WHERE schedule_id LIKE 'sched_journey_%' OR schedule_id = 'sched_fake'").run();
    } catch {}

    // 1. 初始化管理员、教师与学生主体
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(adminId, 'journey_admin', 'hash_admin', 'administrator', '旅程超级管理员', now);
    insertUser.run(teacherId, 'journey_teacher', 'hash_teacher', 'teacher', '旅程授课教师', now);

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, name, student_number, password, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(studentId, '旅程既有学生', 'STU_JOURNEY_PRE', 'hash_student', now);

    // 2. 初始化认证 Session
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'journey_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'journey_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'journey_student' }),
      now,
      expiresAt,
    );

    // 3. 构建 Express 应用并挂载 Admin 与 Roster 路由
    app = express();
    app.use(express.json());
    registerAdminRoutes({ app } as any);
    registerRosterRoutes({
      app,
      io: { emit: () => {}, to: () => ({ emit: () => {} }) },
      loginLimiter: ((_req: any, _res: any, next: any) => next()) as any,
    } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const db = kernelContainer.db;
    try {
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(adminToken, teacherToken, studentToken);
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminId, teacherId);
      db.prepare("DELETE FROM students WHERE id = ? OR student_number LIKE 'STU_JOURNEY_%' OR email LIKE '%_journey@test.com'").run(studentId);
      db.prepare("DELETE FROM classes WHERE name LIKE '旅程测试%' OR name LIKE '高一(1)班%'").run();
      db.prepare("DELETE FROM assignments WHERE id LIKE 'asg_journey_%'").run();
      db.prepare("DELETE FROM assignment_submissions WHERE assignment_id LIKE 'asg_journey_%'").run();
      db.prepare("DELETE FROM schedules WHERE id LIKE 'sched_journey_%'").run();
      db.prepare("DELETE FROM attendance WHERE schedule_id LIKE 'sched_journey_%' OR schedule_id = 'sched_fake'").run();
    } catch {}
  });

  // 跨阶段旅程上下文状态
  let primaryClassId = '';
  let studentAliceId = '';
  let studentZhang1Id = '';
  let studentZhang2Id = '';
  let studentXssId = '';

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 1: 恶魔数据（Naughty Dataset）解析与批量导入
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 1: 恶魔格式文件摄取与批量导入 (Import & Ingestion)', () => {
    it('D1 ~ D6: 客户端容错解析器应能正确处理 BOM、引号内逗号、繁简混排、重名与 XSS 探针', () => {
      // 构造极端恶劣的恶魔 CSV：
      // - 带 UTF-8 BOM (\uFEFF)
      // - 繁简体表头混合: 班級名稱, 班级描述, 學生姓名, 电子邮箱
      // - 字段内包含逗号且带双引号: "高一(1)班, 创新班"
      // - 姓名包含逗号: "张, 伟"
      // - 混合多个空行与前后空格
      // - XSS 注入探针: <script>alert('xss')</script>
      // - 重名但不同邮箱的同名学生: "张伟" 分别有不同的邮箱
      const naughtyCsv = `\uFEFF班級名稱, 班级描述, 學生姓名, 电子邮箱\r
\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "爱丽丝", alice_journey@test.com\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "张伟", zhangwei_1@test.com\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "张伟", zhangwei_2@test.com\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "<script>alert('xss')</script>", xss_probe@test.com\r
\r
"旅程测试-备选班", 备选描述, 鲍勃, bob_journey@test.com\r
\r
`;

      const parsedClasses = parseClassCsvForJourney(naughtyCsv);
      expect(parsedClasses.length).toBe(2);

      const mainClass = parsedClasses.find((c) => c.name.includes('高一(1)班'));
      expect(mainClass).toBeDefined();
      expect(mainClass!.name).toBe('高一(1)班, 创新班');
      expect(mainClass!.description).toBe('计算机前沿, 必修一');
      expect(mainClass!.students.length).toBe(4);

      // 验证重名与 XSS 探针均被完整解析保留
      const zhangweis = mainClass!.students.filter((s) => s.name === '张伟');
      expect(zhangweis.length).toBe(2);
      expect(zhangweis[0].email).toBe('zhangwei_1@test.com');
      expect(zhangweis[1].email).toBe('zhangwei_2@test.com');

      const xssStudent = mainClass!.students.find((s) => s.email === 'xss_probe@test.com');
      expect(xssStudent).toBeDefined();
      expect(xssStudent!.name).toBe("<script>alert('xss')</script>");
    });

    it('教师提交 POST /api/classes/import 端到端事务批量入库', async () => {
      const naughtyCsv = `\uFEFF班級名稱, 班级描述, 學生姓名, 电子邮箱\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "爱丽丝", alice_journey@test.com\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "张伟", zhangwei_1@test.com\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "张伟", zhangwei_2@test.com\r
"高一(1)班, 创新班", "计算机前沿, 必修一", "<script>alert('xss')</script>", xss_probe@test.com\r
"旅程测试-备选班", 备选班级描述, 鲍勃, bob_journey@test.com\r
`;
      const parsedClasses = parseClassCsvForJourney(naughtyCsv);

      const res = await fetch(`${baseUrl}/api/classes/import`, {
        method: 'POST',
        headers: teacherHeaders,
        body: JSON.stringify({ classes: parsedClasses }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.imported.length).toBe(2);

      const importedMain = json.imported.find((c: any) => c.name === '高一(1)班, 创新班');
      expect(importedMain).toBeDefined();
      expect(importedMain.studentsCount).toBe(4);
      primaryClassId = importedMain.id;

      // 查验数据库，确保四位学生均独立落库（包含重名张伟和 XSS 探针学生）
      const db = kernelContainer.db;
      const classRows = db.prepare('SELECT * FROM classes WHERE id = ?').all(primaryClassId);
      expect(classRows.length).toBe(1);

      const studentRows = db
        .prepare(
          `SELECT s.* FROM students s
           JOIN class_students cs ON s.id = cs.student_id
           WHERE cs.class_id = ?`,
        )
        .all(primaryClassId) as any[];

      expect(studentRows.length).toBe(4);

      const alice = studentRows.find((s) => s.email === 'alice_journey@test.com');
      const zhang1 = studentRows.find((s) => s.email === 'zhangwei_1@test.com');
      const zhang2 = studentRows.find((s) => s.email === 'zhangwei_2@test.com');
      const xss = studentRows.find((s) => s.email === 'xss_probe@test.com');

      expect(alice).toBeDefined();
      expect(zhang1).toBeDefined();
      expect(zhang2).toBeDefined();
      expect(xss).toBeDefined();
      // 验证重名的两位学生被分配了两个完全不同的主键 ID
      expect(zhang1.id).not.toBe(zhang2.id);

      studentAliceId = alice.id;
      studentZhang1Id = zhang1.id;
      studentZhang2Id = zhang2.id;
      studentXssId = xss.id;
    });

    it('单学生独立导入 POST /api/students/import 应能对同邮箱学生实现幂等识别 (new: false)', async () => {
      const res = await fetch(`${baseUrl}/api/students/import`, {
        method: 'POST',
        headers: teacherHeaders,
        body: JSON.stringify({
          students: [
            { name: '爱丽丝·重复导入', email: 'alice_journey@test.com' },
            { name: '独立新生', email: 'newbie_journey@test.com' },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      const existingAlice = json.imported.find((s: any) => s.email === 'alice_journey@test.com');
      expect(existingAlice).toBeDefined();
      expect(existingAlice.new).toBe(false);
      expect(existingAlice.id).toBe(studentAliceId);

      const newbie = json.imported.find((s: any) => s.email === 'newbie_journey@test.com');
      expect(newbie).toBeDefined();
      expect(newbie.new).toBe(true);
      expect(newbie.id).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 2: 班级教学配置、Passcode 口令校验与机房排座
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 2: 班级配置与机房排座 (Class Configuration & Lab Seating)', () => {
    const labId = 'lab-journey-cyber-01';

    it('教师修改班级信息与绑定机房 PUT /api/classes/:id', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${primaryClassId}`, {
        method: 'PUT',
        headers: teacherHeaders,
        body: JSON.stringify({
          description: '全栈计算机与物联网实验班',
          lab_id: labId,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 验证数据库班级绑定
      const cls = kernelContainer.db
        .prepare('SELECT description, lab_id FROM classes WHERE id = ?')
        .get(primaryClassId) as any;
      expect(cls.description).toBe('全栈计算机与物联网实验班');
      expect(cls.lab_id).toBe(labId);
    });

    it('获取班级动态通行口令 GET /api/classes/:id/passcode', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${primaryClassId}/passcode`, {
        headers: teacherHeaders,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.classId).toBe(primaryClassId);
      expect(json.classPasscode).toMatch(/^\d{6}$/);
      expect(json.isExpired).toBe(false);
      expect(json.remainingSeconds).toBeGreaterThan(0);
      expect(json.studentCount).toBe(4);
    });

    it('教师为班级学生排定机位 POST & GET /api/classes/:classId/seats', async () => {
      // 安排 4 个座位：
      // 爱丽丝: 1排1座
      // 张伟1: 1排2座
      // 张伟2: 2排1座
      // XSS探针学生: 2排2座
      const seatsPayload = {
        lab_id: labId,
        seats: [
          { student_id: studentAliceId, row_idx: 1, col_idx: 1 },
          { student_id: studentZhang1Id, row_idx: 1, col_idx: 2 },
          { student_id: studentZhang2Id, row_idx: 2, col_idx: 1 },
          { student_id: studentXssId, row_idx: 2, col_idx: 2 },
        ],
      };

      const saveRes = await fetch(`${baseUrl}/api/classes/${primaryClassId}/seats`, {
        method: 'POST',
        headers: teacherHeaders,
        body: JSON.stringify(seatsPayload),
      });

      expect(saveRes.status).toBe(200);
      const saveJson = await saveRes.json();
      expect(saveJson.success).toBe(true);

      // 验证查询排座
      const queryRes = await fetch(`${baseUrl}/api/classes/${primaryClassId}/seats`, {
        headers: teacherHeaders,
      });

      expect(queryRes.status).toBe(200);
      const queryJson = await queryRes.json();
      expect(queryJson.lab_id).toBe(labId);
      expect(queryJson.seats.length).toBe(4);

      const aliceSeat = queryJson.seats.find((s: any) => s.student_id === studentAliceId);
      expect(aliceSeat.row_idx).toBe(1);
      expect(aliceSeat.col_idx).toBe(1);

      const zhang2Seat = queryJson.seats.find((s: any) => s.student_id === studentZhang2Id);
      expect(zhang2Seat.row_idx).toBe(2);
      expect(zhang2Seat.col_idx).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 3: 智能均分分组与团队协同
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 3: 智能分组与团队协同 (Smart Grouping)', () => {
    it('执行自动均分分组 POST /api/classes/:id/groups/auto (4人分2组)', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${primaryClassId}/groups/auto`, {
        method: 'POST',
        headers: teacherHeaders,
        body: JSON.stringify({ groupCount: 2 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.groups.length).toBe(2);

      // 每组应恰好分配 2 人
      for (const g of json.groups) {
        expect(g.memberIds.length).toBe(2);
        expect(g.leader_id).toBeTruthy();
        expect(g.memberIds).toContain(g.leader_id);
      }

      // 验证全员覆盖，无遗漏无重复
      const allMembers = json.groups.flatMap((g: any) => g.memberIds);
      expect(allMembers.sort()).toEqual(
        [studentAliceId, studentZhang1Id, studentZhang2Id, studentXssId].sort(),
      );
    });

    it('查询班级分组列表 GET /api/classes/:id/groups', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${primaryClassId}/groups`, {
        headers: teacherHeaders,
      });

      expect(res.status).toBe(200);
      const groups = await res.json();
      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 4: 学生退课与 GDPR 遗忘权物理擦除
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 4: 学生退课与 GDPR 物理擦除 (Dropout & GDPR Erasure)', () => {
    it('退课：教师将 XSS 探针学生从班级中移出 DELETE /api/classes/:classId/students/:studentId', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${primaryClassId}/students/${studentXssId}`, {
        method: 'DELETE',
        headers: teacherHeaders,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 班级学生表不再包含该学生，但学生主体记录依然存留
      const db = kernelContainer.db;
      const enrolled = db
        .prepare('SELECT 1 FROM class_students WHERE class_id = ? AND student_id = ?')
        .get(primaryClassId, studentXssId);
      expect(enrolled).toBeUndefined();

      const studentStillExists = db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentXssId);
      expect(studentStillExists).toBeDefined();
    });

    it('GDPR 擦除：模拟该学生产生作业提交与考勤后，执行彻底物理销毁', async () => {
      const db = kernelContainer.db;
      const now = Date.now();

      // 制造真实业务关联数据：作业提交、考勤记录、座位、已读通知
      const assignmentId = 'asg_journey_gdpr_01';
      db.prepare('INSERT OR REPLACE INTO assignments (id, class_id, title, created_at) VALUES (?, ?, ?, ?)').run(
        assignmentId,
        primaryClassId,
        'GDPR测试作业',
        now,
      );

      db.prepare(
        'INSERT OR REPLACE INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status) VALUES (?, ?, ?, ?, ?)',
      ).run(assignmentId, studentXssId, 'XSS学生的作答内容', now, 'submitted');

      db.prepare(
        'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
      ).run('sched_fake', studentXssId, 'present', now);

      db.prepare(
        'INSERT OR REPLACE INTO student_read_notifications (student_id, notification_id) VALUES (?, ?)',
      ).run(studentXssId, 'notif_01');

      // 1. SEC-DATA-02 安全校验：缺少 { confirm: true } 时必须被 400 阻断
      const unconfirmedRes = await fetch(`${baseUrl}/api/students/${studentXssId}/gdpr-delete`, {
        method: 'DELETE',
        headers: teacherHeaders,
        body: JSON.stringify({}),
      });
      expect(unconfirmedRes.status).toBe(400);

      // 2. 携带二次确认请求发起 GDPR 彻底擦除
      const res = await fetch(`${baseUrl}/api/students/${studentXssId}/gdpr-delete`, {
        method: 'DELETE',
        headers: teacherHeaders,
        body: JSON.stringify({ confirm: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 验证学生记录及所有外键关联表数据归零
      expect(db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentXssId)).toBeUndefined();
      expect(
        db.prepare('SELECT 1 FROM assignment_submissions WHERE student_id = ?').get(studentXssId),
      ).toBeUndefined();
      expect(db.prepare('SELECT 1 FROM attendance WHERE student_id = ?').get(studentXssId)).toBeUndefined();
      expect(db.prepare('SELECT 1 FROM student_seats WHERE student_id = ?').get(studentXssId)).toBeUndefined();
      expect(
        db.prepare('SELECT 1 FROM student_read_notifications WHERE student_id = ?').get(studentXssId),
      ).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 5: 班级终结级联原子销毁 (DATA-INT-01 验证)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 5: 班级终结级联原子销毁 (DATA-INT-01 12 表零残存)', () => {
    it('在班级下预置作业、排课、考勤等生态数据，然后删除班级验证 12 表原子级联清空', async () => {
      const db = kernelContainer.db;
      const now = Date.now();

      // 预置关联生态记录
      const asgId = 'asg_journey_cascade_01';
      db.prepare('INSERT OR REPLACE INTO assignments (id, class_id, title, created_at) VALUES (?, ?, ?, ?)').run(
        asgId,
        primaryClassId,
        '终结测试大作业',
        now,
      );

      db.prepare(
        'INSERT OR REPLACE INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status) VALUES (?, ?, ?, ?, ?)',
      ).run(asgId, studentAliceId, '爱丽丝的优秀答卷', now, 'submitted');

      const schedId = 'sched_journey_01';
      db.prepare(
        'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(schedId, primaryClassId, 'les_fake', '2026-10-04', now);

      db.prepare(
        'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
      ).run(schedId, studentAliceId, 'present', now);

      // 发起删除班级请求
      const res = await fetch(`${baseUrl}/api/classes/${primaryClassId}`, {
        method: 'DELETE',
        headers: teacherHeaders,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 深度审计 12 张关键关联表，确认班级及其所属专属数据彻底归零
      const checkZero = (sql: string, ...params: any[]) => {
        const row = db.prepare(sql).get(...params) as any;
        const count = row.count ?? row['count(*)'] ?? Object.values(row)[0];
        expect(count).toBe(0);
      };

      // 1. classes
      checkZero('SELECT COUNT(*) as count FROM classes WHERE id = ?', primaryClassId);
      // 2. class_students
      checkZero('SELECT COUNT(*) as count FROM class_students WHERE class_id = ?', primaryClassId);
      // 3. student_seats
      checkZero('SELECT COUNT(*) as count FROM student_seats WHERE class_id = ?', primaryClassId);
      // 4. class_groups
      checkZero('SELECT COUNT(*) as count FROM class_groups WHERE class_id = ?', primaryClassId);
      // 5. assignments
      checkZero('SELECT COUNT(*) as count FROM assignments WHERE class_id = ?', primaryClassId);
      // 6. assignment_submissions
      checkZero(
        'SELECT COUNT(*) as count FROM assignment_submissions WHERE assignment_id = ?',
        asgId,
      );
      // 7. schedules
      checkZero('SELECT COUNT(*) as count FROM schedules WHERE class_id = ?', primaryClassId);
      // 8. attendance
      checkZero('SELECT COUNT(*) as count FROM attendance WHERE schedule_id = ?', schedId);
      // 9. 该班专属学生已被级联清除
      checkZero('SELECT COUNT(*) as count FROM students WHERE id = ?', studentAliceId);
      // 10. 学生做题进度归零
      checkZero('SELECT COUNT(*) as count FROM student_lesson_progress WHERE student_id = ?', studentAliceId);
      // 11. 学生考勤记录归零
      checkZero('SELECT COUNT(*) as count FROM attendance WHERE student_id = ?', studentAliceId);
      // 12. 学生座位映射归零
      checkZero('SELECT COUNT(*) as count FROM student_seats WHERE student_id = ?', studentAliceId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 6: 权限边界与越权防护安全审计
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 6: 权限网格边界审计 (Security & Permission Mesh)', () => {
    it('匿名用户请求所有管理端点统一阻断并返回 401 Unauthorized', async () => {
      const endpoints = [
        { url: `${baseUrl}/api/classes`, method: 'GET' },
        { url: `${baseUrl}/api/classes/import`, method: 'POST', body: { classes: [] } },
        { url: `${baseUrl}/api/students/import`, method: 'POST', body: { students: [] } },
        { url: `${baseUrl}/api/classes/any-class/seats`, method: 'POST', body: { seats: [] } },
        { url: `${baseUrl}/api/classes/any-class/groups/auto`, method: 'POST', body: { groupCount: 2 } },
      ];

      for (const ep of endpoints) {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: { 'Content-Type': 'application/json' },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        expect(res.status).toBe(401);
      }
    });

    it('学生用户越权访问班级导入、排座、分组与删除端点应被 403 Forbidden 彻底阻断', async () => {
      const endpoints = [
        { url: `${baseUrl}/api/classes/import`, method: 'POST', body: { classes: [] } },
        { url: `${baseUrl}/api/students/import`, method: 'POST', body: { students: [] } },
        { url: `${baseUrl}/api/classes/any-class/seats`, method: 'POST', body: { seats: [] } },
        { url: `${baseUrl}/api/classes/any-class/groups/auto`, method: 'POST', body: { groupCount: 2 } },
        { url: `${baseUrl}/api/classes/any-class`, method: 'DELETE' },
        { url: `${baseUrl}/api/students/any-student/gdpr-delete`, method: 'DELETE' },
      ];

      for (const ep of endpoints) {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: studentHeaders,
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        expect(res.status).toBe(403);
      }
    });
  });
});
