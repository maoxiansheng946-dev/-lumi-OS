import { normalizeOperationMode } from './operation_modes';

const TOOL_INTENT_PATTERNS: RegExp[] = [
  /\b(open|launch|start|run|execute|call\s+(?:a\s+)?tool|use\s+(?:a\s+)?tool|tool\s+call|search|look\s+up|browse|fetch|read\s+(?:file|screen|folder|directory)|scan|screenshot|screen\s*shot|click|type|copy|paste|write|save|create|export|delete|remove|install|uninstall|play|pause|resume|download|upload|sync|build|test|commit|push|deploy)\b/i,
  /(?:\u6253\u5f00|\u542f\u52a8|\u5f00\u542f|\u8fd0\u884c|\u6267\u884c|\u8c03\u7528\u5de5\u5177|\u5de5\u5177\u8c03\u7528|\u641c\u7d22|\u8054\u7f51|\u6d4f\u89c8|\u8bbf\u95ee|\u67e5\u627e\u6587\u4ef6|\u8bfb\u53d6\u6587\u4ef6|\u622a\u56fe|\u622a\u5c4f|\u70b9\u51fb|\u8f93\u5165|\u590d\u5236|\u7c98\u8d34|\u64ad\u653e|\u653e.*(?:\u6b4c|\u97f3\u4e50)|\u6682\u505c\u97f3\u4e50|\u7ee7\u7eed\u64ad\u653e|\u4e0b\u8f7d|\u4e0a\u4f20|\u540c\u6b65|\u5b89\u88c5|\u5378\u8f7d|\u63d0\u4ea4|\u63a8\u9001|\u90e8\u7f72|\u6784\u5efa|\u6d4b\u8bd5)/u,
  /(?:\u521b\u5efa|\u65b0\u5efa|\u751f\u6210|\u5bfc\u51fa|\u4fdd\u5b58|\u5199\u5165|\u7f16\u8f91|\u4fee\u6539|\u5220\u9664|\u6574\u7406|\u5206\u6790).*(?:\u6587\u4ef6|\u6587\u4ef6\u5939|\u76ee\u5f55|\u6587\u6863|\u62a5\u544a|\u8868\u683c|\u4ee3\u7801|\u9879\u76ee|\u5e94\u7528|\u7a0b\u5e8f|\u7f51\u9875|\u7f51\u7ad9|\u94fe\u63a5|\u753b\u5e03|\u5de5\u4f5c\u6d41|\u811a\u672c|\u7ec8\u7aef|\u547d\u4ee4|\u4ed3\u5e93|github|\u6570\u636e\u5e93|\u77e5\u8bc6\u5e93|\u6a21\u677f|\u7ec4\u7ec7|\u8bbe\u7f6e|\u8bbe\u5907|\u5c4f\u5e55)/iu,
];

const AUTONOMOUS_TASK_PATTERNS: RegExp[] = [
  /\b(plan|build|design|draft|prepare|organize|analyze|review|research|implement|refactor|generate|create)\b.*\b(project|report|doc|document|deck|presentation|code|repo|workflow|canvas|workspace|team|agent|files?)\b/i,
  /(?:规划|搭建|设计|准备|整理|分析|审查|研究|实现|重构|生成|创建|制作).*(?:项目|报告|文档|方案|代码|仓库|工作流|画布|团队|智能体|文件|资料)/u,
];

export function hasExplicitToolIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function shouldAllowToolUseForTurn(text: string, source?: string, operationMode?: string): boolean {
  if (source === 'canvas') return true;
  const mode = normalizeOperationMode(operationMode);
  if (mode === 'chat' || mode === 'meeting') return false;
  if (mode === 'autonomous' && AUTONOMOUS_TASK_PATTERNS.some((pattern) => pattern.test(text.trim()))) return true;
  if (hasExplicitToolIntent(text)) return true;
  return false;
}

export function shouldExposeAgentWork(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return [
    /\b(team|teammate|sub-?agent|worker agent|multi-?agent|orchestrator|orchestration|delegate|assign|crew)\b/i,
    /(?:\u56e2\u961f|\u5b50\s*agent|\u5b50\u667a\u80fd\u4f53|\u591a\s*agent|\u591a\u667a\u80fd\u4f53|\u7ec4\u5efa|\u7ec4\u961f|\u7f16\u6392|\u5206\u6d3e|\u5206\u914d|\u4ea4\u7ed9.*(?:\u5904\u7406|\u505a)|\u8c03\u5ea6|\u7ec4\u4ef6\u56e2\u961f)/u,
  ].some((pattern) => pattern.test(normalized));
}
