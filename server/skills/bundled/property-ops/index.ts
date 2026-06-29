import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function rows(value: unknown): string[] {
  return String(value || '').split(/\r?\n|[;；]/).map(s => s.trim()).filter(Boolean);
}

function scoreLine(line: string, needs: string): number {
  const tokens = needs.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
  return tokens.reduce((sum, token) => sum + (line.toLowerCase().includes(token) ? 1 : 0), 0);
}

const server = new McpServer({ name: 'property-ops', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('property_requirement_match', {
  description: 'Match client property needs against listing lines and produce comparison notes, questions, and follow-up actions.',
  inputSchema: {
    clientNeeds: z.string().describe('Client needs, budget, location, use case, and constraints'),
    listingsText: z.string().describe('Property/listing lines, one per listing'),
  },
}, async (args: any) => {
  const listings = rows(args.listingsText);
  const ranked = listings
    .map(line => ({ listing: line, matchScore: scoreLine(line, args.clientNeeds), concerns: /远|贵|噪|old|repair|无电梯|停车/i.test(line) ? ['needs verification'] : [] }))
    .sort((a, b) => b.matchScore - a.matchScore);
  return ok({
    clientNeeds: args.clientNeeds,
    rankedListings: ranked.slice(0, 8),
    questionsToAsk: ['Must-have vs nice-to-have?', 'Budget ceiling and payment timing?', 'Commute/school/business radius?', 'Lease or purchase timeline?', 'Deal-breakers?'],
    followUpActions: ['Schedule viewing for top matches', 'Verify ownership/lease terms', 'Prepare comparison table', 'Record client objections'],
  });
});

server.registerTool('property_work_order_triage', {
  description: 'Triage property management tickets by severity, category, owner, first response, and evidence needed.',
  inputSchema: {
    ticketText: z.string().describe('Tenant/property work-order tickets, one per line'),
  },
}, async (args: any) => {
  const tickets = rows(args.ticketText);
  return ok({
    tickets: tickets.map(ticket => {
      const urgent = /漏水|电|火|安全|门锁|water leak|electric|fire|safety|lock/i.test(ticket);
      const category = /水|leak|pipe/i.test(ticket) ? 'plumbing' : /电|power|electric/i.test(ticket) ? 'electrical' : /门|lock|security/i.test(ticket) ? 'security' : 'general';
      return {
        ticket,
        category,
        severity: urgent ? 'urgent' : 'normal',
        firstResponse: urgent ? 'Acknowledge immediately, request photo/video and exact location, dispatch vendor.' : 'Acknowledge, collect evidence, schedule inspection window.',
        evidenceNeeded: ['Photo/video', 'Room/unit/location', 'Time first noticed', 'Access window', 'Contact person'],
      };
    }),
    routingSummary: ['Urgent safety/water/electrical issues first', 'Batch general repairs by vendor/location', 'Confirm completion evidence before closure'],
  });
});

server.registerTool('renovation_budget_outline', {
  description: 'Create a renovation budget outline from scope notes, with cost buckets, missing decisions, and quote comparison checks.',
  inputSchema: {
    scopeText: z.string().describe('Renovation scope, room list, materials, or owner requirements'),
    targetBudget: z.number().optional().describe('Target total budget'),
  },
}, async (args: any) => ok({
  targetBudget: args.targetBudget || 'TBD',
  scopeSummary: String(args.scopeText || '').slice(0, 360),
  budgetBuckets: ['Demolition and protection', 'Water/electrical', 'Floor/wall/ceiling', 'Carpentry/custom cabinets', 'Kitchen/bath fixtures', 'Lighting/electrical fixtures', 'Labor', 'Management/contingency'],
  missingDecisions: ['Material grade', 'Furniture/appliance boundary', 'Hidden work acceptance standard', 'Change-order rule', 'Warranty and after-sales'],
  quoteComparisonChecks: ['Same scope?', 'Same material brand/spec?', 'Tax and management fee included?', 'Waste/loss rate clear?', 'Payment milestones tied to acceptance?'],
}));

server.registerTool('site_progress_report', {
  description: 'Turn construction or renovation progress notes into progress percentage, blockers, owner decisions, and next inspection points.',
  inputSchema: {
    progressText: z.string().describe('Site diary, contractor notes, photos captions, or inspection notes'),
    projectPhase: z.string().optional().describe('Current phase'),
  },
}, async (args: any) => {
  const notes = rows(args.progressText);
  return ok({
    projectPhase: args.projectPhase || 'TBD',
    completedItems: notes.filter(n => /完成|done|finished|已/i.test(n)),
    blockers: notes.filter(n => /待|缺|问题|delay|blocked|返工/i.test(n)),
    ownerDecisionsNeeded: ['Material confirmation', 'Change-order approval', 'Acceptance standard confirmation', 'Access/time coordination'],
    nextInspectionPoints: ['Hidden work photos', 'Level/vertical checks', 'Waterproof test if applicable', 'Electrical point verification', 'Cleanup and protection'],
  });
});

server.registerTool('leasing_message_draft', {
  description: 'Draft leasing, viewing, negotiation, or tenant communication messages from context and target tone.',
  inputSchema: {
    context: z.string().describe('Client, tenant, landlord, or viewing context'),
    goal: z.string().optional().describe('Desired next step'),
    tone: z.enum(['polite', 'firm', 'warm']).optional().describe('Message tone'),
  },
}, async (args: any) => ok({
  tone: args.tone || 'polite',
  goal: args.goal || 'confirm next step',
  messageDraft: `Hi, thanks for the update. Based on the current situation, I suggest we confirm ${args.goal || 'the next step'} and keep the key details in writing. Please let me know your available time or any constraints so I can coordinate quickly.`,
  checklistBeforeSending: ['Correct party/name/unit', 'No unsupported promise', 'Clear time window', 'Clear documents/evidence needed', 'Record follow-up owner'],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
