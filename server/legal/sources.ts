/**
 * External legal data source integrations.
 *
 * Official/API integrations are used only when Lumi has a documented endpoint
 * and authorized credentials. Third-party legal databases and court websites
 * without a configured API are handled through authorized browser collaboration
 * plus user-confirmed material import into the knowledge base.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getKey } from '../config/keys';

// ── Cache ───────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(process.cwd(), 'data', 'legal_cache');
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(source: string, query: string): string {
  return `${source}_${Buffer.from(query).toString('base64').replace(/[/+=]/g, '_').slice(0, 80)}.json`;
}

function readCache(key: string, ttlMs = 24 * 60 * 60 * 1000): any | null {
  try {
    const file = path.join(CACHE_DIR, key);
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > ttlMs) {
      fs.unlinkSync(file);
      return null;
    }
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return null; }
}

function writeCache(key: string, data: any) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, key), JSON.stringify(data, null, 2));
}

// ── Source capability registry ─────────────────────────────────────────

export type LegalSourceAccessMode = 'api' | 'authorized_browser' | 'manual_import' | 'official_web';

export interface LegalSourceCapability {
  id: string;
  label: string;
  accessMode: LegalSourceAccessMode;
  configured: boolean;
  canAutoQuery: boolean;
  requiresAuthorization: boolean;
  boundary: string;
  nextAction: string;
}

function readSecret(name: keyof import('../config/keys').KeyStore): string {
  return (process.env[name] || getKey(name) || '').trim();
}

function qichachaConfig() {
  const appKey = readSecret('QICHACHA_APP_KEY') || readSecret('QICHACHA_API_KEY');
  const secretKey = readSecret('QICHACHA_SECRET_KEY');
  const baseUrl = (readSecret('QICHACHA_BASE_URL') || 'https://api.qichacha.com').replace(/\/+$/, '');
  return {
    appKey,
    secretKey,
    baseUrl,
    configured: Boolean(appKey && secretKey),
  };
}

export function listLegalSourceCapabilities(): LegalSourceCapability[] {
  const qcc = qichachaConfig();
  return [
    {
      id: 'qichacha',
      label: '企查查',
      accessMode: 'api',
      configured: qcc.configured,
      canAutoQuery: qcc.configured,
      requiresAuthorization: true,
      boundary: qcc.configured
        ? '已配置官方 API 凭证时，可按授权额度查询企业信息；不得超出合同、套餐和用途限制。'
        : '尚未配置官方 API 凭证，只能使用授权网页登录协作。不能承诺自动抓取或批量同步。',
      nextAction: qcc.configured
        ? '可直接调用 legal_trace_assets / legal_equity_penetration 进行 API 查询，并保存来源时间。'
        : '配置 QICHACHA_APP_KEY 与 QICHACHA_SECRET_KEY，或使用 web_login_run 打开 qichacha 登录页。',
    },
    {
      id: 'alpha-lawyer',
      label: 'Alpha',
      accessMode: 'authorized_browser',
      configured: false,
      canAutoQuery: false,
      requiresAuthorization: true,
      boundary: '未发现稳定公开 API 配置；当前按律所账号授权网页登录协作，不复制平台数据库。',
      nextAction: '使用 web_login_profile_save_from_preset / web_login_run 打开 Alpha，律师确认结果后导入 Lumi 知识库。',
    },
    {
      id: 'fachan',
      label: '法蝉',
      accessMode: 'authorized_browser',
      configured: false,
      canAutoQuery: false,
      requiresAuthorization: true,
      boundary: '当前按第三方法律平台授权网页登录协作处理，不绕过账号权限、验证码、付费墙或下载限制。',
      nextAction: '使用授权浏览器检索，律师确认摘录后由 Lumi 导入知识库。',
    },
    {
      id: 'china-judgments-online',
      label: '中国裁判文书网',
      accessMode: 'authorized_browser',
      configured: false,
      canAutoQuery: false,
      requiresAuthorization: true,
      boundary: '当前不作为平台数据 API 接入；只做官方网页授权会话、检索辅助和人工确认后的材料导入。',
      nextAction: '使用授权浏览器检索、下载或复制材料，再调用 legal_import_materials_to_kb 入库。',
    },
    {
      id: 'people-court-case-library',
      label: '人民法院案例库',
      accessMode: 'official_web',
      configured: true,
      canAutoQuery: false,
      requiresAuthorization: false,
      boundary: '按官方网页检索与人工确认处理；引用方式和适用性需由律师复核。',
      nextAction: '生成检索词并打开官网，确认后导入案例摘录或全文。',
    },
    {
      id: 'national-enterprise-credit',
      label: '国家企业信用信息公示系统',
      accessMode: 'official_web',
      configured: true,
      canAutoQuery: false,
      requiresAuthorization: false,
      boundary: '按官方网站查询处理；遇验证码、地区跳转或频控时由人工完成。',
      nextAction: '打开官方网页核验主体信息，保存查询时间、主体名称和统一社会信用代码。',
    },
  ];
}

// ── Fetch helper ────────────────────────────────────────────────────────

async function fetchWithUA(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

// ── 中国裁判文书网 (wenshu.court.gov.cn) ───────────────────────────────

export interface JudgmentSearchParams {
  keyword?: string;
  caseNumber?: string;
  court?: string;
  causeOfAction?: string;
  party?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface JudgmentResult {
  title: string;
  caseNumber: string;
  court: string;
  date: string;
  causeOfAction: string;
  parties: string;
  url: string;
}

export async function searchWenshu(params: JudgmentSearchParams): Promise<JudgmentResult[]> {
  const ck = cacheKey('wenshu', JSON.stringify(params));
  const cached = readCache(ck, 6 * 60 * 60 * 1000); // 6-hour TTL
  if (cached) return cached;

  const results: JudgmentResult[] = [];
  // 中国裁判文书网当前按授权网页登录协作处理，不作为平台数据 API 接入。
  // 律师确认后的下载文件或摘录由 legal_import_materials_to_kb 入库。
  writeCache(ck, results);
  return results;
}

// ── 国家法律法规数据库 (flk.npc.gov.cn) ───────────────────────────────

export interface StatuteSearchResult {
  title: string;
  docId: string;
  status: string;       // 现行有效 / 已修改 / 已废止
  publishDate: string;
  effectiveDate: string;
  issuingBody: string;
  url: string;
}

export async function searchFLK(keyword: string): Promise<StatuteSearchResult[]> {
  const ck = cacheKey('flk', keyword);
  const cached = readCache(ck, 24 * 60 * 60 * 1000);
  if (cached) return cached;

  const results: StatuteSearchResult[] = [];

  const html = await fetchWithUA(
    `https://flk.npc.gov.cn/search.html?keyword=${encodeURIComponent(keyword)}`,
    12000,
  );

  if (html) {
    try {
      // Try to find embedded JSON data
      const dataRe = /(?:var|let|const)\s+\w+\s*=\s*(\[[\s\S]*?\]);/;
      const match = html.match(dataRe);
      if (match) {
        const list = JSON.parse(match[1]);
        for (const item of list) {
          results.push({
            title: item.title || item.name || '',
            docId: item.id || '',
            status: item.status || item.effectiveness || '未知',
            publishDate: item.publishDate || '',
            effectiveDate: item.effectiveDate || '',
            issuingBody: item.issuingBody || '全国人民代表大会',
            url: `https://flk.npc.gov.cn/detail.html?${item.id || ''}`,
          });
        }
      }
    } catch { /* HTML parse fallback */ }
  }

  writeCache(ck, results);
  return results;
}

// ── 住建部合同模板 (mohurd.gov.cn) ─────────────────────────────────────

export interface ContractTemplate {
  title: string;
  category: string;
  url: string;
  publishDate: string;
}

const MOHURD_TEMPLATES: ContractTemplate[] = [
  { title: '建设工程施工合同（示范文本）', category: '工程建设', url: 'https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/', publishDate: '2017' },
  { title: '商品房买卖合同（预售）示范文本', category: '房地产', url: 'https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/', publishDate: '2014' },
  { title: '商品房买卖合同（现售）示范文本', category: '房地产', url: 'https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/', publishDate: '2014' },
  { title: '工程总承包合同（示范文本）', category: '工程建设', url: 'https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/', publishDate: '2020' },
  { title: '建筑工人简易劳动合同（示范文本）', category: '劳动合同', url: 'https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/', publishDate: '2024' },
  { title: '物业临时管理规约（示范文本）', category: '物业管理', url: 'https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/', publishDate: '2023' },
];

export async function searchMOHURDTemplates(keyword?: string): Promise<ContractTemplate[]> {
  if (!keyword) return MOHURD_TEMPLATES;
  const kw = keyword.toLowerCase();
  return MOHURD_TEMPLATES.filter(
    t => t.title.includes(kw) || t.category.includes(kw),
  );
}

// ── 企查查 (qcc.com) — 企业信息查询 ───────────────────────────────────

export interface CompanyInfo {
  name: string;
  legalPerson: string;
  registeredCapital: string;
  status: string;
  establishDate: string;
  unifiedCode: string;
  address: string;
  businessScope: string;
  shareholders: { name: string; ratio: number; type: string }[];
  branches: string[];
  riskInfo: {
    enforcementCount: number;
    dishonestyCount: number;
    restrictionsCount: number;
  };
  url: string;
  sourceMode?: 'api' | 'authorized_browser' | 'manual';
  sourceName?: string;
  queriedAt?: string;
}

function qichachaHeaders(config: ReturnType<typeof qichachaConfig>): Record<string, string> {
  const timespan = String(Date.now());
  const token = crypto
    .createHash('md5')
    .update(`${config.appKey}${timespan}${config.secretKey}`)
    .digest('hex');
  return {
    Token: token,
    Timespan: timespan,
    Accept: 'application/json',
  };
}

function pickQichachaResult(data: any): any {
  const result = data?.Result ?? data?.result ?? data?.Data ?? data?.data;
  if (Array.isArray(result)) return result[0];
  if (Array.isArray(result?.Result)) return result.Result[0];
  if (Array.isArray(result?.Items)) return result.Items[0];
  if (Array.isArray(result?.items)) return result.items[0];
  return result || data;
}

function mapQichachaCompany(raw: any, keyword: string): CompanyInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.Name || raw.name || raw.CompanyName || raw.companyName || raw.KeyNo || keyword;
  const keyNo = raw.KeyNo || raw.keyNo || raw.No || raw.id || encodeURIComponent(keyword);
  return {
    name,
    legalPerson: raw.OperName || raw.legalPersonName || raw.LegalPerson || raw.operName || '',
    registeredCapital: raw.RegistCapi || raw.registeredCapital || raw.RegisteredCapital || '',
    status: raw.Status || raw.regStatus || raw.StatusCode || raw.status || '',
    establishDate: raw.StartDate || raw.establishDate || raw.EstablishDate || '',
    unifiedCode: raw.CreditCode || raw.unifiedCode || raw.CreditNo || raw.No || '',
    address: raw.Address || raw.address || '',
    businessScope: raw.Scope || raw.businessScope || raw.BusinessScope || '',
    shareholders: (raw.Shareholders || raw.shareholders || raw.Partners || []).map((s: any) => ({
      name: s.Name || s.name || s.StockName || '',
      ratio: Number.parseFloat(String(s.Ratio || s.ratio || s.StockPercent || 0)) || 0,
      type: s.Type || s.type || s.StockType || '',
    })),
    branches: raw.Branches || raw.branches || [],
    riskInfo: {
      enforcementCount: Number(raw.EnforcementCount || raw.enforcementCount || raw.ZhiXingCount || 0),
      dishonestyCount: Number(raw.DishonestyCount || raw.dishonestyCount || raw.ShiXinCount || 0),
      restrictionsCount: Number(raw.RestrictionsCount || raw.restrictionsCount || raw.XianGaoCount || 0),
    },
    url: `https://www.qcc.com/firm/${keyNo}.html`,
    sourceMode: 'api',
    sourceName: '企查查开放平台 API',
    queriedAt: new Date().toISOString(),
  };
}

export async function searchCompany(keyword: string): Promise<CompanyInfo | null> {
  const ck = cacheKey('qcc', keyword);
  const cached = readCache(ck, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  const config = qichachaConfig();
  if (config.configured) {
    try {
      const endpoint = `${config.baseUrl}/ECIV4/GetBasicDetailsByName?key=${encodeURIComponent(keyword)}`;
      const res = await fetch(endpoint, {
        headers: qichachaHeaders(config),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const status = String(data?.Status || data?.status || data?.Code || data?.code || '');
        if (!status || /^200$|^0$/i.test(status)) {
          const info = mapQichachaCompany(pickQichachaResult(data), keyword);
          if (info) {
            writeCache(ck, info);
            return info;
          }
        }
      }
    } catch { /* API failed; use authorized browser workflow outside this connector */ }
  }

  return null;
}

// ── 全国法院被执行人信息 (zhixing.court.gov.cn) ───────────────────────

export interface EnforcementRecord {
  caseNumber: string;
  court: string;
  filingDate: string;
  subjectName: string;
  subjectType: string;
  executionTarget: string;
  status: string;
  url: string;
}

export async function searchEnforcementRecords(subjectName: string): Promise<EnforcementRecord[]> {
  const ck = cacheKey('zhixing', subjectName);
  const cached = readCache(ck, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  const results: EnforcementRecord[] = [];
  const html = await fetchWithUA(
    `https://zhixing.court.gov.cn/search/?searchType=1&name=${encodeURIComponent(subjectName)}`,
    12000,
  );

  if (html) {
    try {
      const dataRe = /(?:var|const|let)\s+\w+\s*=\s*(\[[\s\S]*?\]);/;
      const match = html.match(dataRe);
      if (match) {
        const list = JSON.parse(match[1]);
        for (const item of list) {
          results.push({
            caseNumber: item.caseCode || item.caseNumber || '',
            court: item.courtName || '',
            filingDate: item.filingDate || item.executionDate || '',
            subjectName: item.name || item.partyName || subjectName,
            subjectType: item.type || item.partyType || '',
            executionTarget: item.executionTarget || item.enforceAmount || '',
            status: item.status || '',
            url: `https://zhixing.court.gov.cn/detail?id=${item.id || ''}`,
          });
        }
      }
    } catch { /* parse failed */ }
  }

  writeCache(ck, results);
  return results;
}
