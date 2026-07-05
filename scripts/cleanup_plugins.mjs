import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const dbPath = path.resolve('packages/core/db/educational_os.db');
const pluginsDir = path.resolve('plugins');

console.log('Using database:', dbPath);
console.log('Scanning plugins directory:', pluginsDir);

if (!fs.existsSync(dbPath)) {
  console.error('Database file does not exist!');
  process.exit(1);
}

if (!fs.existsSync(pluginsDir)) {
  console.error('Plugins directory does not exist!');
  process.exit(1);
}

const db = new Database(dbPath);

// Clear any inactive/non-core plugins from the database first
console.log('Cleaning inactive non-core plugin entries from the database...');
db.prepare("DELETE FROM plugins WHERE id NOT LIKE '@openlearn/%' AND status != 'active'").run();

// Query all currently registered plugin IDs from database
const rows = db.prepare('SELECT id, file_path FROM plugins').all();
const registeredIds = new Set(rows.map(r => r.id));

console.log('Registered plugins in DB:', Array.from(registeredIds));

const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
let deletedCount = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  
  const dirName = entry.name;
  
  // Skip core namespace
  if (dirName === '@openlearn') {
    continue;
  }
  
  // If the directory name is not in registeredIds, it is an orphan (likely from tests) and can be deleted safely
  if (!registeredIds.has(dirName)) {
    const fullPath = path.join(pluginsDir, dirName);
    console.log(`Deleting orphaned plugin folder: ${dirName}`);
    fs.rmSync(fullPath, { recursive: true, force: true });
    deletedCount++;
  }
}

console.log(`Cleanup complete. Deleted ${deletedCount} orphaned directories.`);
db.close();
