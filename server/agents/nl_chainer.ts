/**
 * Natural Language Task Chainer
 *
 * "帮我把昨天的会议纪要整理成PPT" → plan → execute tool chain → synthesize response.
 * Plan-first, execute-next — more reliable than iterative tool calling for office workflows.
 */
import { NormalizedMessage, makeLLMCall } from '../llm/providers';
import { toolRegistry } from '../tools/registry';
import { ToolExecutionRecord, ToolContext } from '../tools/types';

export interface ChainerPlan {
  goal: string;
  steps: Array<{
    description: string;        // human-readable description of what this step does
    toolName: string;            // tool to call
    toolArgs: Record<string, any>; // arguments for the tool
    dependsOnOutput?: string;   // how this step uses previous step's output
  }>;
}

export interface ChainerResult {
  plan: ChainerPlan;
  stepResults: Array<{ step: number; tool: string; output: string; success: boolean }>;
  finalResponse: string;
  toolRecords: ToolExecutionRecord[];
}

interface LlmGetters {
  getDeepSeek: () => any;
  getGemini: () => any;
  getOpenAI: () => any;
  getAnthropic: () => any;
  getQwen: () => any;
}

// Map from user intent domain to tool category filters
const DOMAIN_TOOL_HINTS: Record<string, string[]> = {
  office:  ['file_search', 'file_read', 'file_write', 'file_list', 'document_create',
            'document_polish', 'pdf_merge', 'pdf_extract', 'pdf_metadata',
            'create_presentation', 'create_spreadsheet', 'office_create',
            'calendar_add', 'calendar_list',
            'web_search', 'web_fetch', 'fetcher_fetch',
            'translate', 'ocr_image_to_text', 'clipboard_read', 'clipboard_write',
            'notes_create', 'notes_search', 'notes_update',
            'stock_search', 'stock_quote', 'stock_kline', 'market_index', 'stock_news',
            'email_assistant_parse', 'shorturl_create',
            'qrcode_generate', 'weather_get_weather'],
  create:  ['document_create', 'document_polish', 'pdf_merge', 'pdf_extract',
            'create_presentation', 'create_spreadsheet', 'office_create',
            'code_sandbox_execute', 'image_generate',
            'qrcode_generate', 'shorturl_create'],
  search:  ['web_search', 'web_fetch', 'file_search', 'file_list', 'file_read',
            'notes_search', 'stock_search', 'stock_quote', 'market_index', 'stock_news',
            'weather_get_weather', 'fetcher_fetch'],
  file:    ['file_search', 'file_read', 'file_write', 'file_delete', 'file_list',
            'pdf_merge', 'pdf_extract', 'pdf_metadata', 'document_create', 'ocr_image_to_text'],
};

function getDomainHints(userTask: string): string[] | undefined {
  const t = userTask.toLowerCase();
  if (/文件|文档|pdf|ppt|表格|报告|整理|汇总|合并|提取/i.test(t)) return DOMAIN_TOOL_HINTS.file;
  if (/搜索|查询|找|搜|什么|多少|怎么|查/i.test(t)) return DOMAIN_TOOL_HINTS.search;
  if (/创建|制作|做|生成|写|画|新建/i.test(t)) return DOMAIN_TOOL_HINTS.create;
  if (/股票|行情|报价|k线|板块|大盘|涨|跌|股价|财经/i.test(t)) return undefined; // use all tools, stockbot handles it
  if (/邮件|翻译|日历|日程|二维码|短链接|天气|笔记/i.test(t)) return DOMAIN_TOOL_HINTS.office;
  return undefined;
}

// ── Planning phase ──

async function planTask(
  userTask: string,
  availableTools: Array<{ name: string; description: string; parameters: Record<string, any> }>,
  provider: string,
  model: string,
  userId: string,
  llmGetters: LlmGetters,
): Promise<ChainerPlan> {
  const toolListText = availableTools
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  const planPrompt = `You are an office workflow planner. Given the user's task and available tools, produce a step-by-step execution plan.

## Available Tools
${toolListText}

## User Task
${userTask}

## Rules
1. Think about what the user ACTUALLY wants as the end result
2. Break down into the minimum steps needed — don't over-decompose
3. Each step must map to an available tool
4. If you need to search/find something first, plan that as a separate step BEFORE the action
5. If a step depends on a previous step's output, note it in dependsOnOutput
6. For toolArgs, use the EXACT parameter names from the tool descriptions

Output ONLY valid JSON in this format:
{
  "goal": "one-line summary of what we're achieving",
  "steps": [
    {
      "description": "what this step does in plain language",
      "toolName": "exact_tool_name",
      "toolArgs": { "param1": "value1" },
      "dependsOnOutput": "how to use previous step's result, or empty string if independent"
    }
  ]
}`;

  const messages: NormalizedMessage[] = [
    { role: 'user', content: planPrompt },
  ];

  try {
    const result = await makeLLMCall(
      messages,
      [],
      { provider: provider as any, model, userId, maxTokens: 1500 },
      llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
    );

    const text = result.text || '';
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]);
      // Validate structure
      if (!plan.goal || !Array.isArray(plan.steps)) {
        throw new Error('Invalid plan structure');
      }
      return {
        goal: plan.goal,
        steps: plan.steps.map((s: any) => ({
          description: s.description || `Call ${s.toolName}`,
          toolName: s.toolName,
          toolArgs: s.toolArgs || {},
          dependsOnOutput: s.dependsOnOutput || '',
        })),
      };
    }
    throw new Error(`No JSON found in plan response: ${text.slice(0, 200)}`);
  } catch (err: any) {
    // Fallback: create a single-step plan from the task
    console.warn('[NLChainer] Plan fallback:', err.message);
    return {
      goal: userTask,
      steps: [],
    };
  }
}

// ── Execution phase ──

async function executePlan(
  plan: ChainerPlan,
  executeTool: (name: string, args: Record<string, any>) => Promise<string>,
  context?: ToolContext,
  onStep?: (step: number, total: number, description: string) => void,
): Promise<Array<{ step: number; tool: string; output: string; success: boolean }>> {
  const results: Array<{ step: number; tool: string; output: string; success: boolean }> = [];
  let accumulatedContext = '';

  for (let i = 0; i < plan.steps.length; i++) {
    if (context?.isCancelled?.()) break;

    const step = plan.steps[i];
    onStep?.(i + 1, plan.steps.length, step.description);

    // Merge accumulated context into args where relevant
    const enrichedArgs = { ...step.toolArgs };
    if (step.dependsOnOutput && results.length > 0) {
      const lastResult = results[results.length - 1];
      if (lastResult.success) {
        // Inject previous output where the tool likely needs it
        enrichedArgs.context = lastResult.output;
        enrichedArgs.previousOutput = lastResult.output;
        // For tools that need file paths, try to extract from previous output
        const fileMatch = lastResult.output.match(/(?:path|文件|saved to|created|输出)[:\s]+([^\s,，\n]+)/i);
        if (fileMatch && !enrichedArgs.filePath) {
          enrichedArgs.filePath = fileMatch[1];
        }
      }
    }

    try {
      console.log(`[NLChainer] Step ${i + 1}/${plan.steps.length}: ${step.toolName}`, JSON.stringify(enrichedArgs).slice(0, 200));
      const output = await executeTool(step.toolName, enrichedArgs);
      results.push({ step: i + 1, tool: step.toolName, output, success: true });
      accumulatedContext += `\n## Step ${i + 1}: ${step.description}\n${output}\n`;
    } catch (err: any) {
      console.warn(`[NLChainer] Step ${i + 1} failed:`, err.message);
      results.push({ step: i + 1, tool: step.toolName, output: err.message, success: false });
    }
  }

  return results;
}

// ── Synthesis phase ──

async function synthesizeResponse(
  userTask: string,
  plan: ChainerPlan,
  stepResults: Array<{ step: number; tool: string; output: string; success: boolean }>,
  provider: string,
  model: string,
  userId: string,
  llmGetters: LlmGetters,
): Promise<string> {
  const resultsSummary = stepResults
    .map(r => `Step ${r.step} (${r.tool}): ${r.success ? 'OK' : 'FAILED'}\n${r.output.slice(0, 500)}`)
    .join('\n\n');

  const synthPrompt = `You are Lumi, a desktop AI assistant. Synthesize the results of an automated workflow into a natural, helpful response.

## Original Task
${userTask}

## Goal
${plan.goal}

## Execution Results
${resultsSummary}

## Instructions
- Summarize what was accomplished in 1-2 sentences first
- Present key findings/data clearly
- If any step failed, mention it briefly and suggest a workaround
- Use the user's language (Chinese or English, match the task)
- Keep it concise and actionable`;

  const messages: NormalizedMessage[] = [
    { role: 'user', content: synthPrompt },
  ];

  try {
    const result = await makeLLMCall(
      messages,
      [],
      { provider: provider as any, model, userId, maxTokens: 1000 },
      llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
    );
    return result.text || buildSimpleSummary(stepResults);
  } catch {
    return buildSimpleSummary(stepResults);
  }
}

function buildSimpleSummary(results: Array<{ step: number; tool: string; output: string; success: boolean }>): string {
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  let summary = `完成 ${successes.length}/${results.length} 个步骤。\n\n`;
  for (const r of successes) {
    summary += `✓ ${r.output.slice(0, 200)}\n`;
  }
  for (const r of failures) {
    summary += `✗ 步骤 ${r.step} (${r.tool}) 失败: ${r.output.slice(0, 100)}\n`;
  }
  return summary;
}

// ── Main entry point ──

export async function runNLChainer(
  userTask: string,
  config: {
    userId: string;
    provider: string;
    model: string;
    desktopRelay?: (tool: string, args: Record<string, any>) => Promise<string>;
    context?: ToolContext;
  },
  llmGetters: LlmGetters,
  onStep?: (step: number, total: number, description: string) => void,
): Promise<ChainerResult> {
  const allTools = toolRegistry.getToolDeclarations();
  const domainHints = getDomainHints(userTask);

  // Filter tools: if domain hints are available, prioritize those tools
  let availableDecls = allTools;
  if (domainHints) {
    const hintSet = new Set(domainHints);
    const filtered = allTools.filter(t => hintSet.has(t.function.name));
    if (filtered.length > 0) {
      // Include non-filtered tools that are always useful (like desktop tools)
      const alwaysUseful = allTools.filter(t =>
        /^desktop_|^computer_|^clipboard_/.test(t.function.name)
      );
      const allFiltered = [...filtered, ...alwaysUseful];
      // Deduplicate
      const seen = new Set<string>();
      availableDecls = allFiltered.filter(t => {
        if (seen.has(t.function.name)) return false;
        seen.add(t.function.name);
        return true;
      });
    }
  }

  // Unwrap from tool declaration format to plain { name, description, parameters }
  const availableTools = availableDecls.map(d => ({
    name: d.function.name,
    description: d.function.description,
    parameters: d.function.parameters,
  }));

  // Phase 1: Plan
  const plan = await planTask(userTask, availableTools, config.provider, config.model, config.userId, llmGetters);

  // If plan failed to produce steps, return empty
  if (plan.steps.length === 0) {
    return {
      plan,
      stepResults: [],
      finalResponse: '',
      toolRecords: [],
    };
  }

  // Phase 2: Execute
  const executeTool = async (name: string, args: Record<string, any>): Promise<string> => {
    // Handle desktop relay tools
    if (config.desktopRelay && /^(desktop_|computer_)/.test(name)) {
      return config.desktopRelay(name, args);
    }
    return toolRegistry.execute(name, args, config.context);
  };

  const stepResults = await executePlan(plan, executeTool, config.context, onStep);

  // Phase 3: Synthesize
  const finalResponse = await synthesizeResponse(
    userTask, plan, stepResults,
    config.provider, config.model, config.userId,
    llmGetters,
  );

  return { plan, stepResults, finalResponse, toolRecords: [] };
}

/**
 * Quick check: is this task suitable for NL chaining?
 * Returns true if the task looks like an office workflow that might need multiple tools.
 */
export function shouldChainTask(userText: string): boolean {
  // Multi-step indicators in Chinese and English
  const chainPatterns = [
    /然后/, /接着/, /之后/, /最后/, /再/, /并且/, /同时/,
    /then\s/, /after\s/, /and\s+also/, /then\s+create/, /then\s+save/,
    // Compound task patterns
    /查.*(?:并|然后|再|→).*/,
    /.*(?:做成|生成|创建|导出|保存为).*/,
    /(?:整理|汇总|合并|对比|分析).*(?:文件|文档|数据|报告)/,
    /.*(?:发|发送|推送|通知).*/,
  ];
  return chainPatterns.some(p => p.test(userText));
}
