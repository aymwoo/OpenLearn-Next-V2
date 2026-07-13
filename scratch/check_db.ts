import Database from 'better-sqlite3';

const dbPath = '/home/wuxf/Develop/openlearnv2/packages/core/db/educational_os.db';
const db = new Database(dbPath);

try {
  const rows = db.prepare('SELECT id, name, manifest, status, loader_version FROM plugins').all();
  console.log('Total plugins in database:', rows.length);
  for (const row of rows) {
    console.log(`- ID: ${row.id}, Name: ${row.name}, Status: ${row.status}, Loader: ${row.loader_version}`);
    try {
      const manifest = JSON.parse(row.manifest);
      console.log(`  Manifest ID: ${manifest.id}, version: ${manifest.version}`);
    } catch (e) {
      console.log(`  Error parsing manifest: ${e.message}`);
    }
  }
} catch (err) {
  console.error('Error querying plugins table:', err);
} finally {
  db.close();
}
