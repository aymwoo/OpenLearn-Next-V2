import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const build = async () => {
  const manifest = {
    id: "ext-grading-assistant",
    name: "AI Classroom Grading Assistant (课堂AI作业小助手)",
    version: "1.0.0",
    description: "自动监听学生提交的课件作业，利用内置 AI 服务生成评分和评语，并自动提交给教师进行审核确认。",
    author: "Antigravity Team",
    capabilitiesProposed: ["whiteboard:write", "management:write"]
  };

  const code = `exports.default = {
  manifest: ${JSON.stringify(manifest, null, 2)},
  activate: async (ctx) => {
    ctx.console.log("AI Grading Assistant activated.");

    ctx.eventBus.subscribe('courseware.attempt_submitted', async (event) => {
      const payload = event.payload || {};
      const attemptId = payload.attemptId;
      const score = payload.score;
      const comment = payload.comment;

      ctx.console.log(\`Received attempt \${attemptId} with score \${score}\`);

      // If it's already graded or finalized, don't run AI
      if (score !== undefined && score !== null && score > 0) {
        ctx.console.log(\`Attempt \${attemptId} already has a score of \${score}, skipping AI grading.\`);
        return;
      }

      try {
        const prompt = \`Student submitted a lesson attempt with ID: \${attemptId}.
Please write a short friendly, encouraging score and feedback.
Format:
{
  "score": 90,
  "feedback": "Great job on completing the lesson! Your progress shows high consistency."
}\`;

        ctx.console.log("Generating AI grading recommendation...");
        const aiResultRaw = await ctx.ai.generateText(prompt, {
          systemInstruction: "You are an AI teaching assistant. Return a raw JSON string.",
          temperature: 0.3
        });

        ctx.console.log(\`AI result: \${aiResultRaw}\`);
        
        let result = { score: 90, feedback: "答得很棒，请继续保持！" };
        try {
          const cleanJson = aiResultRaw.replace(/\\\`\\\`\\\`json/g, '').replace(/\\\`\\\`\\\`/g, '').trim();
          result = JSON.parse(cleanJson);
        } catch (e) {
          ctx.console.error("Failed to parse AI JSON, using fallback feedback");
        }

        const command = ctx.commandBus.createCommand('ai.apply_grade', {
          attemptId: attemptId,
          score: result.score,
          feedback: result.feedback
        });

        await ctx.commandBus.execute(command);
        ctx.console.log(\`AI Grading approval submitted for attempt \${attemptId} with score \${result.score}\`);
      } catch (err) {
        ctx.console.error(\`Error in AI grading: \${err.message}\`);
      }
    });
  }
};`;

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('index.js', code);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outputPath = path.join(distDir, 'ext-grading-assistant.zip');
  fs.writeFileSync(outputPath, buffer);
  console.log(`Successfully built zip plugin at ${outputPath}`);
};

build().catch(console.error);
