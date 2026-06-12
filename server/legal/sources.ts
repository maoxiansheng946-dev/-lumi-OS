/**
 * External legal data source integrations.
 *
 * Level 1 (free, public): 中国裁判文书网, 国家法律法规数据库,
 *   住建部合同模板, 全国法院被执行人信息
 * Level 2 (paid, optional): 企查查 API, 天眼查
 */
import fs from 'fs';
import path from 'path';

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

/**
 * Search China Judgments Online.
 * NOTE: wenshu.court.gov.cn requires CAPTCHA and session cookies for programmatic access.
 * This is a best-effort public search. For production use, consider the official
 * bulk data subscription or third-tier court API.
 */
export async function searchWenshu(params: JudgmentSearchParams): Promise<JudgmentResult[]> {
  const ck = cacheKey('wenshu', JSON.stringify(params));
  const cached = readCache(ck, 6 * 60 * 60 * 1000); // 6-hour TTL
  if (cached) return cached;

  const results: JudgmentResult[] = [];

  // Construct search URL for wenshu website
  const qParts: string[] = [];
  if (params.keyword) qParts.push(params.keyword);
  if (params.caseNumber) qParts.push(params.caseNumber);
  if (params.party) qParts.push(params.party);
  if (params.court) qParts.push(params.court);

  if (qParts.length > 0) {
    const q = encodeURIComponent(qParts.join(' '));
    // Use the list page — will return HTML requiring parsing
    const html = await fetchWithUA(
      `https://wenshu.court.gov.cn/website/wenshu/181217BMTKHNT2W0/index.html?searchKeyword=${q}`,
      12000,
    );

    if (html) {
      // Extract JSON-LD or embedded data if available
      try {
        const dataRe = /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/;
        const match = html.match(dataRe);
        if (match) {
          const data = JSON.parse(match[1]);
          const items = data?.result?.list || data?.list || [];
          for (const item of items) {
            results.push({
              title: item.caseName || item.title || '',
              caseNumber: item.caseCode || item.caseNo || '',
              court: item.courtName || '',
              date: item.judgeDate || '',
              causeOfAction: item.caseCause || '',
              parties: item.party || '',
              url: `https://wenshu.court.gov.cn/website/wenshu/${item.docId || ''}`,
            });
          }
        }
      } catch { /* HTML parse fallback — extract visible case list */ }
    }
  }

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
}

export async function searchCompany(keyword: string): Promise<CompanyInfo | null> {
  const ck = cacheKey('qcc', keyword);
  const cached = readCache(ck, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  const apiKey = process.env.QICHACHA_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(`https://api.qcc.com/Company/Search?key=${encodeURIComponent(keyword)}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const company = data?.Result ?? data;
        const info: CompanyInfo = {
          name: company.Name || company.companyName || keyword,
          legalPerson: company.OperName || company.legalPersonName || '',
          registeredCapital: company.RegistCapi || company.registeredCapital || '',
          status: company.Status || company.regStatus || '',
          establishDate: company.StartDate || company.establishDate || '',
          unifiedCode: company.CreditCode || company.unifiedCode || '',
          address: company.Address || company.address || '',
          businessScope: company.Scope || company.businessScope || '',
          shareholders: (company.Shareholders || company.shareholders || []).map((s: any) => ({
            name: s.Name || s.name || '',
            ratio: s.Ratio || s.ratio || 0,
            type: s.Type || s.type || '',
          })),
          branches: company.Branches || company.branches || [],
          riskInfo: {
            enforcementCount: company.EnforcementCount || 0,
            dishonestyCount: company.DishonestyCount || 0,
            restrictionsCount: company.RestrictionsCount || 0,
          },
          url: `https://www.qcc.com/firm/${keyword}.html`,
        };
        writeCache(ck, info);
        return info;
      }
    } catch { /* API failed, fall through to public scraping */ }
  }

  // Public web search fallback — scrape QCC public page
  const html = await fetchWithUA(
    `https://www.qcc.com/web/search?key=${encodeURIComponent(keyword)}`,
    12000,
  );
  if (html) {
    try {
      const dataRe = /window\.__NUXT__\s*=\s*({[\s\S]*?});/;
      const match = html.match(dataRe);
      if (match) {
        const data = JSON.parse(match[1]);
        const result = data?.data?.searchResult?.[0] || data?.state?.data?.searchResult?.[0];
        if (result) {
          const info: CompanyInfo = {
            name: result.name || keyword,
            legalPerson: result.operName || '',
            registeredCapital: result.registCapi || '',
            status: result.status || result.regStatus || '',
            establishDate: result.startDate || '',
            unifiedCode: result.creditCode || '',
            address: result.address || '',
            businessScope: result.businessScope || '',
            shareholders: [],
            branches: [],
            riskInfo: { enforcementCount: 0, dishonestyCount: 0, restrictionsCount: 0 },
            url: `https://www.qcc.com/firm/${result.keyNo || keyword}.html`,
          };
          writeCache(ck, info);
          return info;
        }
      }
    } catch { /* parse failed */ }
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
