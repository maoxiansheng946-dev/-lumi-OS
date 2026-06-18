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
  office:  ['search_files', 'read_file', 'write_file', 'list_directory',
            'create_docx', 'create_xlsx',
            'merge_pdf', 'pdf_to_text', 'read_pdf',
            'create_ppt', 'create_pdf',
            'calendar_create', 'calendar_today', 'upcoming_events',
            'web_search', 'url_fetch',
            'translate', 'ocr_screen', 'ocr_region', 'read_clipboard', 'write_clipboard',
            'create_note', 'list_notes',
            'stock_search', 'stock_quote', 'stock_kline', 'market_index', 'stock_news',
            'email_assistant',
            'shorten_url', 'generate_qrcode', 'get_weather'],
  create:  ['create_docx', 'create_xlsx', 'create_ppt', 'create_pdf',
            'merge_pdf', 'pdf_to_text',
            'code_execution', 'generate_image',
            'generate_qrcode', 'shorten_url'],
  search:  ['web_search', 'url_fetch', 'search_files', 'list_directory', 'read_file',
            'list_notes', 'stock_search', 'stock_quote', 'market_index', 'stock_news',
            'get_weather'],
  file:    ['search_files', 'read_file', 'write_file', 'list_directory',
            'merge_pdf', 'pdf_to_text', 'read_pdf',
            'create_docx', 'create_xlsx', 'create_pdf',
            'ocr_screen', 'ocr_region',
            'read_docx', 'read_xlsx', 'extract_document_text'],
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

  const planPrompt = `Tools available:\n${toolListText}\n\nTask: ${userTask}\n\nPlan the minimum steps needed. Use exact tool parameter names. If one step depends on a previous step's output, note it in dependsOnOutput.\n\nOutput JSON:\n{
  "goal": "one-line summary",
  "steps": [{ "description": "...", "toolName": "...", "toolArgs": {}, "dependsOnOutput": "" }]
}
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
  replanFn?: (failedStep: { toolName: string; args: Record<string, any>; error: string }) => Promise<{ toolName: string; args: Record<string, any> } | null>,
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

      let recovered = false;
      if (replanFn) {
        try {
          const alternative = await replanFn({
            toolName: step.toolName,
            args: step.toolArgs,
            error: err.message,
          });
          if (alternative?.toolName) {
            console.log(`[NLChainer] Replan: trying "${alternative.toolName}" instead of "${step.toolName}"`);
            const altOutput = await executeTool(alternative.toolName, { ...enrichedArgs, ...alternative.args });
            results.push({ step: i + 1, tool: alternative.toolName, output: altOutput, success: true });
            accumulatedContext += `\n## Step ${i + 1}: ${step.description} (recovered via ${alternative.toolName})\n${altOutput}\n`;
            recovered = true;
          }
        } catch (replanErr: any) {
          console.warn(`[NLChainer] Replan also failed:`, replanErr.message);
        }
      }

      if (!recovered) {
        results.push({ step: i + 1, tool: step.toolName, output: err.message, success: false });
      }
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

  const synthPrompt = `Summarize the results of this workflow naturally. Mention what was done, present key findings, and flag any failed steps with a suggested workaround. Match the user's language.\n\nTask: ${userTask}\n\nResults:\n${resultsSummary}`;

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
    onTool?: (record: ToolExecutionRecord) => void;
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

  // Dev-only ghost tool detection
  if (process.env.NODE_ENV !== 'production') {
    const registeredNames = new Set(allTools.map(d => d.function.name));
    for (const [domain, hints] of Object.entries(DOMAIN_TOOL_HINTS)) {
      const ghosts = hints.filter(h => !registeredNames.has(h));
      if (ghosts.length > 0) {
        console.warn(`[NLChainer] Ghost tools in DOMAIN_TOOL_HINTS.${domain}:`, ghosts);
      }
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
  const replanFn = async (failedStep: { toolName: string; args: Record<string, any>; error: string }): Promise<{ toolName: string; args: Record<string, any> } | null> => {
    const prompt = `The tool "${failedStep.toolName}" failed with error: ${failedStep.error}
Original args: ${JSON.stringify(failedStep.args)}

Available tools:
${availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Suggest the best alternative tool from the list above to accomplish the same goal. Output JSON:
{ "toolName": "...", "args": {...} }

If no suitable alternative exists, output: { "toolName": "" }`;

    try {
      const result = await makeLLMCall(
        [{ role: 'user', content: prompt }],
        [],
        { provider: config.provider as any, model: config.model, userId: config.userId, maxTokens: 400 },
        llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
      );
      const jsonMatch = result.text?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const alt = JSON.parse(jsonMatch[0]);
        if (alt.toolName) return alt;
      }
    } catch {
      // LLM replan failed — fall through to null
    }
    return null;
  };

  const executeTool = async (name: string, args: Record<string, any>): Promise<string> => {
    const id = `chain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    config.onTool?.({ id, name, arguments: args, result: '' });
    // Handle desktop relay tools
    try {
      const output = config.desktopRelay && /^(desktop_|computer_)/.test(name)
        ? await config.desktopRelay(name, args)
        : await toolRegistry.execute(name, args, config.context);
      config.onTool?.({ id, name, arguments: args, result: output });
      return output;
    } catch (err: any) {
      config.onTool?.({ id, name, arguments: args, result: '', error: err?.message || String(err) });
      throw err;
    }
  };

  const stepResults = await executePlan(plan, executeTool, config.context, onStep, replanFn);

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
    /(?:生成|创建|制作|编写|写|输出|导出|保存).*(?:方案|报告|文档|文件|表格|PPT|ppt|PDF|pdf|DOCX|docx)/u,
    /(?:继续|接着|下一步|深化|完善).*(?:方案|报告|文档|文件|画布|成果|设计|装修)/u,
    /(?:装修|室内|设计|CAD|cad|图纸|平面图|施工图).*(?:方案|文档|文件|输出|生成|保存|深化|材料|色彩|预算)/u,
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
