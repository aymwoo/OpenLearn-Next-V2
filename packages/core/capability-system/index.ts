export class CapabilityGuard {
  private actorCapabilities = new Map<string, string[]>();

  constructor() {
    // Default grants
    this.actorCapabilities.set('user-demo', ['*:*:*']); // User is superadmin
    this.actorCapabilities.set('user-frontend', ['*:*:*']); // Frontend is superadmin
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
      'process:read'
    ]);
    this.actorCapabilities.set('teacher-demo', ['lesson:write', 'lesson:read']);
    this.actorCapabilities.set('student-demo', ['student:write']);
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
    const isAdmin = actorId === 'role:administrator' || 
                    actorId?.endsWith(':administrator') || 
                    actorId === 'admin-demo';
    if (isAdmin) return true;

    const caps = this.actorCapabilities.get(actorId) || [];
    // Superadmin bypass
    if (caps.includes('*:*:*') || caps.includes('*')) return true;
    // Direct match
    if (caps.includes(requiredCap)) return true;
    
    // Partial wildcard: e.g. lesson:* matches lesson:write
    const [reqRes, reqAct] = requiredCap.split(':');
    return caps.some(c => {
       const [res, act] = c.split(':');
       return (res === reqRes || res === '*') && (act === reqAct || act === '*');
    });
  }
}
