import os from 'os';
import fs from 'fs';
import path from 'path';
import { ToolRegistry } from '../registry';

let broadcastFn: ((event: string, data: any) => void) | null = null;

export function setOfficeBroadcast(fn: (event: string, data: any) => void) {
  broadcastFn = fn;
}

async function createPptHandler(args: Record<string, any>): Promise<string> {
  const title = args.title as string;
  const slides = args.slides as Array<{ title: string; bullets: string[] }>;
  const filename = args.filename as string | undefined;
  const theme = (args.theme as string) || 'blue';

  if (!title || !slides || !Array.isArray(slides) || slides.length === 0) {
    return 'Error: title and slides (non-empty array) are required. Example: {"title":"My PPT","slides":[{"title":"Slide 1","bullets":["point 1","point 2"]}]}';
  }

  const bc = broadcastFn || (() => {});
  let safeName = (filename || title).replace(/[\\/:*?"<>|]/g, '_');
  // Prevent double .pptx extension
  if (safeName.toLowerCase().endsWith('.pptx')) safeName = safeName.slice(0, -5);

  bc('mcp:activity', { device: 'xiaozhi', action: 'create_ppt', status: 'started', title, slidesCount: slides.length });

  // Modern color palettes in BGR (PowerPoint COM uses BGR order)
  const palettes: Record<string, { primary: number; dark: number; accent: number; bg: number; text: number; white: number }> = {
    blue:    { primary: 12890260, dark: 6590047, accent: 3243501, bg: 15921906, text: 3342387, white: 16777215 },
    teal:    { primary: 10343923, dark: 4017014, accent: 5231711, bg: 15921906, text: 3342387, white: 16777215 },
    purple:  { primary: 12369024, dark: 5245013, accent: 8738143, bg: 15921906, text: 3342387, white: 16777215 },
    dark:    { primary: 3355443, dark: 1315860, accent: 12890260, bg: 1579032, text: 15658734, white: 16777215 },
  };
  const c = palettes[theme] || palettes.blue;

  const psLines: string[] = [
    // Color helper: RGB(r,g,b) → BGR int
    'function RGB($r,$g,$b) { return [int]($b*65536 + $g*256 + $r) }',
    '',
    '$ppt = New-Object -ComObject PowerPoint.Application',
    '$ppt.Visible = $true',
    '$pres = $ppt.Presentations.Add()',
    // 16:9 aspect ratio
    '$pres.PageSetup.SlideSize = 13', // ppSlideSizeOnScreen16x9
    '$pres.PageSetup.SlideWidth = 960',
    '$pres.PageSetup.SlideHeight = 540',
    // Default slide will be deleted after title slide is added (need ≥2 slides to delete one)
    '',
    // Define slide dimensions
    '$W = 960; $H = 540',
    // Colors
    `$C1 = ${c.primary}; $C2 = ${c.dark}; $C3 = ${c.accent}; $C4 = ${c.bg}; $C5 = ${c.text}; $C6 = ${c.white}`,
    '',
    'function AddShape($slide, $type, $L, $T, $W, $H, $fillColor, $text, $fontSize, $fontColor, $bold) {',
    '  $s = $slide.Shapes.AddShape($type, $L, $T, $W, $H)',
    '  $s.Fill.ForeColor.RGB = $fillColor',
    '  $s.Line.Visible = $false',
    '  $s.TextFrame.WordWrap = $true',
    '  if ($text) {',
    '    $s.TextFrame.TextRange.Text = $text',
    '    $s.TextFrame.TextRange.Font.Name = "Microsoft YaHei"',
    '    if ($fontSize) { $s.TextFrame.TextRange.Font.Size = $fontSize }',
    '    if ($fontColor -ne $null) { $s.TextFrame.TextRange.Font.Color.RGB = $fontColor }',
    '    if ($bold) { $s.TextFrame.TextRange.Font.Bold = $true }',
    '  }',
    '  return $s',
    '}',
    '',
    'function AddTextBox($slide, $L, $T, $W, $H, $text, $fontSize, $fontColor, $bold, $alignment) {',
    '  $s = $slide.Shapes.AddTextbox(1, $L, $T, $W, $H)',
    '  $s.TextFrame.WordWrap = $true',
    '  $s.TextFrame.TextRange.Text = $text',
    '  $s.TextFrame.TextRange.Font.Name = "Microsoft YaHei"',
    '  if ($fontSize) { $s.TextFrame.TextRange.Font.Size = $fontSize }',
    '  if ($fontColor -ne $null) { $s.TextFrame.TextRange.Font.Color.RGB = $fontColor }',
    '  if ($bold) { $s.TextFrame.TextRange.Font.Bold = $true }',
    '  if ($alignment) { $s.TextFrame.TextRange.ParagraphFormat.Alignment = $alignment }',
    '  return $s',
    '}',
    '',
    // ═══ TITLE SLIDE ═══
    '$cover = $pres.Slides.Add(1, 12)', // blank layout
    // Full-slide dark background
    `AddShape $cover 1 0 0 $W $H $C2 "" 0 0 $false`,
    // Large colored rectangle in center
    `AddShape $cover 1 80 160 800 280 $C1 "" 0 0 $false`,
    // Title text on colored background
    `AddTextBox $cover 120 175 720 100 '${esc(title)}' 36 $C6 $true 1`,
    // Accent underline
    `AddShape $cover 1 310 290 340 6 $C3 "" 0 0 $false`,
    // Subtitle line
    `AddTextBox $cover 120 315 720 40 '${esc(slides.length + ' parts · Lumi AI Generated')}' 14 (RGB 180 180 180) $false 1`,
    // Bottom-right small accent
    `AddShape $cover 1 880 500 80 40 $C1 "" 0 0 $false`,
    // Remove the default slide that came with the presentation
    '$pres.Slides[2].Delete()',
  ];

  // ═══ CONTENT SLIDES ═══
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const slideName = `$s${i}`;
    const slideNum = i + 2;

    // Escape single quotes in text
    const st = esc(s.title);
    const bullets = s.bullets.map(b => esc(b));

    psLines.push(
      '',
      `# === Slide ${i + 1}: ${st} ===`,
      `${slideName} = $pres.Slides.Add(${slideNum}, 12)`,
      // White background
      `AddShape ${slideName} 1 0 0 $W $H $C6 "" 0 0 $false`,
      // Top colored bar
      `AddShape ${slideName} 1 0 0 $W 8 $C1 "" 0 0 $false`,
      // Left accent bar
      `AddShape ${slideName} 1 60 100 6 340 $C1 "" 0 0 $false`,
      // Slide number circle
      `$c${i} = AddShape ${slideName} 9 890 480 40 40 $C1 "${slideNum}" 18 $C6 $true`,
      `$c${i}.TextFrame.TextRange.ParagraphFormat.Alignment = 1`,
      // Title
      `AddTextBox ${slideName} 90 40 780 50 '${st}' 26 $C2 $true 0`,
      // Accent line under title
      `AddShape ${slideName} 1 90 95 120 4 $C3 "" 0 0 $false`,
    );

    // Bullet points
    if (bullets.length > 0) {
      const yStart = 130;
      const lineHeight = Math.min(48, Math.floor(380 / bullets.length));
      for (let b = 0; b < bullets.length; b++) {
        const y = yStart + b * lineHeight;
        const bulletText = bullets[b];
        // Bullet dot
        psLines.push(`AddShape ${slideName} 9 110 ${y + 6} 10 10 $C3 "" 0 0 $false`);
        // Bullet text
        psLines.push(`AddTextBox ${slideName} 140 ${y} 760 ${lineHeight} '${bulletText}' 16 $C5 $false 0`);
      }
    }
  }

  // ═══ ENDING SLIDE ═══
  const endSlideNum = slides.length + 2;
  psLines.push(
    '',
    '# === Ending Slide ===',
    `$end = $pres.Slides.Add(${endSlideNum}, 12)`,
    `AddShape $end 1 0 0 $W $H $C2 "" 0 0 $false`,
    `AddShape $end 1 80 180 800 240 $C1 "" 0 0 $false`,
    `AddTextBox $end 120 200 720 80 'Thank You' 40 $C6 $true 1`,
    `AddShape $end 1 350 310 260 6 $C3 "" 0 0 $false`,
    `AddTextBox $end 120 335 720 50 '${esc(title)}' 18 (RGB 200 200 210) $false 1`,
  );

  psLines.push(
    '',
    `$desktop = [Environment]::GetFolderPath('Desktop')`,
    `$out = Join-Path $desktop '${safeName}.pptx'`,
    `$pres.SaveAs($out)`,
    `$pres.Close()`,
    `$ppt.Quit()`,
    `Write-Output $out`,
  );

  const tmpFile = path.join(os.tmpdir(), `lumi_ppt_${Date.now()}.ps1`);
  // UTF-8 BOM: PowerShell reads BOM-prefixed files as UTF-8, preventing CJK garbled text
  fs.writeFileSync(tmpFile, '﻿' + psLines.join('\n'), 'utf-8');

  const { execSync } = await import('child_process');
  // Pipe through PowerShell, capturing only the last output line (file path)
  const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "$o = & '${tmpFile}'; $o[-1]"`, {
    timeout: 60000,
    encoding: 'utf-8',
  });
  fs.unlinkSync(tmpFile);
  // Extract just the saved path (last non-empty line from Write-Output)
  const lines = result.trim().split(/\r?\n/);
  const savedPath = lines[lines.length - 1].trim();

  bc('mcp:activity', { device: 'xiaozhi', action: 'create_ppt', status: 'completed', path: savedPath, slidesCount: slides.length });

  try { execSync(`start "" "${savedPath}"`, { timeout: 5000 }); } catch {}

  return `PPT created and opened: ${savedPath} (${slides.length} slides)`;
}

/** Escape single quotes for PowerShell string literals */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

export function registerOfficeTools(registry: ToolRegistry): void {
  registry.register({
    name: 'create_ppt',
    description: 'Create a professionally-designed PowerPoint .pptx presentation. Generates modern slides with colored backgrounds, accent bars, custom typography, title slide, bullet formatting, and an ending slide. Provide a title, slides array, and optional theme (blue/teal/purple/dark).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Presentation title (appears on cover slide)' },
        slides: {
          type: 'array',
          description: 'Array of content slides',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Slide heading' },
              bullets: {
                type: 'array',
                description: 'Bullet points for this slide',
                items: { type: 'string' },
              },
            },
            required: ['title', 'bullets'],
          },
        },
        filename: { type: 'string', description: 'Output .pptx filename (default: <title>.pptx)' },
        theme: { type: 'string', description: 'Color theme: blue, teal, purple, or dark (default: blue)' },
      },
      required: ['title', 'slides'],
    },
    handler: createPptHandler,
    permission: 'user',
    securityLevel: 'safe',
  });
}
