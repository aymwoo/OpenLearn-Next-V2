import Database from 'better-sqlite3';
import path from 'path';

async function run() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  const db = new Database(dbPath);

  const rows = db.prepare('SELECT id, session_data FROM client_sessions').all() as Array<{ id: string; session_data: string }>;
  let token: string | undefined;

  for (const row of rows) {
    try {
      const data = JSON.parse(row.session_data);
      if (data.role === 'teacher' || data.role === 'administrator' || data.username === 'admin') {
        token = row.id;
        break;
      }
    } catch {}
  }

  if (!token) {
    console.log('No admin session found in database! Creating one...');
    token = 'mock_admin_token_' + Math.random().toString(36).slice(2);
    const sessionData = JSON.stringify({
      userId: 'usr_admin',
      username: 'admin',
      role: 'administrator'
    });
    db.prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, sessionData, Date.now(), Date.now() + 3600000);
    console.log('Created admin session token:', token);
  } else {
    console.log('Found admin token:', token);
  }

  const res = await fetch('http://localhost:9000/api/admin/logs?limit=5', {
    headers: {
      'Cookie': `edu_os_token=${token}`
    }
  });

  const data = await res.json();
  console.log('API Response Status:', res.status);
  console.log('API Response Data:', JSON.stringify(data, null, 2));

  db.close();
}

run().catch(console.error);
