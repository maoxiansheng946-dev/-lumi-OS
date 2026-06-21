import fs from 'fs';
import path from 'path';
import { ToolExecutionRecord } from '../tools/types';

export interface CompletionGuardResult {
  text: string;
  blocked: boolean;
  reason?: string;
}

interface CompletionGuardInput {
  task: string;
  response: string;
  toolCalls?: ToolExecutionRecord[];
  source?: string;
}

const EXTERNAL_WORK_TASK_RE =
  /\b(cad|dxf|dwg|pptx?|powerpoint|freecad|autocad|file|folder|desktop|browser|search|open|launch|save|export|install|run|execute|play|music|ocr)\b|(?:CAD|DXF|DWG|PPT|PowerPoint|FreeCAD|AutoCAD|文件|文件夹|路径|桌面|图纸|户型|平面图|装修|图片|照片|识别|提取|打开|加载|保存|导出|输出到|放到桌面|安装|运行|执行|播放|音乐)/i;

const COMPLETION_CLAIM_RE =
  /(?:任务|工作|全部|都|已经|已).{0,18}(?:完成|搞定|做好|做完)|(?:已|已经).{0,18}(?:生成|创建|保存|输出|写入|打开|加载|导出)|(?:生成好了|创建好了|保存好了|输出好了|打开了|加载好了|搞定了)|\b(?:task complete|completed successfully|created|saved|opened|exported)\b/i;

const OPEN_CLAIM_RE =
  /(?:已|已经|都).{0,12}(?:打开|加载)|(?:打开了|加载好了)|\b(?:opened|launched)\b/i;

const FILE_CREATION_CLAIM_RE =
  /(?:已|已经|都).{0,18}(?:生成|创建|保存|输出|写入|导出)|(?:生成好了|创建好了|保存好了|输出好了)|\b(?:created|saved|exported|generated)\b/i;

const INSPECTION_ONLY_TOOL_RE =
  /^(read_|list_|search_|grep_|desktop_path_info|desktop_list_files|client_get_state|adapter_health_check|usage_get_summary|calendar_|lumi_constitution|agent_list|get_|path_info)/i;

const FILE_PRODUCER_TOOL_RE =
  /(write_file|create_ppt|ppt|cad_generate|generate_.*(?:dxf|ppt|file)|export|save|document|docx|pdf|image|floorplan_extract_geometry)/i;

const OPEN_TOOL_RE =
  /^(desktop_open|client_action|computer_use|external_app_.*open|open_)/i;

const VERIFY_PASS_RE = /"status"\s*:\s*"pass"|status:\s*pass/i;

export function needsCompletionEvidence(task: string): boolean {
  return EXTERNAL_WORK_TASK_RE.test(task || '');
}

export function guardCompletionClaims(input: CompletionGuardInput): CompletionGuardResult {
  const task = input.task || '';
  const response = input.response || '';
  if (!response.trim()) return { text: response, blocked: false };

  const needsEvidence = needsCompletionEvidence(task) || EXTERNAL_WORK_TASK_RE.test(response);
  const claimsCompletion = COMPLETION_CLAIM_RE.test(response);
  if (!needsEvidence || !claimsCompletion) return { text: response, blocked: false };

  const toolCalls = input.toolCalls || [];
  const successful = toolCalls.filter(call => !call.error);
  const failed = toolCalls.filter(call => call.error);
  const hasAnySuccess = successful.length > 0;
  const hasActionTool = successful.some(call => !INSPECTION_ONLY_TOOL_RE.test(call.name));
  const hasFileProducer = successful.some(call =>
    FILE_PRODUCER_TOOL_RE.test(call.name) ||
    /File written:|written:|created:|saved:|exported:|\.dxf|\.pptx|\.docx|\.pdf|\.md/i.test(call.result || '')
  );
  const hasOpenTool = successful.some(call => OPEN_TOOL_RE.test(call.name));
  const hasPassingVerification = successful.some(call => /work_product_verify/i.test(call.name) && VERIFY_PASS_RE.test(call.result || ''));
  const pathsExist = extractLocalPaths(response)
    .some(filePath => {
      try {
        const stat = fs.statSync(filePath);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    });

  let reason = '';
  if (!hasAnySuccess) {
    reason = '这一轮没有成功执行任何工具';
  } else if (OPEN_CLAIM_RE.test(response) && !hasOpenTool) {
    reason = '回复声称已经打开或加载，但没有成功的打开/客户端动作记录';
  } else if (FILE_CREATION_CLAIM_RE.test(response) && !hasFileProducer && !hasPassingVerification) {
    reason = '回复声称已经生成或保存产物，但没有成功的写入/生成/验收记录';
  } else if (!hasActionTool && !hasPassingVerification && !pathsExist) {
    reason = '只有查询或检查记录，没有实际执行、生成、打开或验收证据';
  }

  if (!reason) return { text: response, blocked: false };

  const guardedText = buildGuardedResponse(task, reason, successful, failed);
  return { text: guardedText, blocked: true, reason };
}

function extractLocalPaths(text: string): string[] {
  const matches = text.match(/[A-Za-z]:\\[^\n\r"'<>|]+?\.(?:dxf|dwg|svg|pdf|docx|xlsx|pptx|md|txt|json|csv|png|jpe?g|webp|html)/gi) || [];
  return matches
    .map(item => path.normalize(item.trim()))
    .slice(0, 12);
}

function buildGuardedResponse(
  task: string,
  reason: string,
  successful: ToolExecutionRecord[],
  failed: ToolExecutionRecord[],
): string {
  const isZh = /[\u3400-\u9fff]/.test(task);
  const lastSuccess = successful.slice(-3).map(call => call.name).join(', ');
  const lastFailure = failed.slice(-2).map(call => `${call.name}: ${call.error}`).join('; ');

  if (!isZh) {
    return [
      `I cannot honestly mark this complete yet: ${reason}.`,
      lastSuccess ? `Verified so far: successful tools: ${lastSuccess}.` : 'Verified so far: no successful tool execution was recorded.',
      lastFailure ? `Latest blocker: ${lastFailure}.` : '',
      'Next step: continue the actual tool workflow, then verify the produced file/action before reporting completion.',
    ].filter(Boolean).join('\n');
  }

  return [
    `我还不能说这件事已经完成：${reason}。`,
    lastSuccess ? `目前能确认的成功步骤：${lastSuccess}。` : '目前没有记录到成功的工具执行。',
    lastFailure ? `最近的阻塞点：${lastFailure}。` : '',
    '下一步应该继续真实执行工具，并在文件路径、桌面动作或验收结果确认后再汇报完成。',
  ].filter(Boolean).join('\n');
}
