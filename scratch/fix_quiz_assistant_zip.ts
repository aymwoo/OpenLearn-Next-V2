import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';

const dbPath = path.resolve('/home/wuxf/Develop/openlearnv2/packages/core/db/educational_os.db');
const pluginDir = '/home/wuxf/Develop/openlearnv2/plugins/019eefc2-5738-746d-9765-16052ea95dae';
const pluginId = '019eefc2-5738-746d-9765-16052ea95dae';

async function main() {
  console.log('Packaging plugin...');
  const zip = new JSZip();
  zip.file('index.js', fs.readFileSync(path.join(pluginDir, 'index.js')));
  zip.file('manifest.json', fs.readFileSync(path.join(pluginDir, 'manifest.json')));
  
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  console.log('Zip buffer size:', zipBuffer.length);
  
  const db = new Database(dbPath);
  try {
    const res = db.prepare('UPDATE plugins SET zip_package = ? WHERE id = ?').run(zipBuffer, pluginId);
    console.log('Update result:', res);
  } finally {
    db.close();
  }
}

main().catch(console.error);
