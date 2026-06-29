import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '')
    .split(/\r?\n|[;；]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function findSignals(text: string, patterns: Record<string, RegExp>): string[] {
  return Object.entries(patterns).filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

const server = new McpServer({ name: 'cross-border-trade', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('trade_inquiry_reply', {
  description: 'Draft a professional foreign-trade inquiry reply with missing questions, quotation data needs, and follow-up structure.',
  inputSchema: {
    inquiryText: z.string().describe('Customer inquiry, email, or chat text'),
    product: z.string().optional().describe('Product or SKU family'),
    language: z.string().optional().describe('Target reply language'),
    tone: z.enum(['warm', 'direct', 'formal']).optional().describe('Reply tone'),
  },
}, async (args: any) => {
  const inquiry = String(args.inquiryText || '');
  const product = args.product || 'the requested product';
  const signals = findSignals(inquiry, {
    price: /price|quote|quotation|cost|价格|报价/i,
    sample: /sample|样品/i,
    moq: /moq|minimum|起订/i,
    leadTime: /lead\s*time|delivery|交期|发货/i,
    customization: /custom|logo|oem|odm|定制/i,
    certification: /certificate|certification|ce|fda|认证/i,
  });
  return ok({
    product,
    inquirySignals: signals,
    missingQuestions: [
      'Target quantity and annual estimate',
      'Destination country and delivery address type',
      'Required Incoterm, payment term, and currency',
      'Packaging, labeling, certification, or customization requirements',
    ],
    replyDraft: [
      `Thank you for your interest in ${product}. We can support quotation and sample details after confirming a few points.`,
      'Could you share target quantity, destination country, preferred Incoterm, and any packaging or certification requirements?',
      'Once confirmed, we will send pricing, lead time, sample arrangement, and shipping options for your review.',
    ].join('\n\n'),
    nextActions: ['Confirm missing data', 'Prepare quote sheet', 'Check certification/logistics constraints', 'Schedule follow-up within 24 hours'],
  });
});

server.registerTool('export_quote_builder', {
  description: 'Build a structured export quotation frame with Incoterm, price, lead time, payment, validity, and risk notes.',
  inputSchema: {
    product: z.string().describe('Product or SKU'),
    quantity: z.string().optional().describe('Quantity or quantity tiers'),
    unitPrice: z.number().optional().describe('Unit price if known'),
    currency: z.string().optional().describe('Currency, default USD'),
    incoterm: z.string().optional().describe('Incoterm such as EXW, FOB, CIF, DDP'),
    leadTime: z.string().optional().describe('Production or delivery lead time'),
    notes: z.string().optional().describe('Special requirements or constraints'),
  },
}, async (args: any) => ok({
  quotation: {
    product: args.product,
    quantity: args.quantity || 'TBD',
    price: args.unitPrice ? `${args.currency || 'USD'} ${args.unitPrice}` : 'TBD after quantity and specs confirmation',
    incoterm: args.incoterm || 'TBD',
    leadTime: args.leadTime || 'TBD',
    validity: '7-15 days, subject to raw material and exchange-rate changes',
    payment: 'T/T, deposit before production and balance before shipment unless otherwise agreed',
  },
  buyerConfirmations: ['Specs/version', 'Quantity tier', 'Destination', 'Packaging/labeling', 'Compliance documents'],
  riskNotes: ['Confirm Incoterm responsibility boundary', 'Do not promise customs/tax outcomes without local broker review', 'Attach product photos/spec sheet to reduce misunderstanding'],
  sourceNotes: args.notes || '',
}));

server.registerTool('customs_document_checklist', {
  description: 'Create an export/import document checklist and data-field review list for a shipment.',
  inputSchema: {
    shipment: z.string().describe('Shipment description, destination, product, and order notes'),
    destination: z.string().optional().describe('Destination country or region'),
    productCategory: z.string().optional().describe('Product category'),
  },
}, async (args: any) => {
  const text = `${args.shipment || ''} ${args.productCategory || ''}`;
  const sensitive = findSignals(text, {
    battery: /battery|lithium|电池/i,
    food: /food|supplement|食品|保健/i,
    cosmetics: /cosmetic|化妆/i,
    medical: /medical|device|医疗/i,
    electronics: /electronic|adapter|charger|电子|充电/i,
  });
  return ok({
    destination: args.destination || 'TBD',
    coreDocuments: ['Commercial invoice', 'Packing list', 'Sales contract/PO', 'Bill of lading/air waybill', 'Certificate of origin if needed'],
    dataFieldsToCheck: ['HS code', 'Product name and material', 'Quantity and unit', 'Gross/net weight', 'Declared value', 'Origin', 'Consignee/importer data'],
    categoryRiskFlags: sensitive,
    brokerQuestions: ['Is import license or special certification required?', 'Are tariffs/VAT estimated by correct HS code?', 'Any labeling or restricted-goods requirement?'],
  });
});

server.registerTool('logistics_status_brief', {
  description: 'Turn tracking or freight-forwarder notes into a customer-ready logistics update and risk summary.',
  inputSchema: {
    trackingText: z.string().describe('Tracking events or logistics notes'),
    orderId: z.string().optional().describe('Order or shipment id'),
  },
}, async (args: any) => {
  const events = list(args.trackingText);
  const joined = events.join(' ');
  const risks = findSignals(joined, {
    customsHold: /customs|clearance|海关|查验|扣关/i,
    delay: /delay|late|postpone|延误|推迟/i,
    addressIssue: /address|contact|地址|电话/i,
    damage: /damage|broken|破损/i,
  });
  return ok({
    orderId: args.orderId || 'TBD',
    latestEvents: events.slice(-5),
    riskFlags: risks,
    customerUpdate: `Shipment ${args.orderId || ''} is currently being monitored. Latest update: ${events.at(-1) || 'no event provided'}. We will keep checking and update you if clearance or delivery action is needed.`,
    internalActions: risks.length ? ['Ask forwarder for ETA and required action', 'Prepare customer explanation', 'Check documents/address'] : ['Continue tracking', 'Send next update after carrier event'],
  });
});

server.registerTool('multilingual_customer_service', {
  description: 'Classify a cross-border customer message and draft a multilingual support reply with escalation notes.',
  inputSchema: {
    message: z.string().describe('Customer message'),
    language: z.string().optional().describe('Target language for reply'),
    channel: z.string().optional().describe('Channel such as Amazon, Shopify, WhatsApp, email'),
  },
}, async (args: any) => {
  const msg = String(args.message || '');
  const intents = findSignals(msg, {
    refund: /refund|return|退款|退货/i,
    shipping: /ship|tracking|delivery|物流|发货/i,
    product: /quality|broken|size|color|质量|尺寸|颜色/i,
    price: /discount|coupon|price|折扣|价格/i,
  });
  return ok({
    channel: args.channel || 'unspecified',
    targetLanguage: args.language || 'English',
    intent: intents[0] || 'general',
    replyDraft: `Hello, thank you for reaching out. I understand your concern about ${intents.join(', ') || 'this order'}. Please share your order number and any photos or tracking screenshots, and we will check the details for you as soon as possible.`,
    escalation: intents.includes('refund') || intents.includes('product') ? 'Check platform policy, order status, and evidence before promising refund/replacement.' : 'Standard support handling.',
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
