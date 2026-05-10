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

  const bc = broadcastFn || (() => {});
  const safeName = (filename || title).replace(/[\\/:*?"<>|]/g, '_');

  bc('mcp:activity', { device: 'xiaozhi', action: 'create_ppt', status: 'started', title, slidesCount: slides.length });

  const psLines: string[] = [
    '$ppt = New-Object -ComObject PowerPoint.Application',
    '$ppt.Visible = $true',
    '$pres = $ppt.Presentations.Add()',
  ];

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const st = s.title.replace(/'/g, "''");
    psLines.push(`$s${i} = $pres.Slides.Add(${i + 1}, 1)`);
    psLines.push(`$s${i}.Shapes.Item(1).TextFrame.TextRange.Text = '${st}'`);
    if (s.bullets.length > 0) {
      const bullets = s.bullets.map(b => b.replace(/'/g, "''")).join('`n');
      psLines.push(`if ($s${i}.Shapes.Count -ge 2) { $s${i}.Shapes.Item(2).TextFrame.TextRange.Text = '${bullets}' }`);
    }
    psLines.push(`Start-Sleep -Milliseconds 800`);
  }

  psLines.push(`$desktop = [Environment]::GetFolderPath('Desktop')`);
  psLines.push(`$out = Join-Path $desktop '${safeName}.pptx'`);
  psLines.push(`$pres.SaveAs($out)`);
  psLines.push(`$pres.Close()`);
  psLines.push(`$ppt.Quit()`);
  psLines.push(`Write-Output $out`);

  const tmpFile = path.join(os.tmpdir(), `lumi_ppt_${Date.now()}.ps1`);
  fs.writeFileSync(tmpFile, psLines.join('\n'), 'utf-8');

  const { execSync } = await import('child_process');
  const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, {
    timeout: 60000,
    encoding: 'utf-8',
  });
  fs.unlinkSync(tmpFile);
  const savedPath = result.trim();

  bc('mcp:activity', { device: 'xiaozhi', action: 'create_ppt', status: 'completed', path: savedPath, slidesCount: slides.length });

  try { execSync(`start "" "${savedPath}"`, { timeout: 5000 }); } catch {}

  return `PPT created and opened: ${savedPath} (${slides.length} slides)`;
}

export function registerOfficeTools(registry: ToolRegistry): void {
  registry.register({
    name: 'create_ppt',
    description: 'Create a PowerPoint .pptx presentation file on this Windows computer. Provide a title and an array of slides (each with title and bullet points). Saves to the Desktop and opens it automatically.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Presentation title' },
        slides: {
          type: 'array',
          description: 'Array of slides',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Slide title' },
              bullets: {
                type: 'array',
                description: 'Bullet points for this slide',
                items: { type: 'string' },
              },
            },
            required: ['title', 'bullets'],
          },
        },
        filename: { type: 'string', description: 'Output filename (default: title.pptx)' },
      },
      required: ['title', 'slides'],
    },
    handler: createPptHandler,
    permission: 'user',
    securityLevel: 'safe',
  });
}
