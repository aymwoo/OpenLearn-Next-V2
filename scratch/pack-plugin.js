import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const pluginJsCode = `const gradingAssistantPlugin = {
  manifest: {
    id: "ext-grading-assistant",
    name: "AI 作业自动批改助手",
    description: "自动批改当前班级所有待批阅的学生作业。批改结果将生成待审批高危操作以供教师审核。",
    version: "1.0.0",
    capabilitiesProposed: ["management:read", "management:write"],
    classroomTools: [
      {
        id: "tool-grading-auto",
        name: "AI 批量批改作业",
        icon: "Award",
        description: "对当前班级下所有已提交的作业进行 AI 批量智能批改并生成待审核成绩",
        commandType: "assignment.auto_grade",
        payload: {
          classId: "$classId"
        }
      }
    ]
  },
  activate: async (ctx) => {
    ctx.actionRegistry.register({
      id: 'ext-assignment-auto_grade',
      commandType: 'assignment.auto_grade',
      description: '使用 AI 自动批改本班级下所有待批改的作业',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' }
        },
        required: ['classId']
      }
    });

    ctx.commandBus.registerHandler('assignment.auto_grade', {
      execute: async (command) => {
        const { classId } = command.payload;
        if (!classId) {
          return { success: false, error: 'classId is required' };
        }
        
        console.log(\`[Grading Assistant] Starting batch grading for class \${classId}\`);
        const port = 9000;
        
        try {
          // 1. 获取班级下的所有作业
          const assignmentsRes = await fetch(\`http://127.0.0.1:\${port}/api/classes/\${classId}/assignments\`);
          if (!assignmentsRes.ok) {
            throw new Error(\`Failed to fetch assignments (HTTP \${assignmentsRes.status})\`);
          }
          const assignments = await assignmentsRes.json();
          
          let totalGraded = 0;
          
          for (const assignment of assignments) {
            // 2. 获取该作业的所有学生提交记录
            const submissionsRes = await fetch(\`http://127.0.0.1:\${port}/api/assignments/\${assignment.id}/submissions\`);
            if (!submissionsRes.ok) {
              console.error(\`[Grading Assistant] Failed to fetch submissions for assignment \${assignment.id}\`);
              continue;
            }
            const submissions = await submissionsRes.json();
            
            // 3. 找出所有处于 submitted (待批改) 状态的提交
            const pendingSubmissions = submissions.filter(sub => sub.status === 'submitted');
            
            for (const sub of pendingSubmissions) {
              console.log(\`[Grading Assistant] Auto grading student \${sub.student_id} (\${sub.student_name}) for assignment \${assignment.id}\`);
              
              // 4. 调用系统内置批改服务接口
              const gradeRes = await fetch(\`http://127.0.0.1:\${port}/api/assignments/\${assignment.id}/submissions/\${sub.student_id}/grade\`, {
                method: 'POST'
              });
              
              if (gradeRes.ok) {
                totalGraded++;
              } else {
                console.error(\`[Grading Assistant] Failed to grade submission of student \${sub.student_id} for assignment \${assignment.id}\`);
              }
            }
          }
          
          console.log(\`[Grading Assistant] Batch grading completed. Successfully graded \${totalGraded} submissions.\`);
          return { success: true, gradedCount: totalGraded };
        } catch (error) {
          console.error('[Grading Assistant] Error in batch auto_grade:', error);
          return { success: false, error: error.message };
        }
      }
    });
  }
};
exports.default = gradingAssistantPlugin;
`;

const manifestJson = {
  id: "ext-grading-assistant",
  name: "AI 作业自动批改助手",
  description: "自动批改当前班级所有待批阅的学生作业。批改结果将生成待审批高危操作以供教师审核。",
  version: "1.0.0",
  entry: "index.js"
};

async function pack() {
  const zip = new JSZip();
  zip.file('index.js', pluginJsCode);
  zip.file('manifest.json', JSON.stringify(manifestJson, null, 2));
  
  const content = await zip.generateAsync({ type: 'nodebuffer' });
  const targetDir = '/home/wuxf/Develop/openlearnv2/assets';
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const destPath = path.join(targetDir, 'ext-grading-assistant.zip');
  fs.writeFileSync(destPath, content);
  console.log(`Plugin ZIP generated at: ${destPath}`);
}

pack().catch(console.error);
