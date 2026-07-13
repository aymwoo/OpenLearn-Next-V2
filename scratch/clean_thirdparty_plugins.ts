import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve('/home/wuxf/Develop/openlearnv2/packages/core/db/educational_os.db');
const pluginsDir = '/home/wuxf/Develop/openlearnv2/plugins';

async function main() {
  const db = new Database(dbPath);
  
  // 找出所有非 @openlearn/ 开头的插件（第三方插件）
  const allPlugins = db.prepare('SELECT id, name, manifest FROM plugins').all() as Array<{ id: string; name: string; manifest: string }>;
  const thirdparty = allPlugins.filter(p => !p.id.startsWith('@openlearn/'));

  console.log(`Found ${thirdparty.length} third-party plugins in database.`);

  for (const p of thirdparty) {
    console.log(`\nUninstalling third-party plugin: "${p.name}" (ID: ${p.id})`);
    
    let manifestId = p.id;
    try {
      const m = JSON.parse(p.manifest);
      if (m.id) manifestId = m.id;
    } catch {}

    // 1. 从 plugins 中删除
    db.prepare('DELETE FROM plugins WHERE id = ?').run(p.id);
    console.log(`- Deleted plugin registry from DB.`);

    // 2. 从 plugin_storage 中删除
    db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(manifestId);
    console.log(`- Deleted plugin storage config from DB.`);

    // 3. 清理插件自建表
    const tablePrefix = `plugin_${p.id.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
    try {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`)
        .all(tablePrefix + '%') as { name: string }[];
      for (const t of tables) {
        db.exec(`DROP TABLE IF EXISTS ${t.name}`);
      }
      if (tables.length > 0) {
        console.log(`- Dropped ${tables.length} plugin tables.`);
      }
    } catch (e: any) {
      console.warn(`- Failed to drop plugin tables:`, e.message);
    }

    // 4. 清理磁盘文件
    const pluginDir = path.join(pluginsDir, p.id);
    if (fs.existsSync(pluginDir)) {
      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });
        console.log(`- Removed plugin directory from disk: ${pluginDir}`);
      } catch (e: any) {
        console.warn(`- Failed to remove plugin directory:`, e.message);
      }
    }
  }

  db.close();
  console.log('\nAll third-party plugins cleared successfully!');
}

main().catch(console.error);
