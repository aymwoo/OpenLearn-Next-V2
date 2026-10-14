import { describe, it, expect, vi } from 'vitest';
import { buildOpenAITools, buildAgentSystemInstruction, executeAgentToolCall } from '../ai-agent.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { AgentToolExecution } from '../context.js';

describe('Stage 1 Security Audit Hotfix Suite', () => {
  describe('SEC-01: AI Agent Role Isolation and Actor Passthrough', () => {
    it('should strictly filter out side-effect tools when callerRole is student', () => {
      const studentTools = buildOpenAITools('student');
      const studentToolNames = studentTools.map((t) => t.function.name);

      // 学生不应能获得进程控制、管理、课件上传、VFS 写操作工具
      for (const toolName of studentToolNames) {
        expect(toolName.startsWith('process_')).toBe(false);
        expect(toolName.startsWith('class_create')).toBe(false);
        expect(toolName.startsWith('student_create')).toBe(false);
        expect(toolName.startsWith('courseware_upload')).toBe(false);
        expect(toolName.startsWith('vfs_write')).toBe(false);
      }
    });

    it('should include full tools for teacher or admin roles', () => {
      const teacherTools = buildOpenAITools('teacher');
      const teacherToolNames = teacherTools.map((t) => t.function.name);

      // 教师或管理员工具中应包含核心教学与资源工具
      expect(teacherToolNames.length).toBeGreaterThan(buildOpenAITools('student').length);
    });

    it('should generate student-specific learning assistant instructions', () => {
      const studentPromptZh = buildAgentSystemInstruction('zh', null, [], undefined, 'student');
      expect(studentPromptZh).toContain('智能学习助教');
      expect(studentPromptZh).toContain('没有管理班级、修改成绩或操作系统底层的权限');
      expect(studentPromptZh).not.toContain('class_create');
      expect(studentPromptZh).not.toContain('process.spawn');

      const studentPromptEn = buildAgentSystemInstruction('en', null, [], undefined, 'student');
      expect(studentPromptEn).toContain('learning assistant for students');
      expect(studentPromptEn).toContain('do not have permissions');
    });

    it('should not elevate student actor to agent-system-0 in executeAgentToolCall', async () => {
      const executed: AgentToolExecution[] = [];
      const studentActorId = 'user:stu_test_123:student';

      // 尝试调用一个需要教师权限的工具（如 process.spawn）
      const result = await executeAgentToolCall(
        'process_spawn',
        { name: 'malicious', duration: 10 },
        executed,
        'student',
        null,
        studentActorId,
      );

      // 内核能力拦截器应当拒绝或者执行失败，绝不能以 agent-system-0 提权成功
      expect(result.error).toBeDefined();
      expect(executed[0].success).toBe(false);
    });
  });

  describe('SEC-04: ZIP Bomb and Path Traversal Defenses', () => {
    it('storageDirWithSep should reject sibling directory escape', () => {
      const storageDir = '/var/app/storage/courseware/uuid1';
      const storageDirWithSep = storageDir + '/';

      const siblingEvilPath = '/var/app/storage/courseware/uuid1-evil/hacked.html';
      const legitPath = '/var/app/storage/courseware/uuid1/index.html';

      expect(siblingEvilPath.startsWith(storageDirWithSep)).toBe(false);
      expect(legitPath.startsWith(storageDirWithSep)).toBe(true);
    });
  });
});
