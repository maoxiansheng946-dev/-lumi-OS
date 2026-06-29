import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(/\r?\n|[;；]/).map(s => s.trim()).filter(Boolean);
}

const boundary = 'Information structuring only. Suitability, legal, tax, and investment conclusions require licensed/professional review.';
const server = new McpServer({ name: 'insurance-advisor', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('client_needs_profile', {
  description: 'Structure insurance client notes into needs profile, protection gaps to verify, constraints, and next questions.',
  inputSchema: {
    clientText: z.string().describe('Client family, asset, income, health, goal, or conversation notes'),
  },
}, async (args: any) => {
  const text = String(args.clientText || '');
  return ok({
    boundary,
    profileSignals: {
      family: /child|parent|spouse|孩子|父母|配偶/i.test(text),
      mortgageOrDebt: /loan|mortgage|房贷|贷款|负债/i.test(text),
      health: /health|medical|hospital|疾病|健康|住院/i.test(text),
      retirement: /retire|pension|养老|退休/i.test(text),
      businessOwner: /business|company|老板|企业|股东/i.test(text),
    },
    needsToVerify: ['Existing policies and coverage', 'Budget and payment preference', 'Health/occupation constraints', 'Beneficiary/family responsibilities', 'Liquidity and emergency fund'],
    nextQuestions: ['What risk worries you most?', 'Who depends on your income?', 'What existing coverage do you already have?', 'What monthly/annual premium range is comfortable?'],
  });
});

server.registerTool('policy_comparison_frame', {
  description: 'Create a neutral policy comparison checklist across coverage, exclusions, cost, waiting periods, and renewal rules.',
  inputSchema: {
    policyText: z.string().describe('Policy summaries, proposal notes, or product descriptions'),
    comparisonCriteria: z.union([z.string(), z.array(z.string())]).optional().describe('Criteria to compare'),
  },
}, async (args: any) => ok({
  boundary,
  criteria: list(args.comparisonCriteria).concat(['Coverage scope', 'Exclusions', 'Waiting period', 'Premium schedule', 'Renewal/cancellation', 'Claim process']),
  extractionFields: ['Product name', 'Insured person', 'Sum insured', 'Premium', 'Payment period', 'Coverage period', 'Key exclusions', 'Riders'],
  reviewQuestions: ['What is not covered?', 'When does coverage start?', 'How are claims documented?', 'Can premiums change?', 'What happens on missed payment?'],
  sourceText: String(args.policyText || '').slice(0, 600),
}));

server.registerTool('claim_document_checklist', {
  description: 'Build a claim document checklist and timeline questions from a claim scenario.',
  inputSchema: {
    claimScenario: z.string().describe('Claim situation, event, policy type, and available documents'),
    policyType: z.string().optional().describe('Policy type such as health, accident, auto, property, life'),
  },
}, async (args: any) => ok({
  boundary,
  policyType: args.policyType || 'TBD',
  coreDocuments: ['Policy document', 'Claim form', 'Identity/bank information', 'Event proof', 'Invoices/receipts', 'Photos or reports if applicable'],
  timelineQuestions: ['Event date/time?', 'When was insurer notified?', 'Treatment/repair dates?', 'Any third-party report?', 'Any missing original document?'],
  riskChecks: ['Notice deadline', 'Exclusion/waiting period', 'Original invoice requirement', 'Diagnosis/accident proof consistency'],
  scenarioSummary: String(args.claimScenario || '').slice(0, 360),
}));

server.registerTool('renewal_review_plan', {
  description: 'Create a renewal review plan with coverage changes, customer communication, and retention actions.',
  inputSchema: {
    currentPolicy: z.string().describe('Current policy, premium, coverage, claim, or renewal notes'),
    customerContext: z.string().optional().describe('Customer changes or relationship notes'),
  },
}, async (args: any) => ok({
  boundary,
  reviewSteps: ['Confirm current coverage and premium', 'Check life/business changes', 'Review claim history', 'Flag coverage gaps or overlaps', 'Prepare renewal options and disclosure notes'],
  customerMessageFrame: ['Thank customer', 'Summarize current coverage', 'Ask what changed this year', 'Explain review items neutrally', 'Schedule confirmation'],
  retentionRisks: list(`${args.currentPolicy}\n${args.customerContext || ''}`).filter(line => /price|premium|claim|complaint|贵|理赔|涨价|不满/i.test(line)),
}));

server.registerTool('compliance_disclosure_check', {
  description: 'Review sales or proposal text for compliance disclosure gaps and risky wording.',
  inputSchema: {
    salesText: z.string().describe('Sales script, proposal, message, or customer-facing copy'),
  },
}, async (args: any) => {
  const text = String(args.salesText || '');
  return ok({
    boundary,
    riskyPhrases: list(text).filter(line => /guarantee|risk-free|收益保证|稳赚|无风险|一定赔|最高收益/i.test(line)),
    disclosureChecklist: ['Product risks', 'Exclusions and waiting periods', 'Premium/payment obligations', 'Surrender/cancellation impact', 'No guaranteed outcome unless explicitly in contract'],
    saferRewriteFrame: 'Use neutral wording: explain what the policy covers, what it excludes, what documents govern the contract, and what the customer should verify before deciding.',
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
