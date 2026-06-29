import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function lines(value: unknown): string[] {
  return String(value || '').split(/\r?\n|[;；]/).map(s => s.trim()).filter(Boolean);
}

function flags(text: string, map: Record<string, RegExp>): string[] {
  return Object.entries(map).filter(([, re]) => re.test(text)).map(([name]) => name);
}

const server = new McpServer({ name: 'manufacturing-qa', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('production_daily_report', {
  description: 'Structure production notes into daily output, abnormalities, blockers, handover items, and next-shift priorities.',
  inputSchema: {
    reportText: z.string().describe('Production notes, line report, or shift handover text'),
    date: z.string().optional().describe('Report date'),
    lineName: z.string().optional().describe('Line, workshop, or product area'),
  },
}, async (args: any) => {
  const rows = lines(args.reportText);
  const text = rows.join(' ');
  return ok({
    date: args.date || new Date().toISOString().slice(0, 10),
    lineName: args.lineName || 'TBD',
    outputNotes: rows.filter(r => /产量|output|pcs|件|完成|finished/i.test(r)),
    abnormalities: rows.filter(r => /异常|停机|shortage|delay|ng|scrap|返工|缺料/i.test(r)),
    riskFlags: flags(text, {
      materialShortage: /缺料|material shortage|shortage/i,
      machineDowntime: /停机|downtime|machine/i,
      qualityIssue: /不良|NG|defect|scrap|返工/i,
      deliveryRisk: /延期|delay|late|交期/i,
    }),
    nextShiftPriorities: ['Confirm material availability', 'Review unresolved abnormalities', 'Check first article / key quality point', 'Update delivery risk owner'],
  });
});

server.registerTool('bom_checker', {
  description: 'Review BOM lines for missing quantities, units, supplier notes, version risks, and procurement questions.',
  inputSchema: {
    bomText: z.string().describe('BOM lines or component list'),
    product: z.string().optional().describe('Product or project name'),
  },
}, async (args: any) => {
  const rows = lines(args.bomText);
  return ok({
    product: args.product || 'TBD',
    parsedLineCount: rows.length,
    incompleteLines: rows.filter(r => !/\d/.test(r) || !/(pcs|kg|mm|m|set|件|套|米|克|千克)/i.test(r)).slice(0, 20),
    checks: ['Part number/version', 'Description/spec', 'Quantity per unit', 'Unit', 'Supplier/brand substitute', 'Loss rate', 'Lead time'],
    procurementQuestions: ['Which parts are long-lead?', 'Any approved substitute?', 'Which items need sample confirmation?', 'Which components affect safety/compliance?'],
  });
});

server.registerTool('quality_issue_8d', {
  description: 'Create an 8D quality issue frame from defect notes, including containment, root-cause questions, corrective actions, and verification plan.',
  inputSchema: {
    defectText: z.string().describe('Defect, complaint, inspection, or failure notes'),
    customer: z.string().optional().describe('Customer or affected line'),
    lot: z.string().optional().describe('Lot, batch, or order id'),
  },
}, async (args: any) => {
  const text = String(args.defectText || '');
  return ok({
    issue: { customer: args.customer || 'TBD', lot: args.lot || 'TBD', summary: text.slice(0, 240) },
    d1_team: ['Quality owner', 'Production owner', 'Engineering/process owner', 'Supplier owner if material-related'],
    d2_problem: ['What failed?', 'Where detected?', 'How many affected?', 'Which lot/date/machine/operator?'],
    d3_containment: ['Stop shipment if risk is active', 'Sort suspect stock', 'Notify warehouse/customer service', 'Record serial/lot scope'],
    d4_rootCauseQuestions: ['Why did defect occur?', 'Why did detection fail?', 'What changed recently?', 'Material/process/person/machine/environment?'],
    d5_d7_actions: ['Correct root cause', 'Update inspection/control plan', 'Train operators', 'Verify with sample size and time window'],
    d8_closureEvidence: ['Before/after defect rate', 'Inspection records', 'Customer confirmation', 'Standard update'],
    riskFlags: flags(text, { safety: /safety|安全/i, repeated: /repeat|again|重复|再次/i, customerComplaint: /complaint|客户|客诉/i }),
  });
});

server.registerTool('supplier_delivery_risk', {
  description: 'Assess supplier notes for delivery, quality, price, and communication risk with escalation actions.',
  inputSchema: {
    supplierText: z.string().describe('Supplier updates, purchase order notes, or chat logs'),
    dueDate: z.string().optional().describe('Required delivery date'),
  },
}, async (args: any) => {
  const text = String(args.supplierText || '');
  const riskFlags = flags(text, {
    late: /late|delay|延期|推迟|来不及/i,
    quality: /quality|defect|不良|质量/i,
    capacity: /capacity|排产|产能|busy/i,
    price: /涨价|price increase|cost/i,
  });
  return ok({
    dueDate: args.dueDate || 'TBD',
    riskLevel: riskFlags.length >= 2 ? 'high' : riskFlags.length ? 'medium' : 'low',
    riskFlags,
    escalationActions: ['Ask for committed ship date and evidence', 'Confirm partial shipment option', 'Prepare backup supplier/material substitute', 'Update customer/internal delivery owner'],
    messageDraft: 'Please confirm the earliest committed shipment date, current completion quantity, blockers, and whether partial shipment is possible today.',
  });
});

server.registerTool('work_order_planner', {
  description: 'Turn a work order or customer order into production planning steps, dependencies, checkpoints, and handover items.',
  inputSchema: {
    orderText: z.string().describe('Work order, PO, or production requirement'),
    dueDate: z.string().optional().describe('Due date'),
    capacityNotes: z.string().optional().describe('Capacity, line, staffing, or material constraints'),
  },
}, async (args: any) => ok({
  dueDate: args.dueDate || 'TBD',
  orderSummary: String(args.orderText || '').slice(0, 320),
  planningSteps: ['Confirm specification/version', 'Check BOM and material availability', 'Reserve line/capacity', 'Set first-article inspection', 'Schedule in-process and final QC', 'Confirm packing/shipping readiness'],
  dependencies: lines(args.capacityNotes).concat(['Material availability', 'Tooling/mold readiness', 'Approved sample/spec', 'QC standard']),
  checkpoints: ['Before production', 'First article', 'Mid-run quality review', 'Final inspection', 'Shipment handover'],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
