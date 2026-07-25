import path from 'path';
import crypto from 'crypto';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken } from '../middleware/auth.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';

export function validateMagicBytes(buffer: Buffer, fileName: string): boolean {
  const MAGIC_BYTES: Record<string, number[][]> = {
    '.pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
    '.pptx': [[0x50, 0x4b, 0x03, 0x04]], // PK.. (ZIP)
    '.zip': [[0x50, 0x4b, 0x03, 0x04]],
    '.jpg': [[0xff, 0xd8, 0xff]],
    '.jpeg': [[0xff, 0xd8, 0xff]],
    '.png': [[0x89, 0x50, 0x4e, 0x47]], // .PNG
    '.gif': [[0x47, 0x49, 0x46, 0x38]], // GIF8
    '.webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF
  };
  const ext = path.extname(fileName || '').toLowerCase();
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return true; // 未知类型放过

  return signatures.some(sig =>
    sig.every((byte, i) => buffer[i] === byte)
  );
}
export const BLOCKED_EXTENSIONS = ['.exe', '.sh', '.bat', '.cmd', '.dll', '.so', '.dylib', '.scr', '.msi', '.ps1'];
export function injectLmsSdk(htmlContent: string, req: any, cwInfo: { id: string, name: string, uuid: string }) {
  const token = getCookieToken(req);
  let studentInfo = {
    student_id: 'guest',
    student_name: 'Guest Student',
    class_id: '',
    attempt_id: 'guest-attempt'
  };

  if (token) {
    const sessionRow = kernelContainer.db.prepare('SELECT * FROM client_sessions WHERE id = ?').get(token) as any;
    if (sessionRow) {
      const session = JSON.parse(sessionRow.session_data);
      if (session.role === 'student') {
        const classRow = kernelContainer.db.prepare('SELECT class_id FROM class_students WHERE student_id = ? LIMIT 1').get(session.studentId) as any;
        
        let attempt = kernelContainer.db.prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
          .get(cwInfo.id, session.studentId, 'active') as any;
        
        if (!attempt) {
          const attemptId = 'att_' + crypto.randomBytes(8).toString('hex');
          kernelContainer.db.prepare('INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)')
            .run(attemptId, cwInfo.id, session.studentId, Date.now(), 'active');
          attempt = { id: attemptId };
        }

        studentInfo = {
          student_id: session.studentId,
          student_name: session.name,
          class_id: classRow ? classRow.class_id : '',
          attempt_id: attempt.id
        };
      } else if (session.role === 'teacher' || session.role === 'administrator') {
        let attempt = kernelContainer.db.prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
          .get(cwInfo.id, 'teacher', 'active') as any;
        
        if (!attempt) {
          const attemptId = 'att_teacher_' + crypto.randomBytes(8).toString('hex');
          kernelContainer.db.prepare('INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)')
            .run(attemptId, cwInfo.id, 'teacher', Date.now(), 'active');
          attempt = { id: attemptId };
        }

        studentInfo = {
          student_id: session.userId || 'teacher',
          student_name: (session.name || 'Teacher') + ' (Test)',
          class_id: '',
          attempt_id: attempt.id
        };
      }
    }
  }

  if (studentInfo.attempt_id === 'guest-attempt') {
    let attempt = kernelContainer.db.prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
      .get(cwInfo.id, 'guest', 'active') as any;
    
    if (!attempt) {
      const attemptId = 'att_guest_' + crypto.randomBytes(8).toString('hex');
      kernelContainer.db.prepare('INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)')
        .run(attemptId, cwInfo.id, 'guest', Date.now(), 'active');
      attempt = { id: attemptId };
    }
    studentInfo.attempt_id = attempt.id;
  }

  const injection = `
<!-- LMS Courseware SDK Inject -->
<script>
window.__LMS_STUDENT__ = ${JSON.stringify(studentInfo)};
window.__LMS_COURSEWARE__ = {
  uuid: ${JSON.stringify(cwInfo.uuid)},
  name: ${JSON.stringify(cwInfo.name)}
};
</script>
<script>${BRIDGE_SDK_CODE}</script>
`;

  let html = htmlContent;
  // Strip out the external frog-sdk.js and init-frog.js scripts that crash inside strict sandboxed iframe
  html = html.replace(/<script[^>]*src="[^"]*frog-sdk\.js"[^>]*><\/script>/gi, '<!-- Removed frog-sdk.js to prevent sandboxed iframe crash -->');
  html = html.replace(/<script[^>]*src='[^']*frog-sdk\.js'[^>]*><\/script>/gi, '<!-- Removed frog-sdk.js to prevent sandboxed iframe crash -->');
  html = html.replace(/<script[^>]*src="[^"]*init-frog\.js"[^>]*><\/script>/gi, '<!-- Removed init-frog.js to prevent sandboxed iframe crash -->');
  html = html.replace(/<script[^>]*src='[^']*init-frog\.js'[^>]*><\/script>/gi, '<!-- Removed init-frog.js to prevent sandboxed iframe crash -->');

  if (html.toLowerCase().includes('<head>')) {
    html = html.replace(/<head>/i, `<head>${injection}`);
  } else if (html.toLowerCase().includes('<html>')) {
    html = html.replace(/<html>/i, `<html><head>${injection}</head>`);
  } else {
    html = injection + html;
  }
  return html;
}
export const generateStudentNumber = (db: any): string => {
  const rows = db.prepare('SELECT student_number FROM students WHERE student_number LIKE "S%"').all() as { student_number: string }[];
  let maxSeq = 0;
  for (const row of rows) {
    const numStr = row.student_number || '';
    if (numStr.startsWith('S')) {
      const seqStr = numStr.substring(1);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `S${nextSeq.toString().padStart(3, '0')}`;
};

