/**
 * scripts/stress/lib/worker-thread.mjs
 * 多线程工作单元：独立拥有连接句柄，真实竞用 SQLite WAL 锁与读写资源
 */
import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';
import { applyPragmas, applyReadPragmas } from './db-fixture.mjs';

if (!parentPort || !workerData) {
  process.exit(1);
}

const {
  dbPath,
  virtualUsers,
  durationMs,
  rampupMs = 0,
  thinkMinMs = 200,
  thinkMaxMs = 800,
  profile = 'mixed',
} = workerData;

// 创建独立的写句柄
const writeDb = new Database(dbPath);
applyPragmas(writeDb);

// 创建独立的读句柄（读写分离）
const readDb = new Database(dbPath, { readonly: true, fileMustExist: true });
applyReadPragmas(readDb);

// 预编译 SQL 语句
const stmtListLessons = readDb.prepare(`
  SELECT id, title, creator_id, created_at, updated_at 
  FROM lessons 
  ORDER BY updated_at DESC 
  LIMIT 20
`);

const stmtGetLesson = readDb.prepare(`
  SELECT * FROM lessons WHERE id = ?
`);

const stmtAggReport = readDb.prepare(`
  SELECT 
    c.id as class_id, 
    c.name as class_name, 
    COUNT(DISTINCT cs.student_id) as student_count, 
    COUNT(DISTINCT sub.student_id) as submission_count, 
    AVG(sub.score) as avg_score, 
    MAX(sub.score) as max_score, 
    MIN(sub.score) as min_score 
  FROM classes c 
  LEFT JOIN class_students cs ON cs.class_id = c.id 
  LEFT JOIN assignments a ON a.class_id = c.id 
  LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id 
  GROUP BY c.id, c.name
`);

const stmtPacingInsert = writeDb.prepare(`
  INSERT INTO classroom_pacing_signals (id, session_id, student_id, signal_type, segment_id, created_at) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtHeartbeat = writeDb.prepare(`
  UPDATE client_sessions 
  SET updated_at = ? 
  WHERE id = ?
`);

const stmtUpsertSubmission = writeDb.prepare(`
  INSERT INTO assignment_submissions (assignment_id, student_id, content, score, graded_at, submitted_at, status)
  VALUES (?, ?, ?, ?, ?, ?, 'graded')
  ON CONFLICT(assignment_id, student_id)
  DO UPDATE SET score = excluded.score, submitted_at = excluded.submitted_at
`);

const stmtInsertPointLog = writeDb.prepare(`
  INSERT INTO student_point_logs (id, student_id, class_id, dimension_id, plugin_id, delta_points, reason, created_at)
  VALUES (?, ?, ?, 'academic', 'stress_runner', ?, '课堂随堂测评', ?)
`);

const stmtUpsertProgress = writeDb.prepare(`
  INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
  VALUES (?, ?, 1, 100, '[]', ?)
  ON CONFLICT(student_id, lesson_id)
  DO UPDATE SET progress_percent = excluded.progress_percent, completed = excluded.completed
`);

// 中等写事务（3 行多表级联写入）
const txSubmitGrade = writeDb.transaction((assignId, studentId, classId, content, score, lessonId, now) => {
  stmtUpsertSubmission.run(assignId, studentId, content, score, now, now);
  stmtInsertPointLog.run(`pt_${studentId}_${now}`, studentId, classId, score, now);
  stmtUpsertProgress.run(studentId, lessonId, now);
});

// 操作收集桶
const operationBuckets = {
  read_list: [],
  read_agg: [],
  write_small: [],
  write_medium: [],
  write_heartbeat: [],
};

const errorCounts = {
  sqlite_busy: 0,
  busy_timeout: 0,
  sqlite_locked: 0,
  other_error: 0,
};

function pickAction(prof) {
  const rand = Math.random() * 100;
  if (prof === 'read-only') {
    if (rand < 90) return 'read_list';
    return 'read_agg';
  }
  if (prof === 'write-only') {
    if (rand < 55) return 'write_small';
    if (rand < 80) return 'write_medium';
    return 'write_heartbeat';
  }
  // mixed 混合负载（Issue #407 规定）:
  // 50% 读列表+详情, 25% 互动状态小写, 10% 成绩提交中事务, 10% 心跳高频单行更新, 5% 报表聚合慢查
  if (rand < 50) return 'read_list';
  if (rand < 75) return 'write_small';
  if (rand < 85) return 'write_medium';
  if (rand < 95) return 'write_heartbeat';
  return 'read_agg';
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runVirtualUser(user, userIndex, totalUsers, stopTime) {
  // 爬坡延时启动
  if (rampupMs > 0 && totalUsers > 0) {
    const delay = (userIndex / totalUsers) * rampupMs;
    await sleep(delay);
  }

  const pacingSignals = ['too_fast', 'too_slow', 'got_it', 'confused'];
  let counter = 0;

  while (Date.now() < stopTime) {
    counter++;
    const action = pickAction(profile);
    const now = Date.now();
    const lessonIdx = (counter % 5) + 1;
    const lessonId = `les_${String(lessonIdx).padStart(2, '0')}`;
    const assignId = `asg_${String(lessonIdx).padStart(2, '0')}`;
    const subId = `sub_${assignId}_${user.studentId}`;
    const sessionId = `token_${user.studentId}`;

    const t0 = performance.now();
    try {
      if (action === 'read_list') {
        stmtListLessons.all();
        stmtGetLesson.get(lessonId);
      } else if (action === 'read_agg') {
        stmtAggReport.all();
      } else if (action === 'write_small') {
        const sig = pacingSignals[counter % pacingSignals.length];
        const pacingId = `sig_${lessonId}_${user.studentId}_${now}_${counter}`;
        const sessionRecordId = `cs_session_${lessonIdx}`;
        stmtPacingInsert.run(pacingId, sessionRecordId, user.studentId, sig, 'seg-main', now);
      } else if (action === 'write_medium') {
        const score = 80 + (counter % 20);
        txSubmitGrade(assignId, user.studentId, user.classId, '学生随堂提交实践数据', score, lessonId, now);
      } else if (action === 'write_heartbeat') {
        stmtHeartbeat.run(now, sessionId);
      }

      const elapsed = performance.now() - t0;
      operationBuckets[action].push(elapsed);
    } catch (err) {
      const elapsed = performance.now() - t0;
      const msg = String(err?.message || '');
      const code = String(err?.code || '');

      if (code === 'SQLITE_BUSY' || msg.includes('database is locked') || msg.includes('SQLITE_BUSY')) {
        if (elapsed >= 4900) {
          errorCounts.busy_timeout++;
        } else {
          errorCounts.sqlite_busy++;
        }
      } else if (code === 'SQLITE_LOCKED') {
        errorCounts.sqlite_locked++;
      } else {
        errorCounts.other_error++;
      }
    }

    // Think time 思考与网络间隔（200ms ~ 800ms）
    const think = randomBetween(thinkMinMs, thinkMaxMs);
    await sleep(think);
  }
}

async function main() {
  const stopTime = Date.now() + durationMs;
  const promises = virtualUsers.map((user, idx) => runVirtualUser(user, idx, virtualUsers.length, stopTime));

  await Promise.all(promises);

  try {
    writeDb.close();
    readDb.close();
  } catch {
    // ignore
  }

  parentPort.postMessage({
    operationBuckets,
    errorCounts,
  });
}

main().catch((err) => {
  console.error('[Worker Error]', err);
  process.exit(1);
});
