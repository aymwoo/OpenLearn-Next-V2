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
    // Try to find by name or by manifest ID
    let row = db.prepare("SELECT id FROM plugins WHERE name = '作业中心' LIMIT 1").get() as { id: string } | undefined;
    if (!row) {
      const rows = db.prepare("SELECT id, manifest FROM plugins").all() as Array<{ id: string, manifest: string }>;
      const found = rows.find(r => {
        try {
          const m = JSON.parse(r.manifest);
          return m.id === 'ext-homework-hub';
        } catch {
          return false;
        }
      });
      if (found) {
        row = found;
      }
    }

    if (row) {
      pluginId = row.id;
      console.log(`Found existing plugin ID: ${pluginId}`);
    } else {
      pluginId = '019f5ac3-fc32-74a5-addf-01689c9dde18';
      console.log(`Plugin not found in DB. Creating new plugin entry with ID: ${pluginId}`);
    }
    
    const pluginTargetDir = path.join('/home/wuxf/Develop/openlearnv2/plugins', pluginId);

    const manifestContent = fs.readFileSync(path.join(pluginSourceDir, 'manifest.json'), 'utf8');
    const zipBuffer = fs.readFileSync(path.join(pluginSourceDir, 'ext-homework-hub.zip'));
    
    const parsedManifest = JSON.parse(manifestContent);
    // Keep the ID mapping
    parsedManifest.id = pluginId;
    const manifestStr = JSON.stringify(parsedManifest);
    const filePath = path.join(pluginTargetDir, 'index.js');
    
    const exists = db.prepare("SELECT id FROM plugins WHERE id = ?").get(pluginId);
    if (exists) {
      const res = db.prepare('UPDATE plugins SET manifest = ?, zip_package = ?, file_path = ?, status = ?, execution_mode = ?, loader_version = ? WHERE id = ?').run(
        manifestStr,
        zipBuffer,
        filePath,
        'active',
        'worker',
        'esm',
        pluginId
      );
      console.log('DB Update result:', res);
    } else {
      const res = db.prepare('INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode, zip_package) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        pluginId,
        '作业中心',
        manifestStr,
        '',
        filePath,
        'active',
        Date.now(),
        'esm',
        'worker',
        zipBuffer
      );
      console.log('DB Insert result:', res);
    }

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
