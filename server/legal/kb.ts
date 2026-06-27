/**
 * Legal Knowledge Base Engine — extends org KB with legal-specific capabilities:
 * case similarity search, statute validation, citation tracking, legal-aware chunking.
 *
 * Built on top of the existing org KB infrastructure (org/db.ts, org/kb.ts).
 * All data stored in org_kb_articles + org_kb_embeddings with legal metadata.
 */
import * as EDB from '../org/db';
import { generateEmbedding, cosineSimilarity } from '../memory/store';
import { chunkLegalText } from './parser';
import { LUMI_EMBEDDING_MODEL } from './types';

// ── Legal Article Types ──────────────────────────────────────────────────

export type LegalArticleType =
  | 'judgment'
  | 'statute'
  | 'contract'
  | 'bid_template'
  | 'legal_opinion'
  | 'case_material'
  | 'evidence'
  | 'pleading'
  | 'transcript'
  | 'research_note'
  | 'company_report';

export interface LegalArticleMeta {
  articleType: LegalArticleType;
  caseNumber?: string;
  court?: string;
  parties?: string[];
  causeOfAction?: string;
  judgmentDate?: string;
  statutesCited?: string[];
  jurisdiction?: string;
  effectiveDate?: string;
  repealedDate?: string;
  /** Whether this statute is still in effect */
  isEffective?: boolean;
}

// ── Create / Index Legal Article ────────────────────────────────────────

export function createLegalArticle(
  orgId: string,
  authorId: string,
  data: { title: string; content: string; category?: string; tags?: string[]; articleType: LegalArticleType; metadata?: LegalArticleMeta },
) {
  const tags = data.tags || [];
  tags.push(`legal:${data.articleType}`);
  if (data.metadata?.caseNumber) tags.push(`case:${data.metadata.caseNumber}`);
  if (data.metadata?.jurisdiction) tags.push(`jurisdiction:${data.metadata.jurisdiction}`);

  return EDB.createKbArticle(orgId, authorId, {
    title: data.title,
    content: data.content,
    category: data.category || `legal_${data.articleType}`,
    tags,
  });
}

export async function indexLegalArticle(orgId: string, articleId: string): Promise<number> {
  const article = EDB.getKbArticle(orgId, articleId);
  if (!article) return 0;

  EDB.deleteKbEmbeddings(articleId);

  const chunks = chunkLegalText(article.content, 800, 150);
  if (chunks.length === 0) return 0;

  let indexed = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await generateEmbedding(chunks[i]);
      if (embedding) {
        EDB.saveKbEmbedding(articleId, i, embedding, chunks[i], LUMI_EMBEDDING_MODEL);
        indexed++;
      }
      if (i > 0 && i % 5 === 0) {
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`[LegalKB] Failed to embed chunk ${i} of ${articleId}:`, err);
    }
  }

  return indexed;
}

// ── Case Similarity Search ──────────────────────────────────────────────

export interface CaseResult {
  articleId: string;
  title: string;
  caseNumber?: string;
  court?: string;
  chunk: string;
  score: number;
  date?: string;
}

export async function searchSimilarCases(
  orgId: string,
  query: string,
  limit = 5,
): Promise<CaseResult[]> {
  const allEmbeddings = EDB.getAllKbEmbeddings(orgId);
  if (allEmbeddings.length === 0) return [];

  // Only search judgment-type articles
  const judgmentArticles = EDB.listKbArticles(orgId, { category: 'legal_judgment' });
  const judgmentIds = new Set(judgmentArticles.map(a => a.id));
  const relevantEmbeddings = allEmbeddings.filter(e => judgmentIds.has(e.articleId));
  if (relevantEmbeddings.length === 0) return [];

  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await generateEmbedding(query);
  } catch {
    return [];
  }
  if (!queryEmbedding) return [];

  const results = relevantEmbeddings
    .map(emb => {
      let vec: number[];
      try { vec = JSON.parse(emb.embedding); } catch { return null; }
      return { ...emb, score: cosineSimilarity(queryEmbedding!, vec) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results.map(r => {
    const article = judgmentArticles.find(a => a.id === r.articleId);
    let tags: string[] = [];
    try { tags = JSON.parse(article?.tags || '[]'); } catch {}
    const caseNum = tags.find(t => t.startsWith('case:'))?.replace('case:', '');
    const court = tags.find(t => t.startsWith('jurisdiction:'))?.replace('jurisdiction:', '');

    return {
      articleId: r.articleId,
      title: article?.title || '(unknown)',
      caseNumber: caseNum,
      court,
      chunk: r.content,
      score: Math.round(r.score * 1000) / 1000,
      date: article?.createdAt,
    };
  });
}

// ── Statute Search & Validation ─────────────────────────────────────────

export interface StatuteResult {
  articleId: string;
  title: string;
  chunk: string;
  score: number;
  isEffective: boolean;
  content?: string;
}

/** Built-in database of commonly referenced PRC statutes with status */
const STATUTE_REGISTRY: Record<string, { title: string; effective: boolean; repealedDate?: string }> = {
  '民法典': { title: '中华人民共和国民法典', effective: true },
  '刑法': { title: '中华人民共和国刑法', effective: true },
  '刑事诉讼法': { title: '中华人民共和国刑事诉讼法', effective: true },
  '民事诉讼法': { title: '中华人民共和国民事诉讼法', effective: true },
  '行政诉讼法': { title: '中华人民共和国行政诉讼法', effective: true },
  '公司法': { title: '中华人民共和国公司法（2023修订）', effective: true },
  '合同法': { title: '中华人民共和国合同法', effective: false, repealedDate: '2021-01-01' },
  '物权法': { title: '中华人民共和国物权法', effective: false, repealedDate: '2021-01-01' },
  '侵权责任法': { title: '中华人民共和国侵权责任法', effective: false, repealedDate: '2021-01-01' },
  '婚姻法': { title: '中华人民共和国婚姻法', effective: false, repealedDate: '2021-01-01' },
  '继承法': { title: '中华人民共和国继承法', effective: false, repealedDate: '2021-01-01' },
  '民法通则': { title: '中华人民共和国民法通则', effective: false, repealedDate: '2021-01-01' },
  '担保法': { title: '中华人民共和国担保法', effective: false, repealedDate: '2021-01-01' },
  '劳动合同法': { title: '中华人民共和国劳动合同法', effective: true },
  '知识产权法': { title: '中华人民共和国著作权法', effective: true },
  '商标法': { title: '中华人民共和国商标法', effective: true },
  '专利法': { title: '中华人民共和国专利法', effective: true },
  '反不正当竞争法': { title: '中华人民共和国反不正当竞争法', effective: true },
  '消费者权益保护法': { title: '中华人民共和国消费者权益保护法', effective: true },
  '企业破产法': { title: '中华人民共和国企业破产法', effective: true },
  '证券法': { title: '中华人民共和国证券法', effective: true },
  '招标投标法': { title: '中华人民共和国招标投标法', effective: true },
  '政府采购法': { title: '中华人民共和国政府采购法', effective: true },
  '民法典婚姻家庭编': { title: '中华人民共和国民法典 第五编 婚姻家庭', effective: true },
  '民法典继承编': { title: '中华人民共和国民法典 第六编 继承', effective: true },
  '民法典合同编': { title: '中华人民共和国民法典 第三编 合同', effective: true },
  '民法典物权编': { title: '中华人民共和国民法典 第二编 物权', effective: true },
  '民法典侵权责任编': { title: '中华人民共和国民法典 第七编 侵权责任', effective: true },
};

export async function searchStatutes(
  orgId: string,
  query: string,
  limit = 5,
): Promise<StatuteResult[]> {
  const results: StatuteResult[] = [];

  // 1. Check built-in registry first
  for (const [key, info] of Object.entries(STATUTE_REGISTRY)) {
    if (query.includes(key) || key.includes(query) || info.title.includes(query)) {
      results.push({
        articleId: `statute:${key}`,
        title: info.title,
        chunk: `${info.title}${info.effective ? ' — 现行有效' : ` — 已废止${info.repealedDate ? `（${info.repealedDate}起）` : ''}`}`,
        score: 1.0,
        isEffective: info.effective,
      });
    }
  }

  // 2. Search local KB for statute articles
  const statuteArticles = EDB.listKbArticles(orgId, { category: 'legal_statute' });
  if (statuteArticles.length > 0) {
    const allEmbeddings = EDB.getAllKbEmbeddings(orgId);
    const statuteIds = new Set(statuteArticles.map(a => a.id));
    const relevant = allEmbeddings.filter(e => statuteIds.has(e.articleId));

    if (relevant.length > 0) {
      let queryEmb: number[] | null = null;
      try { queryEmb = await generateEmbedding(query); } catch { /* empty */ }

      if (queryEmb) {
        const semantic = relevant
          .map(emb => {
            let vec: number[];
            try { vec = JSON.parse(emb.embedding); } catch { return null; }
            return { ...emb, score: cosineSimilarity(queryEmb!, vec) };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null && s.score > 0.3)
          .sort((a, b) => b.score - a.score);

        for (const s of semantic) {
          const article = statuteArticles.find(a => a.id === s.articleId);
          if (article && !results.find(r => r.articleId === article.id)) {
            let tags: string[] = [];
            try { tags = JSON.parse(article.tags || '[]'); } catch {}
            const effective = !tags.includes('repealed');
            results.push({
              articleId: article.id,
              title: article.title,
              chunk: s.content,
              score: Math.round(s.score * 1000) / 1000,
              isEffective: effective,
            });
          }
        }
      }
    }
  }

  return results.slice(0, limit);
}

// ── Citation Verification ───────────────────────────────────────────────

export interface CitationCheck {
  citation: string;
  type: 'statute' | 'case';
  exists: boolean;
  isEffective: boolean | null;
  source: string;
  detail: string;
}

export function verifyCitation(citation: string, orgId?: string): CitationCheck {
  // Check if it's a statute citation
  const statuteMatch = citation.match(/《([^》]+)》/);
  if (statuteMatch) {
    const statuteName = statuteMatch[1].trim();
    const found = Object.values(STATUTE_REGISTRY).find(
      s => s.title.includes(statuteName) || statuteName.includes(s.title),
    );
    if (found) {
      return {
        citation,
        type: 'statute',
        exists: true,
        isEffective: found.effective,
        source: '国家法律法规数据库 (flk.npc.gov.cn)',
        detail: found.effective
          ? `${found.title} 现行有效`
          : `${found.title} 已于${found.repealedDate || '民法典施行日'}废止，请引用民法典相关条款`,
      };
    }
    return {
      citation,
      type: 'statute',
      exists: false,
      isEffective: null,
      source: '',
      detail: `未在已知法条库中找到《${statuteName}》，请核实法条名称是否准确。`,
    };
  }

  // Check if it's a case number citation: (2024)京0105民初12345号
  const caseMatch = citation.match(/[（(]\d{4}[）)].*?[号字]/);
  if (caseMatch && orgId) {
    const articles = EDB.listKbArticles(orgId, { category: 'legal_judgment' });
    const found = articles.find(a => {
      try {
        const tags = JSON.parse(a.tags || '[]');
        return tags.some((t: string) => t.includes(caseMatch[0]));
      } catch { return false; }
    });
    if (found) {
      return {
        citation,
        type: 'case',
        exists: true,
        isEffective: null,
        source: found.title,
        detail: `案号存在，已收录于知识库。`,
      };
    }
    return {
      citation,
      type: 'case',
      exists: false,
      isEffective: null,
      source: '',
      detail: `案号 ${caseMatch[0]} 未在本地知识库中找到，建议在中国裁判文书网核实。`,
    };
  }

  return {
    citation,
    type: 'statute',
    exists: false,
    isEffective: null,
    source: '',
    detail: '无法识别引用格式，请提供法条名称（《XX法》）或案号。',
  };
}

// ── Batch Citation Verification ─────────────────────────────────────────

export function verifyMultipleCitations(text: string, orgId?: string): CitationCheck[] {
  const checks: CitationCheck[] = [];

  // Find all 《...》 statute citations
  const statuteRe = /《([^》]+)》/g;
  let m: RegExpExecArray | null;
  while ((m = statuteRe.exec(text)) !== null) {
    checks.push(verifyCitation(m[0], orgId));
  }

  // Find all case number patterns
  const caseRe = /[（(]\d{4}[）)][^号]*[号字]/g;
  let cm: RegExpExecArray | null;
  while ((cm = caseRe.exec(text)) !== null) {
    if (!checks.find(c => c.citation === cm![0])) {
      checks.push(verifyCitation(cm[0], orgId));
    }
  }

  return checks;
}
