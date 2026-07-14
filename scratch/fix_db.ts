import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('/home/wuxf/Develop/openlearnv2/packages/core/db/educational_os.db');
console.log('Connecting to database:', dbPath);
const db = new Database(dbPath);

try {
  const pluginId = '019f3bd3-901c-77e3-a8be-70a4c5c95983';
  console.log('Updating plugin execution_mode to worker...');
  const res = db.prepare("UPDATE plugins SET execution_mode = 'worker' WHERE id = ?").run(pluginId);
  console.log('Update result:', res);
  
  const row = db.prepare("SELECT id, name, execution_mode, status FROM plugins WHERE id = ?").get(pluginId);
  console.log('Updated row info:', row);
} catch (err) {
  console.error(err);
} finally {
  db.close();
}
