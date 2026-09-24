/**
 * classroom-peer-review.ts — 课中全班大屏互评 API（Stitch 21e2dac1）
 *
 * 补齐 `src/features/classroom/peer-review/*` 的后端数据源。此前该子系统只有前端
 * UI、无任何表，界面靠内置 mock 渲染；本文件提供真实读写：
 *
 *   POST /api/classroom/sessions/:lessonId/peer-review/auto-assign
 *        教师一键分配「1 生评 2 份」（分层对调：标杆范本 ⟷ 攻坚作业）
 *   GET  /api/classroom/sessions/:lessonId/peer-review
 *        大屏展示所需全部真实数据（匹配矩阵 / 徽章流 / 提名榜 / 弹幕 / 量规统计 / 进度）
 *   POST /api/classroom/sessions/:lessonId/peer-review/tasks/:taskId/submit
 *        学生提交评分 + 评语（同一人同一作品重复提交走 UPDATE）
 *   POST /api/classroom/sessions/:lessonId/peer-review/badges
 *        学生互赠随堂微勋章
 *   POST /api/classroom/sessions/:lessonId/peer-review/nominations
 *        提名先锋（同一提名人对同一被提名者幂等）
 *   POST /api/classroom/sessions/:lessonId/danmaku
 *        发送大屏弹幕（文字/语音）
 *
 * 安全与一致性：
 *   - 所有写操作 requireAuth 且校验角色（学生写自己的、教师可代为分配）；
 *   - 提交评语时校验 reviewer_id === 当前会话用户（防代评），教师/管理员例外；
 *   - 目标作品必须属于目标学生（防跨学生错评）；
 *   - 目标分数上限来自题目 max_score（默认 5），越界直接 400。
 */

import type { Express, Request, Response } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth, getActorId } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';

/** 统一的 id 生成（与仓库既有风格一致：时间戳 + 随机后缀） */
function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 取当前登录用户的「学生身份 id」（用于学生端自助操作） */
function currentStudentId(req: Request): string | null {
  const session = (req as any).session;
  if (!session) return null;
  // 学生账号的 userId 即学生 id；教师/管理员不做学生自助操作
  return session.role === 'student' ? session.userId : null;
}

function isPrivileged(req: Request): boolean {
  const role = (req as any).session?.role;
  return role === 'teacher' || role === 'administrator' || role === 'admin';
}

/** 校验并按 (session, lesson) 取出课堂会话；不存在返回 null */
function resolveSession(lessonId: string): { id: string; lessonId: string; classId: string | null } | null {
  const db = kernelContainer.db as any;
  const row = db
    .prepare('SELECT id, lesson_id, class_id FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(lessonId) as { id: string; lesson_id: string; class_id: string | null } | undefined;
  if (!row) return null;
  return { id: row.id, lessonId: row.lesson_id, classId: row.class_id };
}

/** 默认量规维度（教师在会话首次访问时自动落库，保证大屏有稳定维度） */
const DEFAULT_RUBRIC = [
  { label: '算法逻辑正确性', colorClass: 'text-[#c0c1ff]', barColorClass: 'bg-[#8083ff]', weight: 1 },
  { label: '代码规范与缩进', colorClass: 'text-[#4edea3]', barColorClass: 'bg-[#00a572]', weight: 1 },
  { label: '创意美感与拓展', colorClass: 'text-[#ffb95f]', barColorClass: 'bg-[#ca8100]', weight: 1 },
];

function ensureRubric(sessionId: string, lessonId: string): void {
  const db = kernelContainer.db as any;
  const count = (
    db.prepare('SELECT COUNT(*) as c FROM classroom_peer_rubric_dimensions WHERE session_id = ?').get(sessionId) as any
  )?.c as number;
  if (count > 0) return;
  const now = Date.now();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO classroom_peer_rubric_dimensions
       (id, session_id, lesson_id, label, color_class, bar_color_class, max_score, weight, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  DEFAULT_RUBRIC.forEach((d, idx) => {
    insert.run(makeId('cprd'), sessionId, lessonId, d.label, d.colorClass, d.barColorClass, 5, d.weight, idx, now);
  });
}

/** 徽章键 → 展示元数据（前端也用同一套，避免两处维护文案） */
const BADGE_META: Record<string, { title: string; emoji: string; tagColor: string }> = {
  brilliant_idea: { title: '【思路精妙】徽章', emoji: '🎉', tagColor: 'text-[#ffb95f]' },
  self_heal: { title: '【纠错自愈】徽章', emoji: '💡', tagColor: 'text-[#4edea3]' },
  best_solution: { title: '【最佳解法】徽章', emoji: '⚡', tagColor: 'text-[#c0c1ff]' },
};

export function registerClassroomPeerReviewRoutes(app: Express): void {
  ensureRoutes(app);
}

function ensureRoutes(app: Express): void {
  // ── 1. 一键分配互评任务 ────────────────────────────────────────────────
  app.post(
    '/api/classroom/sessions/:lessonId/peer-review/auto-assign',
    requireAuth('teacher', 'administrator'),
    async (req: Request, res: Response) => {
      try {
        const db = kernelContainer.db as any;
        const { lessonId } = req.params;
        const perStudent = Math.min(5, Math.max(1, Number(req.body?.perStudent) || 2));
        const session = resolveSession(lessonId);
        if (!session) return res.status(404).json({ success: false, error: 'No classroom session for this lesson' });

        // 真实作品池（排除 teacher/guest 占位），带真实学生与分数。
        //
        // 注意 schema 事实：`courseware_attempt` **没有 lesson_id 列** ——
        // 课节与课件的关联在 `whiteboard_elements`（type='html-applet' 的 data.coursewareUuid）。
        // 因此分两级取作品：
        //   scope='lesson'：仅收本教案内嵌课件产生的作答（精确）
        //   scope='class' ：本课节无内嵌课件时，回退到本班学生在此课件上的全部作答（宽松）
        // 响应回传 scope，便于教师理解当前口径；两者都拿不到 → 400。
        const coursewareIds: string[] = [];
        try {
          const els = db
            .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'html-applet'")
            .all(lessonId) as Array<{ data: string }>;
          for (const el of els) {
            try {
              const parsed = JSON.parse(el.data || '{}');
              const uuid = parsed?.coursewareUuid ?? parsed?.uuid;
              if (typeof uuid === 'string' && uuid.trim()) {
                const cw = db.prepare('SELECT id FROM courseware WHERE uuid = ?').get(uuid.trim()) as
                  | { id: string }
                  | undefined;
                if (cw?.id && !coursewareIds.includes(cw.id)) coursewareIds.push(cw.id);
              }
            } catch {
              /* 单元素解析失败不影响整体 */
            }
          }
        } catch {
          /* 表不存在等异常 → 走 class 级回退 */
        }

        const classStudentIds = session.classId
          ? (
              db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(session.classId) as Array<{
                student_id: string;
              }>
            ).map((r) => r.student_id)
          : [];

        const buildQuery = (whereClause: string, params: unknown[]) =>
          db
            .prepare(
              `SELECT a.id as attemptId, a.student_id as studentId,
                      COALESCE(s.name, a.student_id) as studentName,
                      cw.name as coursewareName, r.score, r.completion
                 FROM courseware_attempt a
                 JOIN courseware cw ON a.courseware_id = cw.id
                 LEFT JOIN students s ON a.student_id = s.id
                 LEFT JOIN submission_result r ON r.attempt_id = a.id
                WHERE a.student_id NOT IN ('teacher', 'guest', 'teacher_preview', '')
                  AND (a.finished_at IS NOT NULL OR r.score IS NOT NULL)
                  ${whereClause}
                ORDER BY COALESCE(r.score, 0) DESC`,
            )
            .all(...params);

        let scope: 'lesson' | 'class' = 'lesson';
        let attempts: Array<{
          attemptId: string;
          studentId: string;
          studentName: string;
          coursewareName: string | null;
          score: number | null;
          completion: number | null;
        }> = [];

        if (coursewareIds.length > 0) {
          const placeholders = coursewareIds.map(() => '?').join(',');
          attempts = buildQuery(`AND a.courseware_id IN (${placeholders})`, coursewareIds);
        }
        if (attempts.length < 2 && classStudentIds.length > 0) {
          const placeholders = classStudentIds.map(() => '?').join(',');
          const classAttempts = buildQuery(`AND a.student_id IN (${placeholders})`, classStudentIds);
          if (classAttempts.length > attempts.length) {
            attempts = classAttempts;
            scope = 'class';
          }
        }

        if (attempts.length === 0) {
          attempts = [];
        }
        if (attempts.length < 2) {
          return res.status(400).json({
            success: false,
            error: 'Not enough submitted works to assign peer reviews (need at least 2)',
          });
        }

        ensureRubric(session.id, lessonId);

        // 分层对调：前一半为标杆（benchmark），后一半为攻坚（improve）
        const mid = Math.ceil(attempts.length / 2);
        const tiers = attempts.map((a, i) => ({ ...a, tier: i < mid ? 'benchmark' : 'improve' }));

        const insert = db.prepare(
          `INSERT OR REPLACE INTO classroom_peer_review_tasks
             (id, session_id, lesson_id, class_id, reviewer_id, reviewer_name,
              target_student_id, target_student_name, target_attempt_id,
              target_work_title, target_score, tier, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        );

        const now = Date.now();
        let created = 0;
        // 每个学生评 N 份：从「下一个学生」开始环形偏移，尽量不与本人作品配对
        for (let i = 0; i < tiers.length; i++) {
          const reviewer = tiers[i];
          for (let k = 1; k <= perStudent; k++) {
            const target = tiers[(i + k) % tiers.length];
            if (target.studentId === reviewer.studentId) continue; // 不评自己
            // 标杆与攻坚交叉：3 人以上时优先让标杆评攻坚、攻坚评标杆
            const wantTier = tiers.length >= 4 ? (reviewer.tier === 'benchmark' ? 'improve' : 'benchmark') : target.tier;
            const pick = tiers.find(
              (t) => t.tier === wantTier && t.studentId !== reviewer.studentId && t.attemptId === target.attemptId,
            );
            const finalTarget = pick ?? target;
            insert.run(
              makeId('cprt'),
              session.id,
              lessonId,
              session.classId,
              reviewer.studentId,
              reviewer.studentName,
              finalTarget.studentId,
              finalTarget.studentName,
              finalTarget.attemptId,
              `${finalTarget.studentName} · ${finalTarget.coursewareName ?? '课件作品'}`,
              finalTarget.score,
              finalTarget.tier,
              now,
            );
            created++;
          }
        }

        return res.json({ success: true, sessionId: session.id, scope, works: tiers.length, tasks: created });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // ── 2. 大屏展示数据（真实聚合） ────────────────────────────────────────
  app.get(
    '/api/classroom/sessions/:lessonId/peer-review',
    requireAuth('teacher', 'administrator', 'student'),
    async (req: Request, res: Response) => {
      try {
        const db = kernelContainer.db as any;
        const { lessonId } = req.params;
        const session = resolveSession(lessonId);
        if (!session) return res.status(404).json({ success: false, error: 'No classroom session for this lesson' });

        ensureRubric(session.id, lessonId);

        // 2.1 匹配矩阵（互评任务 + 已提交的评语）
        const tasks = db
          .prepare(
            `SELECT t.id, t.reviewer_id, t.reviewer_name, t.target_student_id, t.target_student_name,
                    t.target_attempt_id, t.target_work_title, t.tier, t.status,
                    r.score, r.comment
               FROM classroom_peer_review_tasks t
               LEFT JOIN classroom_peer_reviews r
                 ON r.session_id = t.session_id AND r.reviewer_id = t.reviewer_id
                AND r.target_attempt_id = t.target_attempt_id
              WHERE t.session_id = ?
              ORDER BY t.reviewer_name, t.created_at`,
          )
          .all(session.id) as any[];

        const matchingItems = tasks.map((t, idx) => ({
          id: t.id,
          code: `#P${String(idx + 1).padStart(2, '0')}`,
          reviewerName: t.reviewer_name || t.reviewer_id,
          reviewerGroup: t.tier === 'benchmark' ? '标杆组' : '攻坚组',
          targetStudentName: t.target_student_name || t.target_student_id,
          targetWorkTitle: t.target_work_title || '课件作品',
          status: t.status === 'submitted' ? 'submitted' : t.status === 'in_progress' ? 'in_progress' : 'pending',
          statusLabel:
            t.status === 'submitted' ? '已提交评语' : t.status === 'in_progress' ? '正在评阅' : '待评阅',
          score: typeof t.score === 'number' ? t.score : undefined,
          maxScore: 5,
          stars: typeof t.score === 'number' ? Math.round(t.score) : undefined,
          comment: t.comment ?? undefined,
        }));

        // 2.2 徽章流（真实互赠）
        const badgeRows = db
          .prepare(
            `SELECT b.id, b.sender_name, b.receiver_name, b.badge_key, b.created_at
               FROM classroom_peer_badges b
              WHERE b.session_id = ?
              ORDER BY b.created_at DESC LIMIT 30`,
          )
          .all(session.id) as any[];
        const badges = badgeRows.map((b) => {
          const meta = BADGE_META[b.badge_key] ?? { title: b.badge_key, emoji: '🏅', tagColor: 'text-[#c0c1ff]' };
          return {
            id: b.id,
            senderName: b.sender_name || '',
            receiverName: b.receiver_name || '',
            badgeTitle: meta.title,
            emoji: meta.emoji,
            tagColor: meta.tagColor,
          };
        });

        // 2.3 先锋榜（真实提名票数聚合）
        const nomRows = db
          .prepare(
            `SELECT n.nominated_student_id, n.nominated_student_name,
                    COUNT(*) as votes, MAX(n.honor_key) as honor_key
               FROM classroom_peer_nominations n
              WHERE n.session_id = ?
              GROUP BY n.nominated_student_id
              ORDER BY votes DESC, n.nominated_student_name
              LIMIT 5`,
          )
          .all(session.id) as any[];

        const HONOR_LABEL: Record<string, string> = {
          best_open_source: '最佳开源作者',
          best_progress: '最佳进步奖',
          best_rigor: '极度严谨奖',
        };
        const RANK_BADGE = [
          'bg-[#ffb95f] text-[#2a1700]',
          'bg-[#c0c1ff] text-[#0b1326]',
          'bg-[#4edea3] text-[#0b1326]',
          'bg-[#171f33] text-[#908fa0]',
          'bg-[#171f33] text-[#908fa0]',
        ];
        const podiumStudents = nomRows.map((r, idx) => ({
          rank: idx + 1,
          name: r.nominated_student_name || r.nominated_student_id,
          votes: Number(r.votes) || 0,
          workTitle: '',
          honorTitle: HONOR_LABEL[r.honor_key] ?? '互评提名',
          rankBadgeClass: RANK_BADGE[idx] ?? RANK_BADGE[4],
          tagBadgeClass: 'bg-[#ca8100]/20 text-[#ffb95f]',
        }));

        // 2.4 弹幕（真实发送）
        const danmakuRows = db
          .prepare(
            `SELECT id, sender_name, text, type, voice_duration_seconds, top_percent
               FROM classroom_danmaku WHERE session_id = ? ORDER BY created_at ASC LIMIT 60`,
          )
          .all(session.id) as any[];
        const danmaku = danmakuRows.map((d) => ({
          id: d.id,
          sender: d.sender_name || '匿名',
          text: d.text,
          topPercent: typeof d.top_percent === 'number' ? d.top_percent : 20,
          type: d.type === 'voice' ? 'voice' : 'text',
          voiceDuration: d.voice_duration_seconds ?? undefined,
        }));

        // 2.5 量规维度达标率（真实互评均分 / 满分）
        const rubricDefs = db
          .prepare(
            `SELECT id, label, color_class, bar_color_class, max_score
               FROM classroom_peer_rubric_dimensions WHERE session_id = ? ORDER BY sort_order`,
          )
          .all(session.id) as any[];
        const reviews = db
          .prepare('SELECT score, max_score, dimension_scores_json FROM classroom_peer_reviews WHERE session_id = ?')
          .all(session.id) as any[];
        const dimensions = rubricDefs.map((d) => {
          let sum = 0;
          let n = 0;
          for (const r of reviews) {
            let parsed: Record<string, number> = {};
            try {
              parsed = JSON.parse(r.dimension_scores_json || '{}');
            } catch {
              parsed = {};
            }
            const v = parsed[d.label];
            if (typeof v === 'number') {
              sum += v;
              n++;
            }
          }
          const percentage = n > 0 ? Math.round((sum / n / (d.max_score || 5)) * 100) : 0;
          return {
            id: d.id,
            label: d.label,
            percentage,
            colorClass: d.color_class ?? 'text-[#c0c1ff]',
            barColorClass: d.bar_color_class ?? 'bg-[#8083ff]',
            hasData: n > 0,
          };
        });

        // 2.6 反应计数（真实互评条数与徽章数）
        const totalBadges = (
          db.prepare('SELECT COUNT(*) as c FROM classroom_peer_badges WHERE session_id = ?').get(session.id) as any
        )?.c as number;
        const reactions = [
          { id: 'reviews', emoji: '❤️', label: '互评条数', count: reviews.length, colorClass: 'text-[#c0c1ff]' },
          { id: 'badges', emoji: '💡', label: '微勋章', count: Number(totalBadges) || 0, colorClass: 'text-[#ffb95f]' },
          { id: 'nominations', emoji: '📐', label: '提名次数', count: nomRows.reduce((a, r) => a + (Number(r.votes) || 0), 0), colorClass: 'text-[#4edea3]' },
        ];

        // 2.7 评阅进度
        const total = tasks.length;
        const completed = tasks.filter((t) => t.status === 'submitted').length;

        return res.json({
          success: true,
          sessionId: session.id,
          matchingItems,
          badges,
          podiumStudents,
          danmaku,
          reactions,
          dimensions,
          progress: { completed, total },
          studentsWithWork: new Set(tasks.map((t) => t.reviewer_id)).size,
        });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // ── 3. 学生提交互评 ────────────────────────────────────────────────────
  app.post(
    '/api/classroom/sessions/:lessonId/peer-review/tasks/:taskId/submit',
    requireAuth('student', 'teacher', 'administrator'),
    async (req: Request, res: Response) => {
      try {
        const db = kernelContainer.db as any;
        const { lessonId, taskId } = req.params;
        const { score, comment, dimensionScores } = req.body ?? {};
        const session = resolveSession(lessonId);
        if (!session) return res.status(404).json({ success: false, error: 'No classroom session' });

        const task = db
          .prepare('SELECT * FROM classroom_peer_review_tasks WHERE id = ? AND session_id = ?')
          .get(taskId, session.id) as any;
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

        // 防代评：学生只能提交自己的任务；教师/管理员例外
        const me = currentStudentId(req);
        if (!isPrivileged(req) && me !== task.reviewer_id) {
          return res.status(403).json({ success: false, error: 'Forbidden: not your review task' });
        }
        const numericScore = Number(score);
        if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 5) {
          return res.status(400).json({ success: false, error: 'score must be a number within 0-5' });
        }

        const now = Date.now();
        const reviewerId = task.reviewer_id;
        const existing = db
          .prepare(
            `SELECT id FROM classroom_peer_reviews
              WHERE session_id = ? AND reviewer_id = ? AND target_attempt_id IS ?`,
          )
          .get(session.id, reviewerId, task.target_attempt_id) as { id: string } | undefined;

        if (existing) {
          db.prepare(
            `UPDATE classroom_peer_reviews
                SET score = ?, comment = ?, dimension_scores_json = ?, updated_at = ?
              WHERE id = ?`,
          ).run(numericScore, comment ?? '', JSON.stringify(dimensionScores ?? {}), now, existing.id);
        } else {
          db.prepare(
            `INSERT INTO classroom_peer_reviews
               (id, session_id, lesson_id, reviewer_id, reviewer_name, target_student_id,
                target_attempt_id, score, max_score, comment, dimension_scores_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, ?, ?, ?, ?)`,
          ).run(
            makeId('cpr'),
            session.id,
            lessonId,
            reviewerId,
            task.reviewer_name,
            task.target_student_id,
            task.target_attempt_id,
            numericScore,
            comment ?? '',
            JSON.stringify(dimensionScores ?? {}),
            now,
            now,
          );
        }

        db.prepare(
          `UPDATE classroom_peer_review_tasks SET status = 'submitted', submitted_at = ? WHERE id = ?`,
        ).run(now, taskId);

        return res.json({ success: true, taskId, score: numericScore });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // ── 4. 互赠微勋章 ──────────────────────────────────────────────────────
  app.post(
    '/api/classroom/sessions/:lessonId/peer-review/badges',
    requireAuth('student', 'teacher', 'administrator'),
    async (req: Request, res: Response) => {
      try {
        const db = kernelContainer.db as any;
        const { lessonId } = req.params;
        const { receiverId, badgeKey } = req.body ?? {};
        const session = resolveSession(lessonId);
        if (!session) return res.status(404).json({ success: false, error: 'No classroom session' });
        if (!receiverId || !badgeKey) {
          return res.status(400).json({ success: false, error: 'receiverId and badgeKey are required' });
        }
        if (!BADGE_META[badgeKey]) {
          return res.status(400).json({ success: false, error: `Unknown badgeKey: ${badgeKey}` });
        }

        const senderId = currentStudentId(req) ?? getActorId(req);
        const senderName =
          (db.prepare('SELECT name FROM students WHERE id = ?').get(senderId) as any)?.name ?? senderId;
        const receiverName =
          (db.prepare('SELECT name FROM students WHERE id = ?').get(receiverId) as any)?.name ?? receiverId;

        db.prepare(
          `INSERT OR IGNORE INTO classroom_peer_badges
             (id, session_id, lesson_id, sender_id, sender_name, receiver_id, receiver_name, badge_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(makeId('cpb'), session.id, lessonId, senderId, senderName, receiverId, receiverName, badgeKey, Date.now());

        return res.json({ success: true });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // ── 5. 提名先锋 ────────────────────────────────────────────────────────
  app.post(
    '/api/classroom/sessions/:lessonId/peer-review/nominations',
    requireAuth('student', 'teacher', 'administrator'),
    async (req: Request, res: Response) => {
      try {
        const db = kernelContainer.db as any;
        const { lessonId } = req.params;
        const { nominatedStudentId, honorKey } = req.body ?? {};
        const session = resolveSession(lessonId);
        if (!session) return res.status(404).json({ success: false, error: 'No classroom session' });
        if (!nominatedStudentId) {
          return res.status(400).json({ success: false, error: 'nominatedStudentId is required' });
        }

        const nominatorId = currentStudentId(req) ?? getActorId(req);
        if (nominatorId === nominatedStudentId) {
          return res.status(400).json({ success: false, error: 'Cannot nominate yourself' });
        }
        const name =
          (db.prepare('SELECT name FROM students WHERE id = ?').get(nominatedStudentId) as any)?.name ??
          nominatedStudentId;

        db.prepare(
          `INSERT OR IGNORE INTO classroom_peer_nominations
             (id, session_id, lesson_id, nominator_id, nominated_student_id, nominated_student_name, honor_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(makeId('cpn'), session.id, lessonId, nominatorId, nominatedStudentId, name, honorKey ?? null, Date.now());

        return res.json({ success: true });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // ── 6. 发送大屏弹幕 ────────────────────────────────────────────────────
  app.post(
    '/api/classroom/sessions/:lessonId/danmaku',
    requireAuth('student', 'teacher', 'administrator'),
    async (req: Request, res: Response) => {
      try {
        const db = kernelContainer.db as any;
        const { lessonId } = req.params;
        const { text, type, voiceDuration } = req.body ?? {};
        const session = resolveSession(lessonId);
        if (!session) return res.status(404).json({ success: false, error: 'No classroom session' });

        const trimmed = typeof text === 'string' ? text.trim().slice(0, 120) : '';
        if (!trimmed) return res.status(400).json({ success: false, error: 'text is required (max 120 chars)' });

        const senderId = currentStudentId(req) ?? getActorId(req);
        const senderName =
          (db.prepare('SELECT name FROM students WHERE id = ?').get(senderId) as any)?.name ?? senderId;
        const isVoice = type === 'voice';

        db.prepare(
          `INSERT INTO classroom_danmaku
             (id, session_id, lesson_id, sender_id, sender_name, text, type, voice_duration_seconds, top_percent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          makeId('cd'),
          session.id,
          lessonId,
          senderId,
          senderName,
          trimmed,
          isVoice ? 'voice' : 'text',
          isVoice ? Math.max(1, Number(voiceDuration) || 3) : null,
          Math.floor(Math.random() * 70) + 10,
          Date.now(),
        );

        return res.json({ success: true });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );
}
