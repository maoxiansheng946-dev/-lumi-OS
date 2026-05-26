import { ToolRegistry } from '../registry';
import { readDB, writeDB } from '../../data/db_layer';

async function agentCreate(args: Record<string, any>, _context?: any): Promise<string> {
  const name = (args.name || '').trim();
  if (!name) return 'Error: agent name is required.';

  const category = (args.category || 'general').trim().toLowerCase();
  const skillTags: string[] = Array.isArray(args.skillTags) ? args.skillTags : [];
  const description = (args.description || '').trim();
  const executionMode = args.executionMode || 'lumi';
  const modelPreference = args.model || 'qwen-plus';
  const knowledgeDomains: string[] = Array.isArray(args.knowledgeDomains) ? args.knowledgeDomains : [];
  const autonomyLevel = args.autonomyLevel || 'reactive';

  const id = `worker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const agent: Record<string, any> = {
    id,
    name,
    category,
    config: JSON.stringify({ description, knowledgeDomains }),
    data: '{}',
    createdAt: new Date().toISOString(),
    status: 'active',
    modelPreference,
    memoryScope: 'shared',
    autonomyLevel,
    runtimeConfig: '{}',
    skillTags,
    executionMode,
    allowCrossPollination: true,
    territory: 'open',
  };

  try {
    const db = readDB();
    if (!db.agents) db.agents = [];
    db.agents.push(agent);
    writeDB(db);
    return JSON.stringify({
      ok: true,
      agent: { id, name, category, skillTags, status: 'active' },
      message: `Worker agent "${name}" created and ready. ID: ${id}`,
    });
  } catch (err: any) {
    return `Failed to create agent: ${err.message || String(err)}`;
  }
}

async function agentList(_args: Record<string, any>, context?: any): Promise<string> {
  try {
    const db = readDB();
    const userId = context?.userId;
    const agents = (db.agents || []).filter((a: any) => {
      // Filter out ephemeral agents
      if (a.id?.startsWith('ephemeral_')) return false;
      // If userId is available, show user's own + shared agents
      if (userId && a.ownerUid && a.ownerUid !== userId) return false;
      return true;
    });

    if (agents.length === 0) {
      return 'No active worker agents found. Use agent_create to spawn one when needed.';
    }

    const summary = agents.map((a: any) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      skillTags: a.skillTags || [],
      status: a.status,
      territory: a.territory || 'open',
      createdAt: a.createdAt,
    }));

    return JSON.stringify(summary, null, 2);
  } catch (err: any) {
    return `Failed to list agents: ${err.message || String(err)}`;
  }
}

async function agentTerminate(args: Record<string, any>, _context?: any): Promise<string> {
  const agentId = (args.agentId || '').trim();
  const terminateAll = args.all === true;

  try {
    const db = readDB();
    if (!db.agents) db.agents = [];

    if (terminateAll) {
      const activeAgents = db.agents.filter((a: any) => a.status === 'active');
      if (activeAgents.length === 0) {
        return 'No active agents to terminate.';
      }
      const count = activeAgents.length;
      for (const agent of db.agents) {
        if (agent.status === 'active') {
          agent.status = 'terminated';
          agent.terminatedAt = new Date().toISOString();
        }
      }
      writeDB(db);
      return JSON.stringify({
        ok: true,
        terminated: count,
        message: `Terminated all ${count} active agents.`,
      });
    }

    if (!agentId) {
      return 'Error: specify agentId or set all=true to terminate all agents.';
    }

    const agent = db.agents.find((a: any) => a.id === agentId);
    if (!agent) {
      return `Agent "${agentId}" not found.`;
    }
    if (agent.status === 'terminated') {
      return `Agent "${agentId}" is already terminated.`;
    }

    agent.status = 'terminated';
    agent.terminatedAt = new Date().toISOString();
    writeDB(db);

    return JSON.stringify({
      ok: true,
      agent: { id: agent.id, name: agent.name, status: 'terminated' },
      message: `Agent "${agent.name}" (${agent.id}) terminated.`,
    });
  } catch (err: any) {
    return `Failed to terminate agent(s): ${err.message || String(err)}`;
  }
}

export function registerAgentTools(registry: ToolRegistry): void {
  registry.register({
    name: 'agent_create',
    description:
      'Create a new permanent worker agent for Lumi\'s swarm. Use this when the user asks you to make a helper, specialist, or worker for a recurring task. The agent becomes an active member of the hive — it can be assigned sub-tasks by the orchestrator and appears in the user\'s agent list.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short, memorable name for the agent (e.g. "EmailBot", "CodeReviewer", "DataScout")' },
        category: { type: 'string', description: 'The general domain: coding, writing, research, data, media, automation, etc.' },
        skillTags: { type: 'array', items: { type: 'string' }, description: 'Specific skill tags for task matching (e.g. ["python", "data-analysis"])' },
        description: { type: 'string', description: 'What this agent specializes in — used as its internal config' },
        executionMode: { type: 'string', description: 'Thinking mode: lumi (default), scholar, founder, or zen' },
        model: { type: 'string', description: 'Preferred LLM model (default: qwen-plus)' },
        knowledgeDomains: { type: 'array', items: { type: 'string' }, description: 'Knowledge domains for RAG routing' },
        autonomyLevel: { type: 'string', description: 'reactive (on-demand only), scheduled (periodic checks), or autonomous (self-triggering)' },
      },
      required: ['name'],
    },
    handler: agentCreate,
    permission: 'user',
    securityLevel: 'confirm',
  });

  registry.register({
    name: 'agent_list',
    description:
      'List all active worker agents in Lumi\'s swarm. Use this to show the user what agents currently exist, their skills, and status.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: agentList,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'agent_terminate',
    description:
      'Terminate one or all active agents. Set agentId to terminate a specific agent, or set all=true to terminate every active agent at once. Terminated agents are marked as status="terminated" and will no longer appear in agent_list.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of the agent to terminate (optional if all=true)' },
        all: { type: 'boolean', description: 'Set to true to terminate ALL active agents at once' },
      },
      required: [],
    },
    handler: agentTerminate,
    permission: 'user',
    securityLevel: 'confirm',
  });
}
