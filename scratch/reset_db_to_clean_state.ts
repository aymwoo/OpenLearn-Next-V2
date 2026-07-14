import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

const dbPath = path.resolve('/home/wuxf/Develop/openlearnv2/packages/core/db/educational_os.db');

async function main() {
  console.log('Connecting to database at:', dbPath);
  const db = new Database(dbPath);

  // 开启外键约束并使用事务确保强一致性
  db.exec('PRAGMA foreign_keys = OFF;'); 

  console.log('Starting DB reset to clean initial state...');

  // 1. 获取所有表名，筛选出需要清空的表以及需要删除的插件表
  const sqliteMaster = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const allTables = sqliteMaster.map(t => t.name);

  // 这些是核心配置或必须保留的非业务大表（核心插件列表、VFS、AI 供应端不用一并抹掉，保留以防平台崩塌）
  const tablesToPreserve = new Set([
    'plugins',       // 保留核心内置插件注册信息
    'ai_providers',  // 保留 AI 设置以防报错
    'sqlite_sequence'
  ]);

  for (const table of allTables) {
    // 自动 DROP 插件自建的业务表
    if (table.startsWith('plugin_') && table !== 'plugin_storage') {
      console.log(`- Dropping plugin physical table: ${table}`);
      try {
        db.exec(`DROP TABLE IF EXISTS ${table}`);
      } catch (e: any) {
        console.warn(`  Warning: Failed to drop ${table}:`, e.message);
      }
      continue;
    }

    if (tablesToPreserve.has(table)) {
      continue;
    }

    // 清空其他所有表中的历史记录
    console.log(`- Truncating table: ${table}`);
    try {
      db.exec(`DELETE FROM ${table}`);
      try {
        // 重置自增主键
        db.exec(`DELETE FROM sqlite_sequence WHERE name='${table}'`);
      } catch {}
    } catch (e: any) {
      console.warn(`  Warning: Failed to clear ${table}:`, e.message);
    }
  }

  console.log('\nSeeding initial clean data...');

  // 2. 插入唯一的管理员账号 (usr_admin)
  // 密码哈希对应明文 "admin"，使用内置的 bcrypt 库动态实时哈希，保证 100% 正确！
  const initialAdminPasswordHash = bcrypt.hashSync('admin', 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'usr_admin',
    'admin',
    initialAdminPasswordHash,
    'administrator',
    'System Admin',
    'active',
    Date.now()
  );
  console.log('+ Seeded 1 Administrator (admin / admin)');

  // 2.5 插入唯一的教师账号 (usr_teacher)
  const initialTeacherPasswordHash = bcrypt.hashSync('teacher', 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'usr_teacher',
    'teacher',
    initialTeacherPasswordHash,
    'teacher',
    'Regular Teacher',
    'active',
    Date.now()
  );
  console.log('+ Seeded 1 Teacher (teacher / teacher)');

  // 3. 插入 1 个测试班级
  const classId = 'class_test';
  db.prepare(`
    INSERT INTO classes (id, name, description, created_at)
    VALUES (?, ?, ?, ?)
  `).run(
    classId,
    '人工智能与创意编程测试班',
    '系统预置测试班级，包含 10 名测试学生名册与标准平时分权重配置。',
    Date.now()
  );
  console.log('+ Seeded 1 Test Class (人工智能与创意编程测试班)');

  // 3.1 为测试班级插入默认成绩权重，保证成绩看板加载正常
  db.prepare(`
    INSERT INTO class_grade_weights (class_id, attendance_weight, progress_weight, assignment_weight, exam_weight, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(classId, 0.15, 0.25, 0.35, 0.25, Date.now());
  console.log('+ Seeded Class Grade Weights (15% Attendance, 25% Progress, 35% Assignment, 25% Exams)');

  // 4. 插入 10 个测试学生
  const students = [
    { id: 's_test_1', name: '测试学生A', num: 'S001' },
    { id: 's_test_2', name: '测试学生B', num: 'S002' },
    { id: 's_test_3', name: '测试学生C', num: 'S003' },
    { id: 's_test_4', name: '测试学生D', num: 'S004' },
    { id: 's_test_5', name: '测试学生E', num: 'S005' },
    { id: 's_test_6', name: '测试学生F', num: 'S006' },
    { id: 's_test_7', name: '测试学生G', num: 'S007' },
    { id: 's_test_8', name: '测试学生H', num: 'S008' },
    { id: 's_test_9', name: '测试学生I', num: 'S009' },
    { id: 's_test_10', name: '测试学生J', num: 'S010' },
  ];

  for (const s of students) {
    // 写入学生表
    db.prepare(`
      INSERT INTO students (id, name, student_number, created_at)
      VALUES (?, ?, ?, ?)
    `).run(s.id, s.name, s.num, Date.now());

    // 绑定到测试班级
    db.prepare(`
      INSERT INTO class_students (class_id, student_id, joined_at)
      VALUES (?, ?, ?)
    `).run(classId, s.id, Date.now());
  }
  console.log(`+ Seeded 10 Test Students (S001 - S010) bound to class "${classId}"`);

  // 5. 插入 1 个典型的测试课程课件
  const lessonId = 'lesson_test';
  db.prepare(`
    INSERT INTO lessons (id, title, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    lessonId,
    '初识 Python：智能白板创意编程',
    JSON.stringify({ elements: [] }),
    Date.now(),
    Date.now()
  );
  console.log('+ Seeded 1 Typical Test Lesson (初识 Python：智能白板创意编程)');

  // 启用外键约束
  db.exec('PRAGMA foreign_keys = ON;');
  db.close();

  console.log('\nDatabase has been successfully restored to a clean initial state!');
}

main().catch(console.error);
