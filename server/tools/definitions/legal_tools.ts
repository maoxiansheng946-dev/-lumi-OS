import { ToolRegistry } from '../registry';
import { parseDocument, extractLegalMetadata } from '../../legal/parser';
import {
  createLegalArticle, indexLegalArticle,
  searchSimilarCases, searchStatutes, verifyCitation, verifyMultipleCitations,
} from '../../legal/kb';
import {
  searchWenshu, searchFLK, searchMOHURDTemplates,
  searchCompany, searchEnforcementRecords,
} from '../../legal/sources';
import { generateEmbedding } from '../../memory/store';
import { makeLLMCall, type NormalizedMessage } from '../../llm/providers';
import { getUserPreferredLLMConfig } from '../../llm/user_preferences';

async function runLegalLLM(prompt: string, context?: any, maxTokens = 2048): Promise<string | null> {
  const getters = context?.llmGetters;
  if (!getters) return null;
  const userId = context?.userId || 'anonymous';
  const messages: NormalizedMessage[] = [{ role: 'user', content: prompt }];
  const response = await makeLLMCall(
    messages,
    [],
    getUserPreferredLLMConfig(userId, { maxTokens }),
    getters.getDeepSeek,
    getters.getGemini,
    getters.getOpenAI,
    getters.getAnthropic,
    getters.getQwen,
  );
  return response.text || null;
}

const EXTERNAL_LEGAL_SOURCES = [
  {
    label: '国家法律法规数据库',
    presetId: '',
    url: 'https://flk.npc.gov.cn/',
    use: '核验现行有效法律、行政法规、司法解释引用状态',
  },
  {
    label: '人民法院案例库',
    presetId: 'people-court-case-library',
    url: 'https://rmfyalk.court.gov.cn/',
    use: '优先检索权威案例、参考案例和裁判规则',
  },
  {
    label: '中国裁判文书网',
    presetId: 'china-judgments-online',
    url: 'https://wenshu.court.gov.cn/',
    use: '检索同案由、同争议焦点、同法院层级的公开裁判文书',
  },
  {
    label: '法蝉',
    presetId: 'fachan',
    url: 'https://www.fachans.com/',
    use: '在律所授权账号内补充商业库案例、裁判规则和办案资料',
  },
  {
    label: 'Alpha',
    presetId: 'alpha-lawyer',
    url: 'https://alphalawyer.cn/',
    use: '在律所授权账号内补充案例检索、诉讼策略和办案协同资料',
  },
  {
    label: '企查查',
    presetId: 'qichacha',
    url: 'https://www.qcc.com/',
    use: '查询企业基本信息、股东结构、风险信息和财产线索',
  },
  {
    label: '国家企业信用信息公示系统',
    presetId: 'national-enterprise-credit',
    url: 'https://www.gsxt.gov.cn/',
    use: '核验企业登记、公示、经营异常等官方信息',
  },
  {
    label: '人民法院在线服务',
    presetId: 'court-online-service',
    url: 'https://zxfw.court.gov.cn/',
    use: '半自动立案材料组卷后，由律师人工登录、核对、提交',
  },
];

function textArg(args: Record<string, any>, key: string): string {
  return String(args[key] || '').trim();
}

function listArg(args: Record<string, any>, key: string): string[] {
  const value = args[key];
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '').split(/\n|,|;|，|；/).map(s => s.trim()).filter(Boolean);
}

function roleLabel(role: string): '原告' | '被告' | '通用' {
  if (/被告|被申请人|被上诉人|respondent|defendant/i.test(role)) return '被告';
  if (/原告|申请人|上诉人|plaintiff|claimant/i.test(role)) return '原告';
  return '通用';
}

function buildCaseContext(args: Record<string, any>): string {
  const fields = [
    ['案件名称', textArg(args, 'caseName')],
    ['我方身份', textArg(args, 'role')],
    ['案由/类型', textArg(args, 'caseType')],
    ['管辖/法院', textArg(args, 'court')],
    ['当事人', textArg(args, 'parties')],
    ['诉请/抗辩目标', textArg(args, 'claims') || textArg(args, 'objective')],
    ['事实摘要', textArg(args, 'facts')],
    ['证据材料', textArg(args, 'evidence')],
    ['对方材料', textArg(args, 'opponentMaterials')],
  ];
  return fields
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join('\n') || '- 待补充案件基础信息';
}

function buildSearchQueries(args: Record<string, any>): string[] {
  const caseType = textArg(args, 'caseType') || '民事纠纷';
  const issues = listArg(args, 'issues');
  const facts = textArg(args, 'facts');
  const seeds = [
    ...issues.map(issue => `${caseType} ${issue}`),
    `${caseType} 争议焦点 裁判规则`,
    `${caseType} 举证责任`,
    `${caseType} 诉讼时效`,
    `${caseType} 证据目录 证明目的`,
  ];
  if (/违约|合同|货款|交付|质量/.test(facts + caseType)) seeds.push(`${caseType} 违约责任 损失 违约金`);
  if (/劳动|工资|解除|加班/.test(facts + caseType)) seeds.push('劳动争议 违法解除 举证责任');
  if (/借款|利息|本金|转账/.test(facts + caseType)) seeds.push('民间借贷 转账凭证 借贷合意');
  return Array.from(new Set(seeds.map(s => s.trim()).filter(Boolean))).slice(0, 10);
}

// ── legal_search_case ───────────────────────────────────────────────────

async function searchCaseHandler(args: Record<string, any>, context?: any): Promise<string> {
  const query = args.query as string;
  const limit = (args.limit as number) || 5;
  if (!query) return '请提供案由或事实描述（query参数）';

  // Search local KB
  const orgId = args.orgId || 'default';
  const localResults = await searchSimilarCases(orgId, query, limit);

  if (localResults.length > 0) {
    const lines = localResults.map((r, i) =>
      `${i + 1}. **${r.title}** [相似度: ${r.score}]\n   案号: ${r.caseNumber || 'N/A'} | 法院: ${r.court || 'N/A'}\n   摘要: ${r.chunk.slice(0, 300)}...`,
    );
    return `本地知识库检索到 ${localResults.length} 个相似案例：\n\n${lines.join('\n\n')}\n\n*来源: 本地裁判文书知识库*`;
  }

  // Fallback: search wenshu
  return '本地知识库中未找到相似案例。建议导入相关裁判文书到知识库，或访问中国裁判文书网 (wenshu.court.gov.cn) 手动检索。';
}

// ── legal_search_statute ────────────────────────────────────────────────

async function searchStatuteHandler(args: Record<string, any>): Promise<string> {
  const query = args.query as string;
  if (!query) return '请提供法条名称或关键词（query参数）';

  const orgId = args.orgId || 'default';
  const results = await searchStatutes(orgId, query);

  if (results.length === 0) {
    return `未找到与"${query}"相关的法条。建议通过国家法律法规数据库 (flk.npc.gov.cn) 核实。`;
  }

  const lines = results.map((r, i) =>
    `${i + 1}. **${r.title}** ${r.isEffective ? '✓ 现行有效' : '✗ 已废止'}\n   ${r.chunk.slice(0, 200)}`,
  );
  return lines.join('\n\n') + '\n\n*来源: 国家法律法规数据库 (flk.npc.gov.cn) 及本地法条库*';
}

// ── legal_generate_bid ──────────────────────────────────────────────────

async function generateBidHandler(args: Record<string, any>, context?: any): Promise<string> {
  const requirements = args.requirements as string;
  const projectName = (args.projectName as string) || '项目';
  if (!requirements) return '请提供招标要求内容（requirements参数）';

  // Try to find relevant templates
  const templates = await searchMOHURDTemplates('施工');

  const prompt = `你是一名专业标书撰写师。请根据以下招标要求，生成一份完整的投标书框架。

## 招标要求
${requirements}

## 可用合同模板参考
${templates.slice(0, 3).map(t => `- ${t.title}`).join('\n')}

## 要求
1. 生成完整的标书目录结构
2. 每个章节写核心内容概要（商务标+技术标）
3. 标注每部分需要从招标文件中提取的具体信息
4. 所有引用的法条必须标注来源（法条名称+条款号）
5. 不要编造任何公司资质、业绩数据——标注为"[待填写]"

请用中文输出，格式清晰。`;

  // Try to use LLM
  try {
    const text = await runLegalLLM(prompt, context, 2048);
    if (text) return text;
  } catch { /* LLM unavailable, return structured outline */ }

  return `[标书生成 — 无LLM可用时的结构化大纲]

# ${projectName} 投标书

## 一、商务标
### 1.1 投标函及投标函附录 [待填写]
### 1.2 法定代表人身份证明 [待填写]
### 1.3 授权委托书 [待填写]
### 1.4 投标保证金 [待填写]
### 1.5 资格审查资料 [待填写]
  - 营业执照、资质证书
  - 近年财务状况
  - 近年类似项目业绩
### 1.6 已标价工程量清单 [待填写]

## 二、技术标
### 2.1 施工组织设计
### 2.2 项目管理机构
### 2.3 拟分包项目情况

## 三、报价策略建议
[基于招标文件的评分规则分析]

*注: 请连接LLM以生成完整标书内容。标注"[待填写]"处需根据实际公司资料补充。*`;
}

// ── legal_review_contract ───────────────────────────────────────────────

async function reviewContractHandler(args: Record<string, any>, context?: any): Promise<string> {
  const contractText = args.contract as string;
  const orgId = (args.orgId as string) || 'default';
  if (!contractText) return '请提供合同文本（contract参数）';

  // Search for similar cases to identify risk areas
  const riskKeywords = ['合同纠纷', '违约', '合同无效', '合同解除', '违约责任'];
  const caseResults: string[] = [];

  for (const kw of riskKeywords.slice(0, 3)) {
    const cases = await searchSimilarCases(orgId, kw, 3);
    for (const c of cases) {
      caseResults.push(`- ${c.title} (${c.caseNumber || 'N/A'}): ${c.chunk.slice(0, 150)}`);
    }
  }

  const prompt = `你是一名专业合同审查律师。请审查以下合同，标注风险条款。

## 合同文本
${contractText.slice(0, 8000)}

## 相关判例参考
${caseResults.slice(0, 10).join('\n')}

## 审查要求
1. 逐一标注风险条款（条款号+风险等级 高/中/低）
2. 每处风险提供：法律依据 + 修改建议
3. 引用真实法条并标注法条号（禁止编造）
4. 如合同类型有住建部示范文本，建议比对差异
5. 标注可能导致的违约责任范围

请用中文输出。`;

  try {
    const text = await runLegalLLM(prompt, context, 2048);
    if (text) return text;
  } catch { /* fall through */ }

  return `[合同审查 — 基于规则分析]

## 自动检测的风险条款

对合同文本中常见风险条款进行关键词检测：

${detectRiskClauses(contractText)}

## 建议
1. 参照住建部示范文本比对标准条款
2. 核实所有引用法条的有效性
3. 建议人工审查后定稿

*注: 连接LLM以进行深度合同审查分析。*`;
}

function detectRiskClauses(text: string): string {
  const risks: string[] = [];
  const patterns: Record<string, string> = {
    '违约金.*超过.*%': '违约金比例可能过高，依据《民法典》第585条，违约金超过实际损失30%的部分法院不予支持',
    '不可抗力': '不可抗力条款需要明确界定范围，避免模糊表述',
    '单方.*解除权|任意解除': '单方解除权条款需注意《民法典》第563条关于法定解除权的限制',
    '管辖.*法院|仲裁.*机构': '争议解决条款需明确管辖法院或仲裁机构，避免约定不明',
    '连带.*责任|无限.*责任': '连带责任或无限责任条款需审慎评估风险敞口',
    '知识产权.*归属|保密.*永久': '知识产权归属条款需明确，保密期限"永久"可能不合理',
    '转让.*提前.*三个月': '合同权利义务转让需双方协商一致（《民法典》第545条）',
  };

  for (const [pattern, advice] of Object.entries(patterns)) {
    if (new RegExp(pattern).test(text)) {
      risks.push(`- ⚠️ ${advice}`);
    }
  }
  return risks.length > 0 ? risks.join('\n') : '未检测到明显风险条款模式。建议使用LLM进行深度分析。';
}

// ── legal_draft_contract ────────────────────────────────────────────────

async function draftContractHandler(args: Record<string, any>, context?: any): Promise<string> {
  const contractType = (args.type as string) || '';
  const details = (args.details as string) || '';
  const templates = await searchMOHURDTemplates(contractType);

  if (templates.length === 0) {
    return `未找到"${contractType}"类型的住建部合同模板。可用模板类型：建设工程施工合同、商品房买卖合同（预售/现售）、工程总承包合同、建筑工人简易劳动合同、物业临时管理规约。请指定具体类型。`;
  }

  const prompt = `你是一名专业合同律师。请根据住建部示范文本起草一份${contractType}合同。

## 合同要求
${details || '标准合同'}

## 住建部示范文本
${templates[0].title} (${templates[0].publishDate})

## 要求
1. 按照住建部示范文本结构起草
2. 所有条款必须符合现行法律（民法典为主，标注引用法条号）
3. 需要填写的地方标注[请填写]
4. 可选项标注[可选]
5. 禁止编造法律条文

请输出完整合同文本。`;

  try {
    const text = await runLegalLLM(prompt, context, 2048);
    if (text) return text;
  } catch { /* fall through */ }

  return `[合同起草 — 模板]

使用住建部示范文本: **${templates[0].title}** (${templates[0].publishDate})

请访问 ${templates[0].url} 下载完整模板。

*注: 连接LLM可自动填充合同具体条款。*`;
}

// ── legal_trace_assets ──────────────────────────────────────────────────

async function traceAssetsHandler(args: Record<string, any>): Promise<string> {
  const subjectName = args.name as string;
  if (!subjectName) return '请提供被执行主体名称（name参数）';

  const lines: string[] = [`# 被执行人"${subjectName}"财产线索报告\n`];

  // 1. Company info
  const company = await searchCompany(subjectName);
  if (company) {
    lines.push('## 企业基本信息');
    lines.push(`- 名称: ${company.name}`);
    lines.push(`- 法定代表人: ${company.legalPerson}`);
    lines.push(`- 注册资本: ${company.registeredCapital}`);
    lines.push(`- 状态: ${company.status}`);
    lines.push(`- 成立日期: ${company.establishDate}`);
    lines.push(`- 统一社会信用代码: ${company.unifiedCode}`);
    if (company.shareholders.length > 0) {
      lines.push('- 股东结构:');
      for (const s of company.shareholders) {
        lines.push(`  - ${s.name}: ${s.ratio}% (${s.type})`);
      }
    }
    lines.push(`\n## 风险信息`);
    lines.push(`- 被执行记录: ${company.riskInfo.enforcementCount} 条`);
    lines.push(`- 失信记录: ${company.riskInfo.dishonestyCount} 条`);
    lines.push(`- 限制消费: ${company.riskInfo.restrictionsCount} 条`);
  }

  // 2. Enforcement records
  const enforcements = await searchEnforcementRecords(subjectName);
  if (enforcements.length > 0) {
    lines.push('\n## 公开执行记录');
    for (const e of enforcements) {
      lines.push(`- [${e.caseNumber}] ${e.court} | 立案: ${e.filingDate} | 执行标的: ${e.executionTarget} | ${e.status}`);
    }
  }

  lines.push('\n## 财产线索分析');
  lines.push('1. **银行账户**: 建议通过法院执行系统查询被执行人银行开户信息');
  lines.push('2. **不动产**: 建议查询被执行人及其配偶名下不动产登记信息');
  lines.push('3. **车辆**: 建议通过车管所查询被执行人名下机动车辆');
  lines.push('4. **股权**: 通过股权穿透分析关联企业（见legal_equity_penetration工具）');
  lines.push('5. **婚姻状况**: 建议查询被执行人婚姻登记信息，判断是否涉及夫妻共同财产');
  lines.push('6. **知识产权**: 建议查询被执行人名下专利、商标、著作权');
  lines.push(`\n*数据来源: 企查查(qcc.com) | 全国法院被执行人信息(zhixing.court.gov.cn) | ${new Date().toISOString().slice(0, 10)}*`);

  return lines.join('\n');
}

// ── legal_equity_penetration ─────────────────────────────────────────────

async function equityPenetrationHandler(args: Record<string, any>): Promise<string> {
  const companyName = args.name as string;
  if (!companyName) return '请提供公司名称（name参数）';

  const company = await searchCompany(companyName);
  if (!company) return `未找到"${companyName}"的企业信息。请核实公司名称。`;

  const lines: string[] = [`# ${companyName} 股权穿透分析\n`];
  lines.push('## 第一层：直接股东');
  for (const s of company.shareholders) {
    lines.push(`- ${s.name}: 持股 ${s.ratio}% (${s.type})`);
  }

  // Recursively trace each shareholder (max 3 levels)
  for (const s of company.shareholders.slice(0, 5)) {
    const subCompany = await searchCompany(s.name);
    if (subCompany && subCompany.shareholders.length > 0) {
      lines.push(`\n## 穿透 ${s.name} 的股东`);
      for (const ss of subCompany.shareholders) {
        const indirectRatio = Math.round(s.ratio * ss.ratio / 100);
        lines.push(`- ${ss.name}: 间接持股 ~${indirectRatio}% (${ss.type})`);
      }
    }
  }

  lines.push('\n## 财产线索');
  lines.push(`- 实际控制人: 需结合工商登记+公司章程判断`);
  lines.push(`- 注册资本: ${company.registeredCapital}`);
  lines.push('- 建议进一步查询: 银行流水、关联交易、对外投资');
  lines.push('\n*注意: 股权穿透信息基于公开工商数据，实际控制关系需综合判断。*');
  lines.push(`*数据来源: 企查查(qcc.com) | ${new Date().toISOString().slice(0, 10)}*`);

  return lines.join('\n');
}

// ── legal_case_strategy ─────────────────────────────────────────────────

async function caseStrategyHandler(args: Record<string, any>, context?: any): Promise<string> {
  const facts = args.facts as string;
  const orgId = (args.orgId as string) || 'default';
  if (!facts) return '请提供案件事实描述（facts参数）';

  // Search similar cases
  const similarCases = await searchSimilarCases(orgId, facts, 5);
  // Search relevant statutes
  const statutes = await searchStatutes(orgId, facts, 5);

  const caseRefs = similarCases.map(c =>
    `- ${c.title} (${c.caseNumber || 'N/A'}, ${c.court || ''}, 相似度: ${c.score})`,
  ).join('\n');

  const statuteRefs = statutes.filter(s => s.isEffective).map(s =>
    `- ${s.title}: ${s.chunk.slice(0, 200)}`,
  ).join('\n');

  const prompt = `你是一名资深诉讼律师。请根据以下事实和相关法条、判例，制定诉讼策略。

## 案件事实
${facts}

## 相关法条（已验证有效）
${statuteRefs || '（未在本地法条库中找到直接相关法条，建议使用legal_search_statute补充检索）'}

## 相似判例
${caseRefs || '（未在本地知识库中找到相似判例）'}

## 分析要求
1. 确定案由和法律关系
2. 分析原告/被告的有利点和风险点
3. 证据链建议（需要收集什么证据）
4. 适用法条（必须标注法条号+来源，不得编造）
5. 参考判例的判决倾向
6. 诉前保全/财产保全建议
7. 预估诉讼风险和时间成本

**重要：不得编造任何法条或判例。如无法确认，标注"待核实"。**`;

  try {
    const text = await runLegalLLM(prompt, context, 2048);
    if (text) return text;
  } catch { /* fall through */ }

  return `[诉讼策略分析 — 无LLM可用时的结构化框架]

## 案件初步分析

**案件事实**: ${facts.slice(0, 500)}...

## 相似判例
${caseRefs || '未找到相似判例'}

## 适用法条
${statuteRefs || '未找到直接相关法条'}

## 策略要点
1. 确定管辖权 — 核实被告住所地/合同履行地/侵权行为地
2. 证据保全 — 对关键证据申请公证/证据保全
3. 财产保全 — 查询被告财产线索，申请诉前/诉中财产保全
4. 诉讼时效 — 核实是否在诉讼时效期间内（民法典第188条: 3年）

*注: 连接LLM以进行完整诉讼策略分析。*`;
}

// ── legal_generate_litigation_packet ────────────────────────────────────

async function generateLitigationPacketHandler(args: Record<string, any>, context?: any): Promise<string> {
  const role = roleLabel(textArg(args, 'role'));
  const caseName = textArg(args, 'caseName') || '未命名案件';
  const facts = textArg(args, 'facts');
  const evidence = textArg(args, 'evidence');
  const caseContext = buildCaseContext(args);
  if (!facts && !evidence) return '请至少提供案件事实 facts 或证据材料 evidence。';

  const prompt = `你是一名律所诉讼支持律师。请生成半自动诉讼文书包草稿，所有内容均用于律师复核，不得宣称可直接提交。

## 案件信息
${caseContext}

## 输出要求
1. 明确区分“系统草稿”“律师待确认”“当事人/法院系统填写项”。
2. 我方为${role}时，生成相应文书包：
   - 原告：起诉状、要素式诉状要点、委托手续、立案材料清单、证据目录、证明目的、法院立案系统填写项。
   - 被告：答辩状、质证意见、证据反驳表、管辖/时效/主体资格等程序抗辩检查项、代理词框架。
   - 通用：案件摘要、证据清单、争议焦点、待补材料、法律检索清单。
3. 所有事实必须绑定证据或标注“待补证”。
4. 所有法律依据只写“待检索/待核验”或引用已确认法律名称，不得编造条文。
5. 保留提交、签字、盖章、立案、发送给对方等人工确认节点。
请用中文 Markdown 输出。`;

  try {
    const text = await runLegalLLM(prompt, context, 3000);
    if (text) return text;
  } catch { /* fall through */ }

  const plaintiffDocs = [
    '起诉状草稿：当事人信息、诉讼请求、事实与理由、证据和来源、受诉法院。',
    '要素式诉状要点：主体、法律关系、请求权基础、争议事实、证据对应、金额计算。',
    '委托手续：委托代理合同要点、授权委托书、律所函、律师证复印件清单。',
    '立案材料组卷：主体材料、证据副本、送达地址确认书、缴费/保全材料。',
    '证据目录：证据名称、来源、页码、证明对象、证明目的、原件核验状态。',
  ];
  const defendantDocs = [
    '答辩状草稿：基本答辩立场、逐项回应诉请、事实反驳、程序抗辩、证据目录。',
    '质证意见：真实性、合法性、关联性、证明目的是否成立、反证或补证需求。',
    '程序抗辩清单：管辖、诉讼时效、主体资格、重复起诉/仲裁条款、送达瑕疵。',
    '代理词框架：争议焦点、事实认定、法律适用、证据评价、结论请求。',
  ];
  const docs = role === '原告' ? plaintiffDocs : role === '被告' ? defendantDocs : [...plaintiffDocs, ...defendantDocs.slice(0, 2)];

  return `# ${caseName} 半自动诉讼文书包

## 一、人工边界
- 本文书包为系统草稿，只能作为律师工作底稿。
- 最终法律意见、签字盖章、立案提交、送达和对外发送必须由律师或当事人确认。
- 未能绑定证据的事实统一标注为“待补证”，不得直接写入最终文书。

## 二、案件信息
${caseContext}

## 三、文书包清单
${docs.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## 四、证据目录草稿
| 编号 | 证据名称 | 来源 | 待证事实 | 证明目的 | 原件/复印件 | 复核状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 待拆分证据材料 | 案件材料 | 待证事实 | 待补充 | 待核对 | 律师复核 |

## 五、立案/提交前确认点
- 当事人身份信息、统一社会信用代码、送达地址和联系方式。
- 管辖法院、案由、诉讼请求、金额计算、诉讼费和保全需求。
- 法条引用、类案引用、证据页码、附件份数。
- 提交平台：如需网上立案，使用 web_login_run 打开“人民法院在线服务”，由律师人工核对并提交。
`;
}

// ── legal_triad_analysis ────────────────────────────────────────────────

async function triadAnalysisHandler(args: Record<string, any>, context?: any): Promise<string> {
  const facts = textArg(args, 'facts');
  const issue = textArg(args, 'issue') || '待确认法律问题';
  const evidence = textArg(args, 'evidence');
  const role = textArg(args, 'role') || '我方';
  const orgId = textArg(args, 'orgId') || 'default';
  if (!facts) return '请提供 facts 案件事实。';

  const statutes = await searchStatutes(orgId, `${issue}\n${facts}`, 5);
  const cases = await searchSimilarCases(orgId, `${issue}\n${facts}`, 5);
  const statuteRefs = statutes.map(s => `- ${s.title}: ${s.isEffective ? '现行有效' : '需谨慎/已废止'}；${s.chunk.slice(0, 180)}`).join('\n');
  const caseRefs = cases.map(c => `- ${c.title} (${c.caseNumber || 'N/A'}, ${c.court || 'N/A'}, 相似度 ${c.score})`).join('\n');

  const prompt = `请按法律三段论输出半自动法律分析。不得编造法条或案例；没有来源时标注“待检索/待核验”。

## 我方身份
${role}

## 法律问题
${issue}

## 案件事实
${facts}

## 证据材料
${evidence || '未提供'}

## 已检索到的本地法条线索
${statuteRefs || '无'}

## 已检索到的本地类案线索
${caseRefs || '无'}

## 输出结构
1. 大前提：检索法律、解释法律、类案补强。
2. 小前提：待证事实、证据材料、举证质证。
3. 结论：涵摄判断、风险、可转化为起诉状/答辩状/代理词/法律意见书的表达。
4. 律师复核清单。`;

  try {
    const text = await runLegalLLM(prompt, context, 2600);
    if (text) return text;
  } catch { /* fall through */ }

  return `# 法律三段论分析

## 一、大前提：法律规则
${statuteRefs || '- 待通过国家法律法规数据库检索并核验现行有效法律。'}

## 二、大前提补强：类案规则
${caseRefs || '- 本地裁判文书库暂无可用类案，建议打开人民法院案例库、中国裁判文书网、法蝉或 Alpha 检索。'}

## 三、小前提：事实与证据
- 法律问题：${issue}
- 我方身份：${role}
- 已知事实：${facts}
- 证据材料：${evidence || '待补充'}
- 待证事实：主体资格、法律关系、履行/违约事实、损失或抗辩事实、程序事项。

## 四、结论：涵摄与风险
- 初步结论：需在核验法条和证据后形成。
- 风险：事实无证据支撑、法条未核验、类案差异、管辖/时效/主体资格问题。
- 可转化文书：起诉状、答辩状、质证意见、代理词或法律意见书。

## 五、律师复核清单
- 核验所有法条是否现行有效。
- 核验类案层级、裁判日期、案由和事实相似度。
- 将每个事实绑定证据页码和来源。
- 决定最终文书表述和是否提交/发送。`;
}

// ── legal_external_research_plan ────────────────────────────────────────

async function externalResearchPlanHandler(args: Record<string, any>): Promise<string> {
  const facts = textArg(args, 'facts');
  const caseType = textArg(args, 'caseType') || '民事纠纷';
  const issues = listArg(args, 'issues');
  const companyNames = listArg(args, 'companyNames');
  const queries = buildSearchQueries({ ...args, caseType, facts, issues });
  const courtLevels = ['最高人民法院', '高级人民法院', '中级人民法院', '基层人民法院'];
  const loginActions = EXTERNAL_LEGAL_SOURCES
    .filter(source => source.presetId)
    .map(source => `- ${source.label} (${source.presetId})
  1. web_login_profile_save_from_preset {"presetId":"${source.presetId}"}
  2. web_login_run {"profileId":"${source.presetId}","headless":false}
  3. 律师在网页内检索、筛选、摘录，并回填来源登记表。`)
    .join('\n');

  return `# 半自动外部检索行动单

## 一、检索边界
- Lumi 不复制第三方平台数据，不绕过验证码、付费墙、账号权限或频控。
- 使用 web_login_profile_save_from_preset 保存授权站点，再用 web_login_run 打开真实浏览器。
- 律师在网页内确认检索结果后，将标题、链接、案号、法院、裁判日期、关键摘录和使用理由登记回案件。

## 二、案件线索
- 案由/类型：${caseType}
- 争议焦点：${issues.join('；') || '待补充'}
- 事实摘要：${facts || '待补充'}
- 企业/被执行人：${companyNames.join('；') || '待补充'}

## 三、推荐检索顺序
1. 国家法律法规数据库：先核验法律依据是否现行有效。
2. 人民法院案例库：优先查权威案例和裁判规则。
3. 中国裁判文书网：按法院层级筛选，顺序为 ${courtLevels.join(' > ')}。
4. 法蝉 / Alpha：使用律所授权账号补充商业库资料。
5. 企查查 / 国家企业信用信息公示系统：核验公司和被执行人情况。
6. 人民法院在线服务：仅用于半自动立案材料核对和人工提交。

## 四、网页登录动作
${loginActions}

## 五、站点打开清单
${EXTERNAL_LEGAL_SOURCES.map(source => {
  const preset = source.presetId ? `presetId: ${source.presetId}` : '无需登录预设或使用通用网页登录';
  return `- ${source.label}（${preset}）：${source.use}\n  ${source.url}`;
}).join('\n')}

## 六、检索词
${queries.map((q, index) => `${index + 1}. ${q}`).join('\n')}

## 七、来源登记表字段
| 来源 | 检索词 | 标题/案号 | 法院层级 | 裁判日期/发布日期 | 链接 | 关键摘录 | 对我方有利点 | 不利/区分点 | 复核人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 待登记 | 待登记 | 待登记 | 待登记 | 待登记 | 待登记 | 待登记 | 待登记 | 待登记 | 待登记 |
`;
}

// ── legal_verify_citation ───────────────────────────────────────────────

async function verifyCitationHandler(args: Record<string, any>): Promise<string> {
  const citation = args.citation as string;
  const text = args.text as string;
  const orgId = (args.orgId as string) || undefined;

  if (text) {
    const checks = verifyMultipleCitations(text, orgId);
    if (checks.length === 0) return '未在文本中检测到法条引用（《XX法》格式）或案号引用。';
    return checks.map(c =>
      `${c.citation}\n  类型: ${c.type === 'statute' ? '法条引用' : '案例引用'}\n  存在: ${c.exists ? '是' : '否'}\n  有效: ${c.isEffective === null ? '不适用' : c.isEffective ? '现行有效' : '已废止'}\n  ${c.detail}\n  来源: ${c.source || 'N/A'}`,
    ).join('\n\n');
  }

  if (citation) {
    const check = verifyCitation(citation, orgId);
    return `${check.citation}\n  类型: ${check.type === 'statute' ? '法条引用' : '案例引用'}\n  存在: ${check.exists ? '是' : '否'}\n  有效: ${check.isEffective === null ? '不适用' : check.isEffective ? '现行有效' : '已废止'}\n  ${check.detail}\n  来源: ${check.source || 'N/A'}`;
  }

  return '请提供citation（单个引用）或text（批量验证）参数。';
}

// ── legal_import_judgment ───────────────────────────────────────────────

async function importJudgmentHandler(args: Record<string, any>): Promise<string> {
  const filePath = args.filePath as string;
  const orgId = (args.orgId as string) || 'default';
  const userId = (args.userId as string) || 'system';
  const content = args.content as string;

  if (!filePath && !content) return '请提供filePath（文件路径）或content（文书正文）。';

  let text: string;
  if (content) {
    text = content;
  } else {
    const result = await parseDocument(filePath);
    if (!result) return `无法解析文件: ${filePath}`;
    text = result.text;
  }

  const metadata = extractLegalMetadata(text);
  const title = metadata.caseNumber
    ? `${metadata.caseNumber} ${metadata.causeOfAction || ''}`
    : (filePath ? filePath.split('/').pop()?.split('\\').pop() || '裁判文书' : '裁判文书');

  const article = createLegalArticle(orgId, userId, {
    title,
    content: text,
    articleType: 'judgment',
    metadata: {
      articleType: 'judgment',
      caseNumber: metadata.caseNumber,
      court: metadata.court,
      parties: metadata.parties,
      causeOfAction: metadata.causeOfAction,
      judgmentDate: metadata.judgmentDate,
      statutesCited: metadata.statutesCited,
    },
  });

  const indexed = await indexLegalArticle(orgId, article.id);

  return `裁判文书导入成功。

- 标题: ${title}
- 案号: ${metadata.caseNumber || '未识别'}
- 审理法院: ${metadata.court || '未识别'}
- 案由: ${metadata.causeOfAction || '未识别'}
- 当事人: ${metadata.parties?.join(', ') || '未识别'}
- 引用法条: ${metadata.statutesCited?.join(', ') || '未识别'}
- 裁判日期: ${metadata.judgmentDate || '未识别'}
- 索引状态: ${indexed} 个文本块已向量化

该文书已录入组织知识库，可通过类案检索查询。`;
}

// ── Register All ────────────────────────────────────────────────────────

export function registerLegalTools(registry: ToolRegistry): void {
  registry.register({
    name: 'legal_search_case',
    description: '类案检索 — 根据案由或事实描述在本地裁判文书库中搜索相似案例，返回案号、法院、相似度分数、摘要。数据来源：本地导入的中国裁判文书网公开文书。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '案由或事实描述，如"民间借贷纠纷"或"开发商逾期交房"' },
        limit: { type: 'number', description: '返回结果数量上限，默认5' },
        orgId: { type: 'string', description: '组织ID' },
      },
      required: ['query'],
    },
    handler: searchCaseHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_search_statute',
    description: '法条检索 — 按关键词或法条号搜索现行有效法律法规。数据来源：国家法律法规数据库 (flk.npc.gov.cn) 及本地法条库。自动标注已废止法条。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '法条名称或关键词，如"民法典合同编"或"劳动合同法"' },
        orgId: { type: 'string', description: '组织ID' },
      },
      required: ['query'],
    },
    handler: searchStatuteHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_generate_bid',
    description: '标书生成 — 导入招标文件要求，生成对应投标书框架（商务标+技术标）。使用住建部合同模板作为参考。',
    parameters: {
      type: 'object',
      properties: {
        requirements: { type: 'string', description: '招标文件中的技术要求/评分标准/合同条款要求' },
        projectName: { type: 'string', description: '项目名称' },
      },
      required: ['requirements'],
    },
    handler: generateBidHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_review_contract',
    description: '合同审查 — 对照本地案例库审查合同条款风险，标注风险等级、法律依据和修改建议。所有法条引用均会标注来源。',
    parameters: {
      type: 'object',
      properties: {
        contract: { type: 'string', description: '待审查的合同全文' },
        orgId: { type: 'string', description: '组织ID' },
      },
      required: ['contract'],
    },
    handler: reviewContractHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_draft_contract',
    description: '合同起草 — 基于中国住建部示范文本生成合同。支持施工合同、买卖合同、工程总承包、劳动合同等类型。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '合同类型：建设工程施工合同 / 商品房买卖合同 / 工程总承包合同 / 建筑工人劳动合同' },
        details: { type: 'string', description: '合同具体要求（项目信息、工期、价款等）' },
      },
      required: ['type'],
    },
    handler: draftContractHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_trace_assets',
    description: '财产线索追踪 — 查询被执行人企业信息、公开执行记录、失信记录等财产线索。数据来源：企查查(qcc.com)和全国法院被执行人信息(zhixing.court.gov.cn)。后续可查询婚姻状况和股权穿透。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '被执行主体名称（个人姓名/公司名称）' },
      },
      required: ['name'],
    },
    handler: traceAssetsHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_equity_penetration',
    description: '股权穿透分析 — 追溯目标公司的股东结构，多层穿透识别实际控制人和关联财产线索。数据来源：企查查(qcc.com)公开工商信息。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '公司名称' },
      },
      required: ['name'],
    },
    handler: equityPenetrationHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_case_strategy',
    description: '诉讼策略分析 — 给定案件事实，结合相关法条和相似判例，制定应诉方案，包括：案由确定、证据建议、保全策略、风险预估。所有分析基于真实法条和判例，绝不编造。',
    parameters: {
      type: 'object',
      properties: {
        facts: { type: 'string', description: '案件事实描述（时间、地点、主体、行为、争议焦点）' },
        orgId: { type: 'string', description: '组织ID' },
      },
      required: ['facts'],
    },
    handler: caseStrategyHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_generate_litigation_packet',
    description: '半自动诉讼文书包 — 根据我方身份和案件材料生成起诉/答辩/质证/委托/立案组卷等律师工作底稿，并明确所有人工确认点。不会自动提交或签发。',
    parameters: {
      type: 'object',
      properties: {
        caseName: { type: 'string', description: '案件名称或简称' },
        role: { type: 'string', description: '我方身份：原告/被告/申请人/被申请人等' },
        caseType: { type: 'string', description: '案由或案件类型' },
        court: { type: 'string', description: '拟立案法院或审理法院' },
        parties: { type: 'string', description: '当事人身份信息摘要' },
        claims: { type: 'string', description: '诉讼请求、抗辩目标或办理目标' },
        facts: { type: 'string', description: '案件事实和时间线' },
        evidence: { type: 'string', description: '已有证据材料摘要' },
        opponentMaterials: { type: 'string', description: '对方起诉状、证据或其他材料摘要' },
      },
    },
    handler: generateLitigationPacketHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_triad_analysis',
    description: '法律三段论分析 — 按大前提（法律/类案）、小前提（事实/证据/举证质证）、结论（涵摄到文书表达）生成律师复核版分析。',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: '法律问题或争议焦点' },
        role: { type: 'string', description: '我方身份' },
        facts: { type: 'string', description: '案件事实' },
        evidence: { type: 'string', description: '证据材料摘要' },
        orgId: { type: 'string', description: '组织ID，用于检索本地法条/类案库' },
      },
      required: ['facts'],
    },
    handler: triadAnalysisHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_external_research_plan',
    description: '半自动外部检索行动单 — 生成法条、人民法院案例库、裁判文书网、法蝉、Alpha、企查查、国家企业信用、法院在线服务的检索顺序、网页登录预设和来源登记表。',
    parameters: {
      type: 'object',
      properties: {
        caseType: { type: 'string', description: '案由或案件类型' },
        facts: { type: 'string', description: '案件事实摘要' },
        issues: { type: 'array', items: { type: 'string' }, description: '争议焦点列表' },
        companyNames: { type: 'array', items: { type: 'string' }, description: '需要查询的公司或被执行人名称' },
      },
    },
    handler: externalResearchPlanHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_verify_citation',
    description: '引用校验 — 验证法条引用和案例引用是否真实有效。可检查单个引用或全文中的所有引用，标注：存在/不存在、有效/已废止。禁止使用虚构法条和案例。',
    parameters: {
      type: 'object',
      properties: {
        citation: { type: 'string', description: '单个引用文本，如"《民法典》第585条"或"(2024)京0105民初12345号"' },
        text: { type: 'string', description: '包含多个引用的完整文本（将自动识别所有《XX法》和案号引用）' },
        orgId: { type: 'string', description: '组织ID' },
      },
    },
    handler: verifyCitationHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'legal_import_judgment',
    description: '导入裁判文书 — 上传或粘贴裁判文书全文（PDF/DOCX/TXT），自动提取案号、法院、当事人、法条引用等元数据，分块并向量化索引到组织知识库。导入后可通过类案检索查询。',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '裁判文书文件路径（PDF/DOCX/TXT）' },
        content: { type: 'string', description: '直接粘贴的裁判文书全文（与filePath二选一）' },
        orgId: { type: 'string', description: '组织ID' },
        userId: { type: 'string', description: '操作用户ID' },
      },
    },
    handler: importJudgmentHandler,
    permission: 'user',
    securityLevel: 'safe',
  });
}
