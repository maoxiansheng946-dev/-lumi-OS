/**
 * Document Parsing Tools — read DOCX, XLSX, and extract text for RAG ingestion.
 */
import fs from 'fs';
import path from 'path';
import { ToolRegistry } from '../registry';
import { ingestDocument } from '../../agents/rag';

async function readDocx(args: Record<string, any>): Promise<string> {
  const filePath: string = args.filePath || '';
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`DOCX file not found: ${filePath}`);
  }

  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value.slice(0, 15000);
  let output = result.value;
  if (result.value.length > 15000) {
    output = result.value.slice(0, 15000) + `\n\n[Truncated — ${result.value.length} total characters]`;
  }
  if (result.messages?.length) {
    output += '\n\nWarnings: ' + result.messages.join('; ');
  }
  return output;
}

async function readXlsx(args: Record<string, any>): Promise<string> {
  const filePath: string = args.filePath || '';
  const sheetName: string = args.sheetName || '';
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`XLSX file not found: ${filePath}`);
  }

  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;

  if (sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found. Available: ${sheetNames.join(', ')}`);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `Sheet: ${sheetName}\n\n${csv.slice(0, 10000)}`;
  }

  // Return summary of all sheets
  const results: string[] = [`Workbook has ${sheetNames.length} sheet(s): ${sheetNames.join(', ')}`];
  for (const name of sheetNames.slice(0, 5)) {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    results.push(`\n=== ${name} ===\n${csv.slice(0, 3000)}`);
    if (csv.length > 3000) results.push(`[Truncated — ${csv.length} total chars]`);
  }
  return results.join('\n');
}

async function extractDocumentText(args: Record<string, any>): Promise<string> {
  const filePath: string = args.filePath || '';
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const ext = path.extname(filePath).toLowerCase();
  let text: string;

  switch (ext) {
    case '.docx':
      const mammoth = require('mammoth');
      text = (await mammoth.extractRawText({ path: filePath })).value;
      break;
    case '.xlsx':
    case '.xls':
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      text = wb.SheetNames.map((n: string) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]);
        return `[${n}]\n${csv}`;
      }).join('\n\n');
      break;
    case '.pdf':
      const pdfParse = require('pdf-parse');
      text = (await pdfParse(fs.readFileSync(filePath))).text;
      break;
    case '.txt':
    case '.md':
    case '.csv':
      text = fs.readFileSync(filePath, 'utf-8');
      break;
    default:
      throw new Error(`Unsupported format: ${ext}. Supported: .docx, .xlsx, .xls, .pdf, .txt, .md, .csv`);
  }

  return text;
}

async function ingestDocumentToRag(args: Record<string, any>, context?: any): Promise<string> {
  const filePath: string = args.filePath || '';
  const agentId: string = args.agentId || '';
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  if (!agentId) throw new Error('agentId is required for RAG ingestion');

  const userId = context?.userId || 'system';
  const title = args.title || path.basename(filePath);
  const text = await extractDocumentText({ filePath });
  const count = await ingestDocument(userId, agentId, title, text);

  return `Ingested "${title}" into agent ${agentId}: ${count} chunks stored.`;
}

export function registerDocumentTools(registry: ToolRegistry): void {
  registry.register({
    name: 'read_docx',
    description: 'Read and extract text from a .docx Word document. Returns the full text content.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the .docx file' },
      },
      required: ['filePath'],
    },
    handler: readDocx,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'read_xlsx',
    description: 'Read and extract data from an Excel .xlsx spreadsheet. Specify sheetName or get a summary of all sheets.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the .xlsx file' },
        sheetName: { type: 'string', description: 'Optional: specific sheet name to read' },
      },
      required: ['filePath'],
    },
    handler: readXlsx,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'extract_document_text',
    description: 'Auto-detect document format and extract text. Supports .docx, .xlsx, .pdf, .txt, .md, .csv. Use this when you need to read any document without knowing its format in advance.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the document' },
      },
      required: ['filePath'],
    },
    handler: extractDocumentText,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'ingest_document_to_rag',
    description: 'Read a document (.docx, .pdf, .xlsx, .txt, .md) and ingest it into an agent\'s RAG knowledge base. The document is chunked and stored as searchable memories scoped to the specified agent.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the document' },
        agentId: { type: 'string', description: 'Target agent ID for knowledge storage' },
        title: { type: 'string', description: 'Optional title override (defaults to filename)' },
      },
      required: ['filePath', 'agentId'],
    },
    handler: ingestDocumentToRag,
    permission: 'user',
    securityLevel: 'safe',
  });
}
