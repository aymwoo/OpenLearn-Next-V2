import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve('/home/wuxf/Develop/openlearnv2/packages/core/db/educational_os.db');
const pluginSourceDir = '/home/wuxf/Develop/openlearnv2/v2_plugins/ext-homework-hub';

async function main() {
  console.log('Querying active Homework Hub plugin ID...');
  const db = new Database(dbPath);
  let pluginId = '';
  
  try {
    const row = db.prepare("SELECT id FROM plugins WHERE name = '作业中心' AND status = 'active' LIMIT 1").get() as { id: string } | undefined;
    if (!row) {
      // Fallback to active by manifest ID check
      const rows = db.prepare("SELECT id, manifest FROM plugins WHERE status = 'active'").all() as Array<{ id: string, manifest: string }>;
      const found = rows.find(r => {
        try {
          const m = JSON.parse(r.manifest);
          return m.id === 'ext-homework-hub';
        } catch {
          return false;
        }
      });
      if (found) {
        pluginId = found.id;
      } else {
        throw new Error("Could not find any active Homework Hub plugin in the database!");
      }
    } else {
      pluginId = row.id;
    }
    
    console.log(`Found active plugin ID: ${pluginId}`);
    const pluginTargetDir = path.join('/home/wuxf/Develop/openlearnv2/plugins', pluginId);

    const manifestContent = fs.readFileSync(path.join(pluginSourceDir, 'manifest.json'), 'utf8');
    const zipBuffer = fs.readFileSync(path.join(pluginSourceDir, 'ext-homework-hub.zip'));
    
    // Parse manifest to format it properly (as a single line string to avoid any issues)
    const parsedManifest = JSON.parse(manifestContent);
    // Keep the ID mapping
    parsedManifest.id = pluginId;
    const manifestStr = JSON.stringify(parsedManifest);
    
    const res = db.prepare('UPDATE plugins SET manifest = ?, zip_package = ? WHERE id = ?').run(
      manifestStr,
      zipBuffer,
      pluginId
    );
    console.log('DB Update result:', res);

    // Also update active directory files on disk
    console.log('Updating files in active plugin directory on disk:', pluginTargetDir);
    if (!fs.existsSync(pluginTargetDir)) {
      fs.mkdirSync(pluginTargetDir, { recursive: true });
    }
    
    fs.copyFileSync(
      path.join(pluginSourceDir, 'index.js'),
      path.join(pluginTargetDir, 'index.js')
    );
    
    fs.copyFileSync(
      path.join(pluginSourceDir, 'frontend.js'),
      path.join(pluginTargetDir, 'frontend.js')
    );
    
    console.log('Update complete!');
  } finally {
    db.close();
  }
}

main().catch(console.error);
