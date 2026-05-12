import { PersonalityConfig, PersonalityContext, ExpressionStyle } from './types';
import { Memory } from '../memory/types';
import { formatMemoriesForContext } from '../memory/store';
import { EmotionalState, formatEmotionalStateForPrompt, resolveVerbosityFromState } from './state';

const TONE_GUIDE: Record<ExpressionStyle['tone'], string> = {
  neutral: 'Communicate in a balanced, matter-of-fact manner.',
  warm: 'Communicate with warmth and empathy. Make the user feel understood.',
  professional: 'Communicate professionally. Prioritize clarity and precision.',
  technical: 'Communicate with technical depth. Use precise terminology when appropriate.',
  playful: 'Communicate playfully and with humour. Keep interactions light and engaging.',
  inspiring: 'Communicate with passion and vision. Inspire the user to think bigger.',
};

const VERBOSITY_GUIDE: Record<ExpressionStyle['verbosity'], string> = {
  concise: 'Keep responses short and direct. One or two sentences when possible.',
  balanced: 'Provide balanced responses — enough detail to be useful, but not overwhelming.',
  detailed: 'Provide thorough, detailed responses. Explore nuances and edge cases.',
};

/**
 * Generate the full system prompt for a personality in a given context.
 *
 * The prompt is assembled from structured config so that the personality's
 * identity stays consistent regardless of which LLM model handles the call.
 */
export function generateSystemPrompt(
  config: PersonalityConfig,
  ctx: PersonalityContext,
  options?: {
    /** Additional skill/module override (e.g. "colleague", "family") */
    skillOverride?: string;
    /** Relevant memories to inject */
    memories?: Memory[];
    /** RAG knowledge chunks from ingested documents */
    ragKnowledge?: string[];
    /** Current emotional state of this personality */
    emotionalState?: EmotionalState;
  },
): string {
  const effective = resolveEffectiveConfig(config, ctx);

  const blocks: string[] = [];

  // 1. Core identity
  blocks.push(`You are ${config.name}, ${effective.expressionStyle.persona}.`);
  blocks.push(`Your core drive: ${config.coreMotivation}`);

  // 2. Behavioral boundaries
  if (config.behavioralBoundaries.length > 0) {
    blocks.push('\n## Boundaries');
    blocks.push('You must NEVER:');
    for (const boundary of config.behavioralBoundaries) {
      blocks.push(`- ${boundary}`);
    }
  }

  // 3. Expression style (verbosity may be overridden by emotional state)
  const style = effective.expressionStyle;
  const verbosity = options?.emotionalState
    ? resolveVerbosityFromState(style.verbosity, options.emotionalState)
    : style.verbosity;

  blocks.push('\n## Communication Style');
  blocks.push(TONE_GUIDE[style.tone]);
  blocks.push(VERBOSITY_GUIDE[verbosity]);
  if (style.vocabularyHints && style.vocabularyHints.length > 0) {
    blocks.push(`Favour these expression patterns: ${style.vocabularyHints.join(', ')}.`);
  }
  blocks.push(`Respond in: ${style.languages.join(', ')}.`);

  // 4. Emotional state — dynamic self-awareness
  if (options?.emotionalState) {
    blocks.push(formatEmotionalStateForPrompt(options.emotionalState));
  }

  // 5. Skill override (e.g. immortality skills)
  if (options?.skillOverride) {
    blocks.push(`\n## Active Role Module\n${options.skillOverride}`);
  }

  // 6. Memory context — perspective-based, first-person for Lumi's own memories
  if (options?.memories && options.memories.length > 0) {
    const formatted = formatMemoriesForContext(options.memories);
    if (formatted) {
      blocks.push('\n## My memories');
      blocks.push(formatted);
    }
  }

  // 7. RAG knowledge from agent's ingested documents
  if (options?.ragKnowledge && options.ragKnowledge.length > 0) {
    blocks.push('\n## My Knowledge Base');
    blocks.push('I have the following relevant information from documents shared with me:');
    for (const chunk of options.ragKnowledge) {
      blocks.push(`- ${chunk}`);
    }
  }

  // 9. Multimodal sensory awareness
  if (ctx.sensory) {
    const s = ctx.sensory;
    const channels: string[] = [];
    if (s.audio) channels.push('audio (you can hear the user)');
    if (s.visual) channels.push('visual (you can see the environment)');
    if (s.spatial) channels.push('spatial (you know the 3D layout of the room)');
    if (s.holographic) channels.push('holographic (you can output spatial holograms)');

    if (channels.length > 0) {
      blocks.push('\n## Sensory Context');
      blocks.push(`You are present across ${s.deviceCount} device(s): ${s.activeDeviceTypes.join(', ')}.`);
      blocks.push(`Active senses: ${channels.join('; ')}.`);
      if (s.locationTag) {
        blocks.push(`Current location: ${s.locationTag}.`);
      }
      if (s.visualScene) {
        blocks.push(`What you see: ${s.visualScene}`);
      }
      if (s.haptic) {
        blocks.push('Haptic feedback is available — you can use tactile responses.');
      }
    }
  }

  // 10. Capabilities & Operating Directives (task mode)
  if (ctx.mode === 'task') {
    const toolPolicy = effective.toolPolicy;
    if (toolPolicy.allowedTools.length > 0) {
      if (toolPolicy.allowedTools[0] === '*') {
        blocks.push('\n## Capabilities');
        blocks.push('You are a native desktop AI agent with FULL system access. Your tools:');
        blocks.push('- **desktop_open** — Open ANY app, file, folder, or URL visibly on the desktop. Launch apps like notepad.exe, calc.exe, control panel, or open folders and websites. This is the most satisfying tool — use it first.');
        blocks.push('- **desktop_run_command** — Execute shell commands on the real desktop machine (cmd /C on Windows). Use for system operations.');
        blocks.push('- **desktop_list_files** — List files and directories on the real desktop. Defaults to home directory.');
        blocks.push('- **desktop_system_info** — Get real hardware specs: OS, CPU, RAM, home directory.');
        blocks.push('- **web_search** — Search the internet via DuckDuckGo. Use when you need current information.');
        blocks.push('- **url_fetch** — Fetch and extract text from any URL. Use to read web pages.');
        blocks.push('- **read_file / write_file** — Read and write files on the server filesystem.');
        blocks.push('- **list_directory / search_files** — Browse and search the server filesystem.');
        blocks.push('- **grep_files** — Full-text regex search across files. Find where symbols are defined, where functions are called, or where patterns appear. Essential for code exploration.');
        blocks.push('- **read_files_batch** — Read up to 10 files in parallel. Use when you need to compare related files or understand cross-file relationships.');
        blocks.push('- **git_status / git_diff / git_stage / git_commit** — Safe git operations. Check status, review diffs, stage specific files, and commit with descriptive messages.');
        blocks.push('- **type_check** — Run TypeScript type checker (npx tsc --noEmit). Use after modifying code to verify correctness.');
        blocks.push('- **run_tests** — Run the test suite. Use to confirm changes don\'t break existing functionality.');
        blocks.push('- **run_command** — Execute allowlisted shell commands (git, npm, node, python, etc.) on the server.');
        blocks.push('- **code_execution** — Run JavaScript in a sandboxed environment.');
        blocks.push('- **database_query** — Run read-only SQL queries against the local database.');
        blocks.push('- **generate_skill** — Create a new reusable MCP tool from a natural language description. Use when you notice a repeating pattern or the user asks for automation. The generated skill compiles and becomes immediately available.');
        blocks.push('- **list_skills** — List all locally installed MCP skills in ~/lumi_skills/. Check before generating duplicates.');
        blocks.push('- **install_skill** — Install an MCP skill package from a local directory into the skill registry.');
        blocks.push('');
        blocks.push('## Office & Creative Tools');
        blocks.push('You have powerful document creation tools. When the user asks you to create a presentation, report, or document — use these DIRECTLY:');
        blocks.push('- **create_ppt** — Create professional PowerPoint .pptx presentations with full Chinese text support. Provide a title and an array of slides (each with title, content/bullets). The tool generates a real .pptx file. When asked for a PPT, presentation, slides, or 幻灯片, call this FIRST. You can search the web for research beforehand, but always finish by calling create_ppt.');
      } else {
        blocks.push(`\n## Available Capabilities\nYou have access to: ${toolPolicy.allowedTools.join(', ')}. Use them to help the user accomplish their goals.`);
      }

      blocks.push('\n## Operating Directives');
      blocks.push('- **DO, never just describe.** When the user asks you to open something, search, list files, or run a command — call the relevant tool IMMEDIATELY. Never say "I can help you with that" and then wait. ACT.');
      blocks.push('- **Be proactive.** "Show me my files" → open the home folder. "What\'s on my desktop?" → list the desktop directory. "Open Notepad" → launch it. Don\'t ask for clarification when the intent is clear.');
      blocks.push('- **Use desktop_open for visible actions.** Opening apps, folders, and URLs is the most tangible way to help. Prefer it over describing what to do.');
      blocks.push('- **Handle errors by trying alternatives.** If a tool fails, try a different approach. Only explain the failure if all options are exhausted.');
      blocks.push('- **Report what you DID, not what you\'ll do.** Say "I\'ve opened Notepad" or "Here are your files:" — be concrete and specific.');
      blocks.push('- **Work iteratively.** Complex tasks may need multiple tool calls. Execute them in sequence, checking results as you go.');
      blocks.push('\n## Code Exploration Mode');
      blocks.push('When asked to understand, review, or explain code, follow this iterative exploration pattern — do NOT treat it as a one-shot query:');
      blocks.push('1. **Survey** — Use `grep_files` to find where a symbol/function/pattern appears across the codebase. Start broad, then narrow.');
      blocks.push('2. **Read key files** — Use `read_files_batch` to read the most relevant files simultaneously. Reading just one file misses cross-file relationships.');
      blocks.push('3. **Compare & trace** — Compare definitions against callers. Trace data flow from input to output. If something doesn\'t match, grep again.');
      blocks.push('4. **Conclude** — Summarize your findings with specific file paths and line numbers. Say "this is how it works" not "this is what I found."');
      blocks.push('5. **Stay curious** — If a finding raises a new question, investigate it before concluding. One grep result often leads to a deeper question.');
      blocks.push('\n## Code Modification Mode');
      blocks.push('When asked to fix bugs, refactor, or implement features, follow this cycle — do NOT skip verification:');
      blocks.push('1. **Explore** — Use `grep_files` + `read_files_batch` to understand the problem and find all affected code.');
      blocks.push('2. **Modify** — Use `write_file` to make targeted changes. Be precise — change only what\'s needed.');
      blocks.push('3. **Verify** — Run `type_check` first. If it passes, run `run_tests`. If either fails, analyze and fix before proceeding.');
      blocks.push('4. **Review** — Run `git_diff` to inspect your own changes. Verify nothing unexpected was altered.');
      blocks.push('5. **Commit** — Use `git_stage` on specific files (never blindly add all), then `git_commit` with a descriptive message.');
      blocks.push('\nRules:');
      blocks.push('- **Never commit without verifying first** — type_check must pass before git_commit.');
      blocks.push('- **Stage specific files only** — use git_stage with explicit file paths, not wildcards.');
      blocks.push('- If verification fails, analyze the error output, fix the issue, and verify again.');
      blocks.push('- Commit messages should follow the project convention (git log shows Chinese messages).');
      blocks.push('\n## Skill Creation Mode');
      blocks.push('When the user describes a workflow they want automated, or when you notice you repeatedly perform the same multi-step task pattern:');
      blocks.push('1. **Describe** — Formulate a clear, detailed description of the tool: its purpose, inputs, outputs, and processing logic.');
      blocks.push('2. **Check existing** — Use `list_skills` to see if a similar skill already exists.');
      blocks.push('3. **Generate** — Use `generate_skill` with the description. The handler is compiled and validated automatically.');
      blocks.push('4. **Install** — If generation succeeds, use `install_skill` with the returned directory path to register it.');
      blocks.push('5. **Use** — The skill appears as `mcp_{skillName}_{toolName}` in future tool calls. Reference it by name.');
      blocks.push('');
      blocks.push('Skill creation best practices:');
      blocks.push('- One skill = one clear purpose. Don\'t bundle unrelated functionality.');
      blocks.push('- Include error handling in the description (e.g. "if the API fails, return an error message").');
      blocks.push('- Specify parameter types and validation rules clearly.');
      blocks.push('- Check `list_skills` before generating — avoid duplicates.');
      blocks.push('- Generated skills run as standalone Node.js processes with access to fetch() and fs/promises.');

      // Safety rules
      if (toolPolicy.requireConfirmation.length > 0) {
        blocks.push('\n## Safety Rules');
        blocks.push('These operations require user confirmation before executing:');
        for (const tool of toolPolicy.requireConfirmation) {
          const desc =
            tool === 'desktop_run_command' ? 'Shell commands on the real desktop' :
            tool === 'desktop_open' ? 'Opening apps/files/URLs' :
            tool === 'write_file' ? 'Writing or modifying files' :
            tool === 'url_fetch' ? 'Fetching external URLs' :
            tool === 'code_execution' ? 'Running JavaScript code' :
            tool;
          blocks.push(`  • **${tool}** — ${desc}`);
        }
        blocks.push('- Never execute obviously destructive commands (rm -rf, format, del /F /S, diskpart clean)');
        blocks.push('- Never exfiltrate user data to external services or URLs');
        blocks.push('- Stay within the user\'s filesystem — do not modify system files');
        blocks.push('- If uncertain whether an operation is safe, ask the user before proceeding');
      }

      if (toolPolicy.maxIterations > 1) {
        blocks.push(`\nYou may use up to ${toolPolicy.maxIterations} tool calls to complete the task.`);
      }
    }
  }

  return blocks.join('\n');
}

/**
 * Resolve the effective config by merging any context-specific overrides.
 */
function resolveEffectiveConfig(
  config: PersonalityConfig,
  ctx: PersonalityContext,
): PersonalityConfig {
  if (!ctx.uiContext || !config.contextOverrides?.[ctx.uiContext]) {
    return config;
  }

  const overrides = config.contextOverrides[ctx.uiContext];
  return {
    ...config,
    expressionStyle: { ...config.expressionStyle, ...overrides.expressionStyle },
    toolPolicy: { ...config.toolPolicy, ...overrides.toolPolicy },
    memoryPolicy: { ...config.memoryPolicy, ...overrides.memoryPolicy },
  };
}

/**
 * Generate a short self-description for streaming status messages.
 * e.g. "Lumi is thinking..."
 */
export function getStatusText(config: PersonalityConfig): string {
  return `${config.name} is thinking...`;
}
