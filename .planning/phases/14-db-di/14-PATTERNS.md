# Phase 14: 数据库结构设计与后端 DI 成绩对接服务 - Pattern Map

**Conducted:** 2026-06-20  
**Phase:** Phase 14  
**Status:** Completed  

---

## 1. Files to be Created or Modified

### 1.1 `packages/core/di/interfaces.ts` (Modify)
- **Role**: Backend Dependency Injection contract declarations.
- **Analog**: Other Token/Interface definitions in the same file.
- **Pattern Excerpt**:
  ```typescript
  export interface ISemesterGradeService {
    saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
  }

  export const ISemesterGradeServiceToken = new Token<ISemesterGradeService>(
    '@openlearn/core:ISemesterGradeService'
  );
  ```

### 1.2 `src/plugin-host/types.ts` (Modify)
- **Role**: Frontend Plugin System contract declarations.
- **Analog**: `IStorageService` and `STORAGE_SERVICE_TOKEN` declarations.
- **Pattern Excerpt**:
  ```typescript
  export const SEMESTER_GRADE_SERVICE_TOKEN = '@openlearn/frontend:ISemesterGradeService';
  
  export interface ISemesterGradeService {
    saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
  }
  ```

### 1.3 `src/mfe/MfeContextProvider.tsx` (Modify)
- **Role**: Micro frontend DI Whitelist.
- **Analog**: `DI_WHITELIST` array.
- **Pattern Excerpt**:
  ```typescript
  export const DI_WHITELIST = [
    // ...
    '@openlearn/frontend:ISemesterGradeService'
  ];
  ```

### 1.4 `packages/core/db/index.ts` (Modify)
- **Role**: SQLite schema migrations/initialization.
- **Analog**: `CREATE TABLE IF NOT EXISTS assignment_submissions` (lines 149-159).
- **Pattern Excerpt**:
  ```typescript
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_submissions (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(lesson_id, student_id)
    );
    -- ... other plugin tables
  `);
  ```

### 1.5 `packages/core/kernel/index.ts` (Modify)
- **Role**: Backend Service implementation and bootstrap.
- **Analog**: How other services (e.g. `CommandBus`, `EventBus`, `Database`) are registered to registry.
- **Pattern Excerpt**:
  ```typescript
  import { ISemesterGradeServiceToken, ISemesterGradeService } from '../di/interfaces.js';

  class SemesterGradeService implements ISemesterGradeService {
    private db: any;
    constructor(db: any) {
      this.db = db;
    }
    async saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void> {
      // 1. Get classId from lessonId via schedules table
      const schedule = this.db.prepare('SELECT class_id FROM schedules WHERE lesson_id = ?').get(lessonId);
      if (!schedule) throw new Error(`No class scheduled for lesson: ${lessonId}`);
      
      const classId = schedule.class_id;
      const assignmentId = `plugin-lesson-${lessonId}`;

      // 2. Ensure representative assignment exists
      this.db.prepare(`
        INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(
        assignmentId,
        classId,
        lessonId,
        `平时作业 - ${lessonId}`,
        '通过上传与互评插件自动同步的平时成绩代表作业',
        '',
        Date.now()
      );

      // 3. Sync to assignment_submissions table
      this.db.prepare(`
        INSERT INTO assignment_submissions (
          assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(assignment_id, student_id) DO UPDATE SET
          score = excluded.score,
          feedback = excluded.feedback,
          graded_at = excluded.graded_at,
          status = excluded.status
      `).run(
        assignmentId,
        studentId,
        '[微应用插件同步平时成绩]',
        grade,
        '平时作业互评与评分系统确认成绩',
        Date.now(),
        Date.now(),
        'graded'
      );
    }
  }

  // Register in container:
  this.registry.register(ISemesterGradeServiceToken, new SemesterGradeService(this.db));
  ```

### 1.6 `src/plugin-host/plugin-host.ts` (Modify)
- **Role**: Frontend Plugin Service Proxy.
- **Analog**: `StorageService` proxy mapping.
- **Pattern Excerpt**:
  ```typescript
  import { SEMESTER_GRADE_SERVICE_TOKEN } from './types';

  class SemesterGradeServiceProxy implements ISemesterGradeService {
    private frontendApi: any;
    constructor(frontendApi: any) {
      this.frontendApi = frontendApi;
    }
    async saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void> {
      const res = await this.frontendApi.post('/api/grade-sync', { lessonId, studentId, grade });
      if (!res.success) {
        throw new Error(res.error || 'Failed to sync semester grade');
      }
    }
  }

  // Register in FrontendRegistry:
  await registry.register(
    SEMESTER_GRADE_SERVICE_TOKEN,
    new SemesterGradeServiceProxy(frontendApiImpl)
  );
  ```

### 1.7 `packages/plugins/assignment-eval.ts` (Create)
- **Role**: Backend logic for assignment submission, peer review, and teacher grading commands.
- **Analog**: `packages/plugins/rollcall/index.ts`.
- **Pattern Excerpt**:
  ```typescript
  import { Token } from '../core/di/token.js';
  import { IDatabaseToken, ISemesterGradeServiceToken } from '../core/di/interfaces.js';
  import type { PluginContext } from '../core/plugin-host/types.js';

  export const AssignmentEvalPlugin = {
    manifest: {
      id: '@openlearn/plugin-assignment-eval',
      name: 'Assignment Evaluation and Peer Review Plugin',
      version: '1.0.0',
      main: 'index.js',
      requires: [
        '@openlearn/core:ICommandBusService@^1.0.0',
        '@openlearn/core:IActionRegistryService@^1.0.0',
        '@openlearn/core:IDatabase@^1.0.0',
        '@openlearn/core:ISemesterGradeService@^1.0.0'
      ],
      capabilitiesProposed: ['lesson:read', 'lesson:write']
    },
    activate: async (ctx: PluginContext) => {
      const commandBus = ctx.services.commandBus;
      const actionRegistry = ctx.services.actionRegistry;
      const db = await ctx.resolve(IDatabaseToken);
      const gradeService = await ctx.resolve(ISemesterGradeServiceToken);

      // Register action descriptors and commands handlers:
      // - assignment.submit
      // - assignment.peer_review
      // - assignment.grade
    }
  };
  ```

---
*Phase: 14-db-di*
*Pattern mapping complete*
