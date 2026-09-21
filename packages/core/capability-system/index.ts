export class CapabilityGuard {
  private actorCapabilities = new Map<string, string[]>();

  constructor() {
    // Default grants
    this.actorCapabilities.set('user-demo', ['*:*:*']); // User is superadmin
    this.actorCapabilities.set('user-frontend', [
      'lesson:*',
      'whiteboard:*',
      'management:*',
      'quiz:*',
      'vfs:*',
      'process:*',
      'plugin:*',
    ]);
    this.actorCapabilities.set('anonymous', []); // Anonymous has no permissions
    this.actorCapabilities.set('agent-system-0', [
      'lesson:write',
      'lesson:delete',
      'whiteboard:write',
      'quiz:write',
      'plugin:read',
      'vfs:read',
      'vfs:write',
      'management:write',
      'management:read',
      'process:write',
      'process:read',
    ]);
    this.actorCapabilities.set('teacher-demo', ['lesson:*', 'whiteboard:*', 'management:*', 'quiz:*', 'vfs:*']);
    this.actorCapabilities.set('student-demo', ['student:write', 'lesson:read', 'whiteboard:read']);
  }

  public grant(actorId: string, cap: string) {
    const caps = this.actorCapabilities.get(actorId) || [];
    if (!caps.includes(cap)) {
      caps.push(cap);
    }
    this.actorCapabilities.set(actorId, caps);
  }

  public revokeAll(actorId: string) {
    this.actorCapabilities.delete(actorId);
  }

  public check(actorId: string, requiredCap: string): boolean {
    const isAdmin =
      actorId === 'role:administrator' ||
      actorId?.endsWith(':administrator') ||
      actorId === 'admin' ||
      actorId === 'usr_admin' ||
      actorId === 'admin-demo';
    if (isAdmin) return true;

    // Role-based capability fallback
    if (actorId?.endsWith(':teacher')) {
      // student:write 供教师预览互动课件（attempt.student_id = 'teacher_preview'）
      // 或代录学生成绩时使用；路由层仍按 attempt.student_id 校验所属权。
      // assignment:submit / assignment:review 让教师能代交、试评与终评。
      const teacherCaps = [
        'lesson:*',
        'whiteboard:*',
        'management:*',
        'quiz:*',
        'vfs:*',
        'process:*',
        'plugin:*',
        'student:write',
        'assignment:read',
        'assignment:submit',
        'assignment:review',
        'assignment:manage',
      ];
      const [reqRes, reqAct] = requiredCap.split(':');
      if (
        teacherCaps.some((c) => {
          const [res, act] = c.split(':');
          return (res === reqRes || res === '*') && (act === reqAct || act === '*');
        })
      ) {
        return true;
      }
    }

    if (actorId?.endsWith(':student')) {
      // assignment:submit / assignment:review 是学生唯一能发起作业写入的入口，
      // 因此**不含** lesson:write（避免学生改课时内容）；命令处理器内部再按
      // actorId 与 payload.studentId 校验所属权，防止代交/代评。
      const studentCaps = [
        'student:write',
        'lesson:read',
        'whiteboard:read',
        'assignment:read',
        'assignment:submit',
        'assignment:review',
      ];
      const [reqRes, reqAct] = requiredCap.split(':');
      if (
        studentCaps.some((c) => {
          const [res, act] = c.split(':');
          return (res === reqRes || res === '*') && (act === reqAct || act === '*');
        })
      ) {
        return true;
      }
    }

    const caps = this.actorCapabilities.get(actorId) || [];
    // Superadmin bypass
    if (caps.includes('*:*:*') || caps.includes('*')) return true;
    // Direct match
    if (caps.includes(requiredCap)) return true;

    // Partial wildcard: e.g. lesson:* matches lesson:write
    const [reqRes, reqAct] = requiredCap.split(':');
    return caps.some((c) => {
      const [res, act] = c.split(':');
      return (res === reqRes || res === '*') && (act === reqAct || act === '*');
    });
  }
}
