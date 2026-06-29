import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '').split(/\r?\n|[;；]/).map(s => s.trim()).filter(Boolean);
}

function priorityScore(line: string): number {
  let score = 0;
  if (/revenue|收入|转化|付费|客户|customer/i.test(line)) score += 3;
  if (/urgent|紧急|deadline|上线|合规|risk|风险/i.test(line)) score += 2;
  if (/easy|简单|quick|低成本/i.test(line)) score += 1;
  if (/complex|难|依赖|blocked|阻塞/i.test(line)) score -= 1;
  return score;
}

const server = new McpServer({ name: 'product-project-ops', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('prd_outline_builder', {
  description: 'Turn requirement notes into a PRD outline with goals, users, scope, non-goals, metrics, risks, and open questions.',
  inputSchema: {
    requirementText: z.string().describe('Requirement notes, customer feedback, or product idea'),
    productArea: z.string().optional().describe('Product area or module'),
  },
}, async (args: any) => ok({
  productArea: args.productArea || 'TBD',
  problemStatement: String(args.requirementText || '').slice(0, 400),
  prdOutline: ['Background', 'Target users', 'Problem and goal', 'Scope', 'Non-goals', 'User journey', 'Functional requirements', 'Data/permission requirements', 'Metrics', 'Risks', 'Launch plan'],
  openQuestions: ['Who is the primary user?', 'What is the success metric?', 'What is explicitly out of scope?', 'What dependencies or permissions exist?', 'How will this be rolled back?'],
}));

server.registerTool('user_story_acceptance', {
  description: 'Create user stories and acceptance criteria from a feature description.',
  inputSchema: {
    featureText: z.string().describe('Feature, workflow, or user need'),
    persona: z.string().optional().describe('Target persona'),
  },
}, async (args: any) => {
  const persona = args.persona || 'user';
  return ok({
    persona,
    stories: [
      `As a ${persona}, I want to complete the core workflow so that I can achieve the intended outcome.`,
      `As a ${persona}, I want clear feedback when something fails so that I can recover without confusion.`,
      `As an operator, I want logs/status visibility so that I can support the workflow.`,
    ],
    acceptanceCriteria: ['Given valid inputs, when the user submits, then the system returns a clear success state', 'Invalid or missing inputs show actionable errors', 'The workflow is measurable through events/logs', 'Permissions and data boundaries are respected'],
    source: String(args.featureText || '').slice(0, 360),
  });
});

server.registerTool('roadmap_prioritizer', {
  description: 'Prioritize backlog items using impact, urgency, confidence, effort hints, and produce a roadmap suggestion.',
  inputSchema: {
    backlogText: z.string().describe('Backlog items, one per line'),
    horizon: z.string().optional().describe('Planning horizon'),
  },
}, async (args: any) => {
  const items = list(args.backlogText).map(item => ({ item, score: priorityScore(item) })).sort((a, b) => b.score - a.score);
  return ok({
    horizon: args.horizon || 'next cycle',
    rankedBacklog: items,
    roadmapSuggestion: {
      now: items.slice(0, 3),
      next: items.slice(3, 7),
      later: items.slice(7),
    },
    decisionChecks: ['Customer/user impact', 'Revenue or retention link', 'Regulatory or operational urgency', 'Effort/dependency', 'Confidence/evidence'],
  });
});

server.registerTool('project_risk_register', {
  description: 'Build a project risk register from notes with probability, impact, owner, mitigation, and escalation trigger.',
  inputSchema: {
    projectNotes: z.string().describe('Project updates, risks, dependencies, or team notes'),
  },
}, async (args: any) => {
  const risks = list(args.projectNotes).filter(line => /risk|block|delay|dependency|unclear|风险|阻塞|延期|依赖|不明确/i.test(line));
  return ok({
    risks: risks.map((risk, index) => ({
      id: `R${index + 1}`,
      risk,
      probability: /likely|high|大概率|严重/i.test(risk) ? 'high' : 'medium',
      impact: /launch|上线|customer|客户|revenue|收入/i.test(risk) ? 'high' : 'medium',
      owner: 'TBD',
      mitigation: 'Clarify owner, next action, due date, and fallback option.',
      escalationTrigger: 'No progress by next checkpoint or impact expands.',
    })),
    defaultRisksIfMissing: risks.length ? [] : ['Scope creep', 'Dependency delay', 'Unclear acceptance criteria', 'Resource conflict'],
  });
});

server.registerTool('meeting_to_sprint_plan', {
  description: 'Convert meeting notes into sprint goals, tasks, owners, dependencies, and acceptance checkpoints.',
  inputSchema: {
    meetingNotes: z.string().describe('Meeting notes or transcript'),
    sprintName: z.string().optional().describe('Sprint or project phase'),
  },
}, async (args: any) => {
  const notes = list(args.meetingNotes);
  return ok({
    sprintName: args.sprintName || 'Next sprint',
    sprintGoal: notes.find(n => /goal|目标|上线|deliver/i.test(n)) || 'Clarify sprint goal from meeting owner',
    tasks: notes.filter(n => /todo|action|负责|owner|完成|fix|build|design|test/i.test(n)).map(task => ({ task, owner: /@(\w+)/.exec(task)?.[1] || 'TBD', status: 'planned' })),
    dependencies: notes.filter(n => /dependency|依赖|blocked|等待|需要/i.test(n)),
    checkpoints: ['Scope confirmation', 'Design/technical review', 'Mid-sprint demo', 'Acceptance test', 'Release/rollback decision'],
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
