import { ToolRegistry } from '../registry';
import { loadKeys } from '../../config/keys';

async function generateImage(args: Record<string, any>): Promise<string> {
  const prompt = args.prompt || '';
  if (!prompt) throw new Error('prompt is required');

  const keys = loadKeys();
  const apiKey = keys.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not configured. Set it in Settings > API Matrix.');

  const size = args.size || '1024*1024';
  const n = Math.min(args.n || 1, 4);

  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: 'wan2.1-t2i-large',
      input: { prompt },
      parameters: { size, n },
    }),
  });

  const data = await response.json() as any;
  if (data.code) {
    throw new Error(`DashScope image error (${data.code}): ${data.message}`);
  }

  const taskId = data.output?.task_id;
  if (!taskId) throw new Error('No task_id returned');

  // Poll up to 60 seconds
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const pollRes = await fetch(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } },
    );
    const pollData = await pollRes.json() as any;
    if (pollData.output?.task_status === 'SUCCEEDED') {
      const results = pollData.output.results || [];
      const urls = results.map((r: any) => r.url).filter(Boolean);
      if (urls.length === 0) throw new Error('Image generation completed but no URLs returned');

      return JSON.stringify({
        success: true,
        prompt,
        images: urls,
        taskId,
        tip: `Generated ${urls.length} image(s). Tell the user the images are ready and offer to save them to their Pictures folder.`,
      });
    }
    if (pollData.output?.task_status === 'FAILED') {
      throw new Error(`Image generation failed: ${pollData.output.message || 'unknown error'}`);
    }
  }
  throw new Error('Image generation timed out (60s). Task: ' + taskId);
}

export function registerImageTools(registry: ToolRegistry): void {
  registry.register({
    name: 'generate_image',
    description: 'Generate images using AI (DashScope Wan2.1). Describe what you want to draw — supports styles like "oil painting", "anime", "photorealistic", "Ghibli style", etc. Returns image URLs.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image description in English or Chinese. Be detailed about subject, style, lighting, composition.' },
        size: { type: 'string', description: 'Image size, e.g. "1024*1024", "720*1280", "1280*720"' },
        n: { type: 'number', description: 'Number of images to generate (1-4, default 1)' },
      },
      required: ['prompt'],
    },
    handler: generateImage,
    permission: 'user',
    securityLevel: 'safe',
  });
}
