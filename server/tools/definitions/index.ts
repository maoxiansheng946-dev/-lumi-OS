import { ToolRegistry } from '../registry';
import { registerFileOpsTools } from './file_ops';
import { registerSystemOpsTools } from './system_ops';
import { registerWebOpsTools } from './web_tools';
import { registerCodeOpsTools } from './code_tools';
import { registerDataOpsTools } from './data_tools';
import { registerDesktopTools } from './desktop_tools';
import { registerGitTools } from './git_tools';
import { registerVerifyTools } from './verify_tools';
import { registerSkillTools, setSkillLLMGetters } from './skill_tools';
import { registerOfficeTools } from './office_tools';
import { registerCalendarTools } from './calendar_tools';
import { registerAgentTools } from './agent_tools';

export function registerAllTools(
  registry: ToolRegistry,
  llmGetters?: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI?: () => any;
    getAnthropic?: () => any;
    getQwen?: () => any;
  },
): void {
  registerFileOpsTools(registry);
  registerSystemOpsTools(registry);
  registerWebOpsTools(registry);
  registerCodeOpsTools(registry);
  registerDataOpsTools(registry);
  registerDesktopTools(registry);
  registerGitTools(registry);
  registerVerifyTools(registry);
  registerSkillTools(registry);
  registerOfficeTools(registry);
  registerCalendarTools(registry);
  registerAgentTools(registry);
  if (llmGetters) {
    setSkillLLMGetters(llmGetters);
  }
}
