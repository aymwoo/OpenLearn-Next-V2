import path from 'node:path';
import fs from 'node:fs';
import { db } from '../packages/core/db/index.js';

try {
  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `backup_${timestamp}.db`);

  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  console.log(`✓ SQLite database successfully backed up to: ${backupPath}`);
} catch (err: any) {
  console.error(`✗ Database backup failed: ${err.message}`);
  process.exit(1);
}
