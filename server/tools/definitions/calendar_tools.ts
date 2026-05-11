import { ToolRegistry } from '../registry';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Windows Calendar & Email tools using Outlook COM automation via PowerShell.
 * These are safe-level tools that read and compose from the user's Outlook.
 */

async function outlookCalendarToday(_args: Record<string, any>, _context?: any): Promise<string> {
  const psScript = `
$outlook = New-Object -ComObject Outlook.Application
$ns = $outlook.GetNamespace("MAPI")
$calendar = $ns.GetDefaultFolder(9)
$today = (Get-Date).Date
$tomorrow = $today.AddDays(1)
$items = $calendar.Items
$items.IncludeRecurrences = $true
$items.Sort("[Start]")
$found = @()
foreach ($item in $items) {
  if ($item.Start -ge $today -and $item.Start -lt $tomorrow) {
    $found += [PSCustomObject]@{
      Subject = $item.Subject
      Start = $item.Start.ToString("HH:mm")
      End = $item.End.ToString("HH:mm")
      Location = $item.Location
      Duration = [math]::Round(($item.End - $item.Start).TotalMinutes)
    }
  }
}
if ($found.Count -eq 0) { Write-Output "No events scheduled for today." }
else { $found | ConvertTo-Json -Compress }
$outlook.Quit()
`;
  return runPowerShell(psScript, 'calendar_today');
}

async function outlookUpcomingEvents(args: Record<string, any>, _context?: any): Promise<string> {
  const days = args.days || 7;
  const psScript = `
$outlook = New-Object -ComObject Outlook.Application
$ns = $outlook.GetNamespace("MAPI")
$calendar = $ns.GetDefaultFolder(9)
$today = (Get-Date).Date
$end = $today.AddDays(${days})
$items = $calendar.Items
$items.IncludeRecurrences = $true
$items.Sort("[Start]")
$found = @()
foreach ($item in $items) {
  if ($item.Start -ge $today -and $item.Start -lt $end) {
    $found += [PSCustomObject]@{
      Subject = $item.Subject
      Start = $item.Start.ToString("yyyy-MM-dd HH:mm")
      End = $item.End.ToString("yyyy-MM-dd HH:mm")
      Location = $item.Location
    }
  }
  if ($found.Count -ge 30) { break }
}
if ($found.Count -eq 0) { Write-Output "No upcoming events in the next ${days} days." }
else { $found | ConvertTo-Json -Compress }
$outlook.Quit()
`;
  return runPowerShell(psScript, 'upcoming_events');
}

async function outlookSendEmail(args: Record<string, any>, _context?: any): Promise<string> {
  const to = (args.to || '').replace(/'/g, "''");
  const subject = (args.subject || 'No Subject').replace(/'/g, "''");
  const body = (args.body || '').replace(/'/g, "''");

  // Escape for PowerShell here-string
  const psScript = `
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.To = '${to}'
$mail.Subject = '${subject}'
$mail.Body = @'
${body}
'@
$mail.Save()
$mail.Send()
$outlook.Quit()
Write-Output "Email sent to ${to}"
`;
  return runPowerShell(psScript, 'send_email');
}

async function outlookRecentEmails(args: Record<string, any>, _context?: any): Promise<string> {
  const limit = Math.min(args.limit || 5, 20);
  const psScript = `
$outlook = New-Object -ComObject Outlook.Application
$ns = $outlook.GetNamespace("MAPI")
$inbox = $ns.GetDefaultFolder(6)
$items = $inbox.Items
$items.Sort("[ReceivedTime]", $true)
$found = @()
$count = 0
foreach ($item in $items) {
  if ($count -ge ${limit}) { break }
  $found += [PSCustomObject]@{
    From = $item.SenderName
    Subject = $item.Subject
    Received = $item.ReceivedTime.ToString("yyyy-MM-dd HH:mm")
    Unread = $item.UnRead
  }
  $count++
}
if ($found.Count -eq 0) { Write-Output "Inbox is empty." }
else { $found | ConvertTo-Json -Compress }
$outlook.Quit()
`;
  return runPowerShell(psScript, 'recent_emails');
}

function runPowerShell(script: string, toolName: string): string {
  const tmpFile = join(tmpdir(), `lumi_${toolName}_${Date.now()}.ps1`);
  try {
    writeFileSync(tmpFile, script, 'utf-8');
    const result = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { timeout: 20000, encoding: 'utf-8', maxBuffer: 1024 * 1024 },
    );
    return result.trim() || `Tool "${toolName}" completed with no output.`;
  } catch (err: any) {
    const msg = err.stderr || err.message || 'Unknown error';
    if (msg.includes('Outlook') || msg.includes('COM')) {
      return `Outlook is not available. Please ensure Microsoft Outlook is installed and configured. (${msg.slice(0, 100)})`;
    }
    return `Calendar/email tool error: ${msg.slice(0, 200)}`;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export function registerCalendarTools(registry: ToolRegistry): void {
  registry.register({
    name: 'calendar_today',
    description:
      'Get today\'s calendar events from Microsoft Outlook. Returns a list of scheduled meetings and appointments with times and locations.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: outlookCalendarToday,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'upcoming_events',
    description:
      'Get upcoming calendar events from Microsoft Outlook for the specified number of days. Default is 7 days. Useful for checking what\'s coming up.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to look ahead (default: 7, max: 30)' },
      },
      required: [],
    },
    handler: outlookUpcomingEvents,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'send_email',
    description:
      'Compose and send an email via Microsoft Outlook. Requires Outlook to be installed and configured with an email account.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (plain text)' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: outlookSendEmail,
    permission: 'user',
    securityLevel: 'confirm',
  });

  registry.register({
    name: 'recent_emails',
    description:
      'List recent emails from the Microsoft Outlook inbox. Returns sender, subject, and received time.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of emails to retrieve (default: 5, max: 20)' },
      },
      required: [],
    },
    handler: outlookRecentEmails,
    permission: 'user',
    securityLevel: 'safe',
  });
}
