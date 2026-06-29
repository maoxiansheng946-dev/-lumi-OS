import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  buildDecisionMemo,
  buildExecutiveBrief,
  buildOkrPlan,
  calculateRunwayScenario,
  convertMeetingToActions,
  reviewTeamRisks,
} from './logic';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: 'executive-ops', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('executive_kpi_brief', {
  description: 'Turn raw KPI lines into an executive brief with categorized signals, decision questions, and operating review actions.',
  inputSchema: {
    period: z.string().optional().describe('Reporting period'),
    businessType: z.string().optional().describe('Business type or operating model'),
    kpiText: z.string().describe('Raw KPI, weekly report, dashboard, or operating notes'),
    priorities: z.union([z.string(), z.array(z.string())]).optional().describe('Top priorities for this period'),
  },
}, async (args: any) => ok(buildExecutiveBrief(args)));

server.registerTool('meeting_action_extractor', {
  description: 'Extract decisions, action items, owners, due dates, open questions, and follow-up template from meeting notes.',
  inputSchema: {
    meetingNotes: z.string().describe('Meeting notes, transcript snippets, or bullet list'),
    defaultOwner: z.string().optional().describe('Fallback owner if an action has no explicit owner'),
  },
}, async (args: any) => ok(convertMeetingToActions(args)));

server.registerTool('okr_planner', {
  description: 'Create a quarter OKR plan aligned to a company goal, with team-level objectives, KRs, initiatives, and alignment checks.',
  inputSchema: {
    quarter: z.string().optional().describe('Quarter or planning period'),
    companyGoal: z.string().describe('Company-level goal'),
    departments: z.union([z.string(), z.array(z.string())]).optional().describe('Departments or teams'),
    constraints: z.string().optional().describe('Budget, capacity, market, or timeline constraints'),
  },
}, async (args: any) => ok(buildOkrPlan(args)));

server.registerTool('decision_memo_builder', {
  description: 'Create a decision memo frame comparing options across criteria, risks, evidence, and recommendation structure.',
  inputSchema: {
    decision: z.string().describe('Decision to make'),
    options: z.union([z.string(), z.array(z.string())]).optional().describe('Options under consideration'),
    criteria: z.union([z.string(), z.array(z.string())]).optional().describe('Decision criteria'),
    context: z.string().optional().describe('Business context'),
  },
}, async (args: any) => ok(buildDecisionMemo(args)));

server.registerTool('team_risk_review', {
  description: 'Review team or project notes for operating risks, escalation needs, owners, and operating questions.',
  inputSchema: {
    teamNotes: z.string().describe('Team notes, project updates, or manager observations'),
    focus: z.string().optional().describe('Review focus, e.g. delivery, hiring, retention, sales execution'),
  },
}, async (args: any) => ok(reviewTeamRisks(args)));

server.registerTool('cash_runway_scenario', {
  description: 'Build a simple cash runway scenario from cash, monthly revenue, monthly cost, planned investment, and forecast months.',
  inputSchema: {
    cash: z.number().describe('Current cash balance'),
    monthlyRevenue: z.number().optional().describe('Expected monthly cash revenue'),
    monthlyCost: z.number().optional().describe('Expected monthly cash cost'),
    plannedInvestment: z.number().optional().describe('One-off planned investment or spend'),
    months: z.number().optional().describe('Forecast months, 1-36'),
  },
}, async (args: any) => ok(calculateRunwayScenario(args)));

const transport = new StdioServerTransport();
await server.connect(transport);
