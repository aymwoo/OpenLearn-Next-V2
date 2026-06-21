import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve db path
let dbPath = path.resolve(__dirname, '../packages/core/db/educational_os.db');
if (!fs.existsSync(dbPath)) {
  dbPath = '/root/OpenLearn-Next-V2/packages/core/db/educational_os.db';
}

if (fs.existsSync(dbPath)) {
  console.log(`Updating database at: ${dbPath}`);
  const db = new Database(dbPath);
  try {
    const updateStmt = db.prepare("UPDATE mfe_remotes SET entry = ? WHERE name = ?");
    updateStmt.run('/mfe/whiteboard/remoteEntry.js', 'mfe_whiteboard');
    updateStmt.run('/mfe/courseware/remoteEntry.js', 'mfe_courseware');
    console.log("✅ Successfully updated mfe_remotes entries to relative paths '/mfe/whiteboard/...' and '/mfe/courseware/...'");
  } catch (err) {
    console.error("❌ Failed to update database:", err.message);
  } finally {
    db.close();
  }
} else {
  console.error(`❌ SQLite database file not found at: ${dbPath}`);
  process.exit(1);
}
