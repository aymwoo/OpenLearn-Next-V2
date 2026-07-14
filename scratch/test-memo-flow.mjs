import fs from 'fs';
import path from 'path';

const PORT = 9000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function run() {
  console.log('=== Starting Plugin Integration Test ===');

  // 1. Login as teacher (admin/admin)
  console.log('\n[1/6] Logging in as teacher (admin/admin)...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entrance: 'teacher',
      username: 'admin',
      password: 'admin'
    })
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
  }

  const loginData = await loginRes.json();
  console.log('Login successful! Role:', loginData.session.role);

  // Extract session cookie
  const setCookieHeader = loginRes.headers.get('set-cookie');
  if (!setCookieHeader) {
    throw new Error('No Set-Cookie header returned from login');
  }
  const sessionCookie = setCookieHeader.split(';')[0];
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': sessionCookie
  };

  // 2. Read ZIP and upload plugin
  console.log('\n[2/6] Reading and uploading ext-memo.zip...');
  const zipPath = path.resolve('dist/plugins/ext-memo.zip');
  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP file not found at ${zipPath}. Run build-plugins script first.`);
  }

  const zipBuffer = fs.readFileSync(zipPath);
  const base64Data = zipBuffer.toString('base64');

  const uploadRes = await fetch(`${BASE_URL}/api/plugins/upload-zip`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      filename: 'ext-memo.zip',
      base64Data: `data:application/zip;base64,${base64Data}`
    })
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${await uploadRes.text()}`);
  }

  const uploadData = await uploadRes.json();
  console.log('Plugin uploaded successfully! Manifest ID:', uploadData.manifest.id);

  // 3. Find the newly uploaded plugin UUID and toggle it active
  console.log('\n[3/6] Fetching plugin list to find UUID...');
  const pluginsRes = await fetch(`${BASE_URL}/api/plugins`, { headers });
  if (!pluginsRes.ok) {
    throw new Error(`Failed to list plugins: ${await pluginsRes.text()}`);
  }

  const pluginsList = await pluginsRes.json();
  const memoPlugin = pluginsList.find(p => p.name === '便签助手插件' || p.id === 'ext-memo');
  if (!memoPlugin) {
    throw new Error('Could not find the uploaded "便签助手插件" in plugin list.');
  }

  const pluginUuid = memoPlugin.id;
  console.log(`Found plugin database UUID: ${pluginUuid}. Current state: ${memoPlugin.state}`);

  if (memoPlugin.state !== 'ACTIVE') {
    console.log(`Toggling plugin state to active...`);
    const toggleRes = await fetch(`${BASE_URL}/api/plugins/${pluginUuid}/toggle`, {
      method: 'POST',
      headers
    });
    if (!toggleRes.ok) {
      throw new Error(`Failed to toggle plugin: ${await toggleRes.text()}`);
    }
    const toggleResult = await toggleRes.json();
    console.log(`Plugin toggle complete. New status: ${toggleResult.status}`);
  } else {
    console.log('Plugin is already active.');
  }

  // 4. Retrieve or Create a Lesson
  console.log('\n[4/6] Retrieving or creating a lesson...');
  const lessonsRes = await fetch(`${BASE_URL}/api/lessons`, { headers });
  if (!lessonsRes.ok) {
    throw new Error(`Failed to list lessons: ${await lessonsRes.text()}`);
  }
  let lessons = await lessonsRes.json();
  let lessonId;

  if (lessons && lessons.length > 0) {
    lessonId = lessons[0].id;
    console.log(`Using existing lesson: ${lessons[0].name} (ID: ${lessonId})`);
  } else {
    console.log('No existing lessons. Creating a new test lesson...');
    const createRes = await fetch(`${BASE_URL}/api/lessons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: '插件测试课堂',
        subject: 'Computer Science',
        classId: 'class_demo' // assume a class exists or fallback
      })
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create lesson: ${await createRes.text()}`);
    }
    const createData = await createRes.json();
    lessonId = createData.result?.id || createData.id;
    console.log(`Created new lesson (ID: ${lessonId})`);
  }

  // 5. Execute custom command 'memo.create'
  console.log(`\n[5/6] Executing custom plugin command "memo.create"...`);
  const memoText = `测试便签: 我们使用 codegraph 审查了插件系统, 编写并启用了 ext-memo 插件! 时间: ${new Date().toLocaleTimeString()}`;
  const cmdRes = await fetch(`${BASE_URL}/api/commands`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commandType: 'memo.create',
      payload: {
        lessonId,
        text: memoText,
        color: '#fef08a' // yellow
      }
    })
  });

  if (!cmdRes.ok) {
    throw new Error(`Command execution failed: ${await cmdRes.text()}`);
  }

  const cmdData = await cmdRes.json();
  console.log('Command execution success! Result:', cmdData);

  // 6. Verify whiteboard elements
  console.log('\n[6/6] Verifying whiteboard elements...');
  const wbRes = await fetch(`${BASE_URL}/api/lessons/${lessonId}/whiteboard`, { headers });
  if (!wbRes.ok) {
    throw new Error(`Failed to fetch whiteboard: ${await wbRes.text()}`);
  }

  const wbElements = await wbRes.json();
  const matchedText = wbElements.find(el => {
    try {
      const data = JSON.parse(el.data);
      return el.type === 'text' && data.text === memoText;
    } catch {
      return false;
    }
  });

  const matchedRect = wbElements.find(el => el.type === 'rectangle' && el.id === cmdData.result?.rectElementId);

  if (matchedText) {
    console.log('\n🎉 SUCCESS! Text element found on the whiteboard:');
    console.log(`  - Text Content: "${JSON.parse(matchedText.data).text}"`);
    console.log(`  - Element ID: ${matchedText.id}`);
  } else {
    console.warn('\n❌ WARNING: Text element NOT found on whiteboard!');
  }

  if (matchedRect) {
    console.log('🎉 SUCCESS! Background rectangle element found on the whiteboard:');
    console.log(`  - Fill Color: ${JSON.parse(matchedRect.data).fill}`);
    console.log(`  - Element ID: ${matchedRect.id}`);
  } else {
    console.warn('❌ WARNING: Rectangle element NOT found on whiteboard!');
  }

  console.log('\n=== Test Completed Successfully ===');
}

run().catch(err => {
  console.error('\n=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
