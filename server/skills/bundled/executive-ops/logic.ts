function splitList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '').split(/\n|,|;|，|；/).map(s => s.trim()).filter(Boolean);
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function extractNumbers(text: string): number[] {
  return Array.from(String(text || '').matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?%?/g)).map(match => {
    const raw = match[0].replace(/,/g, '').replace('%', '');
    return Number(raw);
  }).filter(Number.isFinite);
}

function splitLines(text?: string): string[] {
  return String(text || '').split(/\n|;/).map(s => s.trim()).filter(Boolean);
}

function classifyLine(line: string): 'growth' | 'finance' | 'customer' | 'people' | 'delivery' | 'risk' | 'general' {
  if (/revenue|sales|gmv|growth|增长|营收|销售|转化|线索/i.test(line)) return 'growth';
  if (/cash|margin|profit|cost|burn|现金|利润|毛利|成本|费用/i.test(line)) return 'finance';
  if (/customer|nps|churn|complaint|客户|续费|流失|投诉/i.test(line)) return 'customer';
  if (/hire|team|attrition|绩效|招聘|团队|离职|人效/i.test(line)) return 'people';
  if (/project|delivery|launch|milestone|项目|交付|上线|里程碑/i.test(line)) return 'delivery';
  if (/risk|blocked|delay|issue|风险|阻塞|延期|异常/i.test(line)) return 'risk';
  return 'general';
}

export function buildExecutiveBrief(args: {
  period?: string;
  businessType?: string;
  kpiText?: string;
  priorities?: string | string[];
}) {
  const lines = splitLines(args.kpiText);
  const priorities = splitList(args.priorities);
  const metrics = lines.map((line, index) => ({
    id: index + 1,
    area: classifyLine(line),
    text: line,
    numbers: extractNumbers(line),
  }));
  const byArea = metrics.reduce<Record<string, number>>((acc, row) => {
    acc[row.area] = (acc[row.area] || 0) + 1;
    return acc;
  }, {});

  return {
    period: args.period || 'current period',
    businessType: args.businessType || 'business',
    executiveSummary: [
      `Review ${metrics.length} signal(s) across ${Object.keys(byArea).join(', ') || 'general operations'}.`,
      priorities.length > 0 ? `Priority focus: ${priorities.join(', ')}.` : 'Priority focus not provided; confirm top 1-3 business priorities.',
      'Separate facts, interpretation, decisions, and follow-up owners before sharing.',
    ],
    metrics,
    byArea,
    decisionQuestions: [
      'What changed versus the previous period, and is it temporary or structural?',
      'Which metric has the biggest impact on cash, growth, customer trust, or delivery risk?',
      'What decision is needed this week, and who owns the next action?',
    ],
    actionReview: [
      'Assign owner, due date, and success metric for every action.',
      'Move ambiguous topics into a decision memo instead of leaving them as meeting notes.',
      'Revisit blocked items in the next operating review.',
    ],
  };
}

function inferOwner(line: string, fallback: string): string {
  const match = line.match(/(?:owner|负责人|责任人)\s*[:=：]?\s*([A-Za-z0-9\u4e00-\u9fa5._-]+)/i);
  return match?.[1] || fallback;
}

function inferDue(line: string): string | null {
  return line.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
}

export function convertMeetingToActions(args: {
  meetingNotes?: string;
  defaultOwner?: string;
}) {
  const lines = splitLines(args.meetingNotes);
  const actions = lines
    .filter(line => /todo|action|follow|next|owner|due|需要|负责|跟进|下周|完成|推进/i.test(line))
    .map((line, index) => ({
      id: index + 1,
      action: line.replace(/^(todo|action|next)\s*[:：-]?\s*/i, '').trim(),
      owner: inferOwner(line, args.defaultOwner || 'TBD'),
      dueDate: inferDue(line),
      status: /blocked|risk|延期|阻塞|风险/i.test(line) ? 'at_risk' : 'open',
    }));

  return {
    actionCount: actions.length,
    actions,
    decisions: lines.filter(line => /decided|decision|agreed|决定|拍板|确认/i.test(line)),
    openQuestions: lines.filter(line => /\?|？|unclear|待确认|问题|open/i.test(line)),
    followUpTemplate: {
      subject: 'Meeting follow-up: decisions, owners, due dates',
      sections: ['Decisions', 'Action items', 'Open questions', 'Risks'],
    },
  };
}

export function buildOkrPlan(args: {
  quarter?: string;
  companyGoal?: string;
  departments?: string | string[];
  constraints?: string;
}) {
  const departments = splitList(args.departments);
  const owners = departments.length > 0 ? departments : ['Growth', 'Product', 'Operations'];
  return {
    quarter: args.quarter || 'next quarter',
    companyGoal: args.companyGoal || 'Define the company-level outcome.',
    okrs: owners.map((dept, idx) => ({
      owner: dept,
      objective: `${dept} objective aligned to ${args.companyGoal || 'the company goal'}.`,
      keyResults: [
        { metric: `${dept} leading metric`, target: `KR${idx + 1}.1 target`, reviewCadence: 'weekly' },
        { metric: `${dept} quality or efficiency metric`, target: `KR${idx + 1}.2 target`, reviewCadence: 'biweekly' },
        { metric: `${dept} risk/control metric`, target: `KR${idx + 1}.3 target`, reviewCadence: 'monthly' },
      ],
      initiatives: ['Pick 1-3 initiatives only', 'Assign accountable owner', 'Define decision checkpoint'],
    })),
    alignmentChecks: [
      'Every KR should be measurable without a long explanation.',
      'Avoid confusing activity counts with business outcomes.',
      'Each team should know what to stop doing if this OKR is truly prioritized.',
    ],
    constraints: args.constraints || '',
  };
}

export function buildDecisionMemo(args: {
  decision?: string;
  options?: string | string[];
  criteria?: string | string[];
  context?: string;
}) {
  const options = splitList(args.options);
  const criteria = splitList(args.criteria);
  const selectedCriteria = criteria.length > 0 ? criteria : ['Impact', 'Cost', 'Speed', 'Risk', 'Reversibility'];
  return {
    decision: args.decision || 'Decision to make',
    context: args.context || '',
    options: (options.length > 0 ? options : ['Option A', 'Option B']).map(option => ({
      option,
      evaluation: selectedCriteria.map(criterion => ({ criterion, prompt: `Assess ${option} on ${criterion}.` })),
      risks: [`What can go wrong with ${option}?`, `What signal would make us reverse ${option}?`],
    })),
    recommendationFrame: [
      'State the recommended option and why now.',
      'State what evidence would change the decision.',
      'State owner, timeline, budget/capacity impact, and review date.',
    ],
  };
}

export function reviewTeamRisks(args: {
  teamNotes?: string;
  focus?: string;
}) {
  const rows = splitLines(args.teamNotes).map((line, index) => {
    const area = classifyLine(line);
    const severity = /urgent|critical|blocked|离职|事故|严重|阻塞/i.test(line)
      ? 'high'
      : /delay|risk|concern|延期|风险|担心/i.test(line)
        ? 'medium'
        : 'low';
    return {
      id: index + 1,
      area,
      severity,
      signal: line,
      owner: inferOwner(line, 'TBD'),
    };
  });

  return {
    focus: args.focus || 'team operating health',
    risks: rows.filter(row => row.severity !== 'low'),
    watchList: rows.filter(row => row.severity === 'low'),
    operatingQuestions: [
      'Which risk needs an owner today?',
      'Which risk is a symptom of unclear priority, missing capacity, or weak process?',
      'What can be removed from scope to protect the most important commitment?',
    ],
    escalationTemplate: ['Issue', 'Impact', 'Owner', 'Decision needed', 'Deadline'],
  };
}

export function calculateRunwayScenario(args: {
  cash?: number;
  monthlyRevenue?: number;
  monthlyCost?: number;
  plannedInvestment?: number;
  months?: number;
}) {
  const months = Math.min(Math.max(Number(args.months || 12), 1), 36);
  let cash = Number(args.cash || 0) - Number(args.plannedInvestment || 0);
  const burn = Number(args.monthlyCost || 0) - Number(args.monthlyRevenue || 0);
  const rows = [];
  for (let month = 1; month <= months; month++) {
    cash -= burn;
    rows.push({ month, projectedCash: round(cash) });
  }
  return {
    startingCashAfterInvestment: round(Number(args.cash || 0) - Number(args.plannedInvestment || 0)),
    monthlyBurn: round(burn),
    runwayMonths: burn <= 0 ? null : Math.max(0, Math.floor((Number(args.cash || 0) - Number(args.plannedInvestment || 0)) / burn)),
    forecast: rows,
    riskFlags: rows.filter(row => row.projectedCash < 0).map(row => `Month ${row.month} projected cash is negative.`),
    nextActions: [
      'Confirm revenue collection timing, not only booked revenue.',
      'Separate fixed costs, variable costs, one-off spend, and committed hiring.',
      'Define the cash trigger for cutting cost, raising funds, or pausing investment.',
    ],
  };
}
