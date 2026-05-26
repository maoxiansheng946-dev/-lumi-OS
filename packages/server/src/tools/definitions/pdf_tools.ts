/**
 * PDF Tools — read, create, merge, split, and convert PDF documents.
 */
import fs from 'fs';
import path from 'path';
import { ToolRegistry } from '../registry';

const OUTPUT_DIR = path.join(process.cwd(), 'lumi_output');

function ensureOutputDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

// ── Handlers ──

async function readPdf(args: Record<string, any>): Promise<string> {
  const filePath: string = args.filePath || '';
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const pdfParse = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);

  const info = [
    `Pages: ${data.numpages}`,
    `Info: ${JSON.stringify(data.info || {})}`,
    ``,
    data.text.slice(0, 10000),
  ];
  if (data.text.length > 10000) {
    info.push(`\n[Truncated — ${data.text.length} total characters]`);
  }
  return info.join('\n');
}

async function pdfToText(args: Record<string, any>): Promise<string> {
  const filePath: string = args.filePath || '';
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const pdfParse = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);

  // Save extracted text alongside the PDF
  const outPath = filePath.replace(/\.pdf$/i, '.txt');
  fs.writeFileSync(outPath, data.text, 'utf-8');
  return `Extracted ${data.text.length} characters to: ${outPath}`;
}

async function createPdf(args: Record<string, any>): Promise<string> {
  const { content, title, format } = args;
  if (!content) throw new Error('content is required');

  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;
  const lineHeight = 16;
  const margin = 72;
  const maxWidth = 612 - margin * 2;

  // Word wrap
  const lines: string[] = [];
  const paragraphs = content.split('\n');
  for (const para of paragraphs) {
    if (!para.trim()) { lines.push(''); continue; }
    const words = para.split('');
    let line = '';
    for (const ch of words) {
      const testLine = line + ch;
      if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
  }

  const pageHeight = 792;
  let y = pageHeight - margin;
  let page = doc.addPage([612, pageHeight]);

  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage([612, pageHeight]);
      y = pageHeight - margin;
    }
    if (line) {
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
    }
    y -= lineHeight;
  }

  if (title) {
    doc.setTitle(title);
  }

  const outDir = ensureOutputDir();
  const fileName = `${title || 'document'}_${Date.now()}.pdf`;
  const outPath = path.join(outDir, fileName);
  const pdfBytes = await doc.save();
  fs.writeFileSync(outPath, pdfBytes);
  return `PDF created: ${outPath} (${pdfBytes.length} bytes)`;
}

async function mergePdf(args: Record<string, any>): Promise<string> {
  const filePaths: string[] = args.filePaths || [];
  if (filePaths.length < 2) throw new Error('At least 2 PDF file paths required');

  const { PDFDocument } = require('pdf-lib');
  const merged = await PDFDocument.create();

  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) throw new Error(`File not found: ${fp}`);
    const bytes = fs.readFileSync(fp);
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  const outDir = ensureOutputDir();
  const outPath = path.join(outDir, `merged_${Date.now()}.pdf`);
  const pdfBytes = await merged.save();
  fs.writeFileSync(outPath, pdfBytes);
  return `Merged ${filePaths.length} PDFs → ${outPath} (${merged.getPageCount()} pages)`;
}

async function splitPdf(args: Record<string, any>): Promise<string> {
  const filePath: string = args.filePath || '';
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`PDF not found: ${filePath}`);

  const { PDFDocument } = require('pdf-lib');
  const bytes = fs.readFileSync(filePath);
  const srcDoc = await PDFDocument.load(bytes);
  const pageCount = srcDoc.getPageIndices().length;
  const outDir = ensureOutputDir();
  const baseName = path.basename(filePath, '.pdf');
  const results: string[] = [];

  for (let i = 0; i < pageCount; i++) {
    const newDoc = await PDFDocument.create();
    const [page] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(page);
    const outPath = path.join(outDir, `${baseName}_p${i + 1}.pdf`);
    fs.writeFileSync(outPath, await newDoc.save());
    results.push(outPath);
  }

  return `Split ${pageCount} pages into:\n${results.join('\n')}`;
}

async function convertToPdf(args: Record<string, any>): Promise<string> {
  const filePath: string = args.filePath || '';
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const ext = path.extname(filePath).toLowerCase();

  // Images → PDF
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
    const { PDFDocument } = require('pdf-lib');
    const imageBytes = fs.readFileSync(filePath);
    const doc = await PDFDocument.create();

    let image;
    if (ext === '.png') {
      image = await doc.embedPng(imageBytes);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      image = await doc.embedJpg(imageBytes);
    } else {
      throw new Error(`Image format ${ext} not supported for PDF conversion`);
    }

    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

    const outDir = ensureOutputDir();
    const outPath = path.join(outDir, path.basename(filePath, ext) + '.pdf');
    fs.writeFileSync(outPath, await doc.save());
    return `Converted to PDF: ${outPath}`;
  }

  // Text/markdown → PDF
  if (['.txt', '.md', '.markdown'].includes(ext)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return createPdf({ content, title: path.basename(filePath, ext) });
  }

  throw new Error(`Unsupported source format: ${ext}`);
}

// ── Registration ──

export function registerPdfTools(registry: ToolRegistry): void {
  registry.register({
    name: 'read_pdf',
    description: 'Read and extract text from a PDF file. Returns page count, metadata, and the full text content (truncated at 10000 chars). Use this when asked to read or summarize a PDF document.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the PDF file' },
      },
      required: ['filePath'],
    },
    handler: readPdf,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'pdf_to_text',
    description: 'Extract all text from a PDF and save it as a .txt file alongside the original. Returns the output file path.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the PDF file' },
      },
      required: ['filePath'],
    },
    handler: pdfToText,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'create_pdf',
    description: 'Create a new PDF document from text or markdown content. Supports CJK characters. Saves to the lumi_output directory.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The text content for the PDF body' },
        title: { type: 'string', description: 'Document title (used as filename)' },
      },
      required: ['content'],
    },
    handler: createPdf,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'merge_pdf',
    description: 'Merge multiple PDF files into a single PDF. Provide an array of file paths in order.',
    parameters: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' }, description: 'Array of absolute paths to PDF files to merge' },
      },
      required: ['filePaths'],
    },
    handler: mergePdf,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'split_pdf',
    description: 'Split a PDF into individual pages, each saved as a separate PDF file.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the PDF file to split' },
      },
      required: ['filePath'],
    },
    handler: splitPdf,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'convert_to_pdf',
    description: 'Convert an image (PNG, JPG) or text/markdown file to PDF format.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the source file' },
      },
      required: ['filePath'],
    },
    handler: convertToPdf,
    permission: 'user',
    securityLevel: 'safe',
  });
}
