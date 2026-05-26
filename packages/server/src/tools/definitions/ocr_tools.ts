import { ToolRegistry } from '../registry';
import { analyzeScreen } from '../../llm/adapter';

async function ocrScreen(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) {
    throw new Error('OCR tools require the Tauri desktop app');
  }
  const query = args.query || args.prompt || 'Describe what is visible on the screen in detail. Include all text, UI elements, error messages, and anything the user might need to know.';
  const base64 = await context.desktopRelay('desktop_capture_screen', { quality: 70 });

  // Resolve vision-capable provider
  const g = context?.llmGetters || {};
  const provider = g.getOpenAI?.() ? 'openai' : g.getGemini?.() ? 'gemini' : g.getQwen?.() ? 'qwen' : null;
  if (!provider) {
    // No vision model available — return raw base64 so the LLM can at least pass it to vision if available
    return JSON.stringify({ format: 'screenshot_base64', data: base64, note: 'No vision-capable model key configured (OpenAI/Gemini/Qwen). Provide the key in Settings → Voice Services.' });
  }

  try {
    const description = await analyzeScreen(base64, query, { provider, model: provider === 'openai' ? 'gpt-4o' : provider === 'gemini' ? 'gemini-2.0-flash' : 'qwen-vl-max' }, g.getDeepSeek, g.getGemini, g.getOpenAI, g.getAnthropic, g.getQwen);
    return description;
  } catch (err: any) {
    // Fallback: return base64 so caller can try
    return JSON.stringify({ format: 'screenshot_base64', data: base64, error: err.message });
  }
}

async function ocrRegion(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) {
    throw new Error('OCR tools require the Tauri desktop app');
  }
  const { x, y, width, height } = args;
  const query = args.query || args.prompt || `Describe what is visible in the screen region at (${x}, ${y}, ${width}x${height}). Include all text and UI details.`;
  const base64 = await context.desktopRelay('desktop_capture_screen', { quality: 70 });

  const g = context?.llmGetters || {};
  const provider = g.getOpenAI?.() ? 'openai' : g.getGemini?.() ? 'gemini' : g.getQwen?.() ? 'qwen' : null;
  if (!provider) {
    return JSON.stringify({ format: 'screenshot_base64', data: base64, note: 'No vision-capable model key configured.' });
  }

  try {
    const description = await analyzeScreen(base64, query, { provider, model: provider === 'openai' ? 'gpt-4o' : provider === 'gemini' ? 'gemini-2.0-flash' : 'qwen-vl-max' }, g.getDeepSeek, g.getGemini, g.getOpenAI, g.getAnthropic, g.getQwen);
    return description;
  } catch (err: any) {
    return JSON.stringify({ format: 'screenshot_base64', data: base64, error: err.message });
  }
}

export function registerOCRTools(registry: ToolRegistry): void {
  registry.register({
    name: 'ocr_screen',
    description:
      'Capture a screenshot of the user\'s screen and analyze it with a vision AI model. Returns a text description of what is visible — including text, UI elements, error messages, and code. Use this when the user asks "what\'s on my screen?", "read this error", "look at this", or when you need to see what the user is working on.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for or analyze in the screenshot. E.g., "Read all text visible on screen", "What error message is shown?", "Describe this UI".' },
      },
      required: [],
    },
    handler: ocrScreen,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'ocr_region',
    description:
      'Capture a specific region of the user\'s screen and analyze it with vision AI. Specify x, y, width, height in pixels plus what to look for. For reading dialog boxes, error messages, or specific UI elements.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Left edge in pixels' },
        y: { type: 'number', description: 'Top edge in pixels' },
        width: { type: 'number', description: 'Region width in pixels' },
        height: { type: 'number', description: 'Region height in pixels' },
        query: { type: 'string', description: 'What to analyze in this region.' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
    handler: ocrRegion,
    permission: 'user',
    securityLevel: 'safe',
  });
}
