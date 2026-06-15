import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import {
  getSession,
  removeSession,
  updateHeartbeat,
  validateHandshake,
  buildHandshakeResponse,
} from './session';
import {
  delegateTask,
  updateTaskStatus,
  getTask,
  getTasksForAgent,
  buildTaskListResponse,
  cancelTasksForSession,
} from './delegate';
import { shareContext, getActiveSharedContexts, removeSharedContexts } from './context';
import type {
  LAPAgentIdentity,
  LAPRequest,
  LAPMessage,
  LAPScope,
} from './types';

// Local agent identity — configurable per LumiOS instance
let localAgent: LAPAgentIdentity = {
  agentId: `agent_${randomUUID().slice(0, 8)}`,
  userId: 'local_user',
  name: 'Lumi',
  capabilities: ['chat', 'code', 'search', 'memory', 'file_ops', 'web_search', 'desktop', 'lap_collaboration', 'task_delegation'],
  publicKey: '',
  publicProfile: {
    displayName: 'Lumi',
    description: 'Local-first desktop Lumi instance with scoped LAP collaboration.',
    trustTags: ['local-first', 'user-owned', 'permissioned'],
  },
};

export function setLocalAgent(identity: Partial<LAPAgentIdentity>): void {
  localAgent = { ...localAgent, ...identity };
}

export function getLocalAgent(): LAPAgentIdentity {
  return localAgent;
}

type LAPMessageHandler = (request: LAPRequest, ws: WebSocket) => Promise<void>;

const handlers: Map<string, LAPMessageHandler> = new Map();

export function registerHandler(method: string, handler: LAPMessageHandler): void {
  handlers.set(method, handler);
}

// ── Default handlers ──

registerHandler('lap.handshake', async (req, ws) => {
  const request = req as import('./types').LAPHandshakeRequest;
  const validation = validateHandshake(request, localAgent);
  if (!validation.valid) {
    sendLAPResponse(ws, {
      accepted: false,
      reason: validation.reason,
      sessionId: '',
      agent: localAgent,
      trustLevel: 'public',
      scope: [],
    });
    return;
  }
  const response = buildHandshakeResponse(request, localAgent, validation.trustLevel!, request.proposedScope);
  sendLAPResponse(ws, response);
  console.log(`[LAP] Handshake complete: ${localAgent.agentId} ↔ ${request.agent.agentId} (session: ${response.sessionId})`);
});

registerHandler('lap.task.delegate', async (req, ws) => {
  const request = req as import('./types').LAPTaskDelegateRequest;
  const session = getSession(request.sessionId);
  if (!session) {
    sendLAPResponse(ws, { accepted: false, taskId: request.task.taskId, reason: 'Session not found' });
    return;
  }
  updateHeartbeat(request.sessionId);
  const response = delegateTask(request, session);
  sendLAPResponse(ws, response);
  if (response.accepted) {
    console.log(`[LAP] Task delegated: "${request.task.type}" → ${session.peerB.name}`);
  }
});

registerHandler('lap.task.result', async (req, ws) => {
  const request = req as import('./types').LAPTaskResultRequest;
  const session = getSession(request.sessionId);
  if (!session) {
    sendLAPResponse(ws, { acknowledged: false });
    return;
  }
  updateHeartbeat(request.sessionId);
  updateTaskStatus(request.taskId, request.status, request.output, request.error);
  sendLAPResponse(ws, { acknowledged: true });
  console.log(`[LAP] Task ${request.taskId} → ${request.status}`);
});

registerHandler('lap.context.share', async (req, ws) => {
  const request = req as import('./types').LAPContextShareRequest;
  const session = getSession(request.sessionId);
  if (!session) {
    sendLAPResponse(ws, { accepted: false, acceptedEntries: 0, rejectedEntries: request.contexts.length, reason: 'Session not found' });
    return;
  }
  updateHeartbeat(request.sessionId);
  const response = shareContext(request, session);
  sendLAPResponse(ws, response);
});

registerHandler('lap.revoke', async (req, ws) => {
  const request = req as import('./types').LAPRevokeRequest;
  let affected = 0;
  if (request.scope === 'all' || request.scope === 'session') {
    const session = getSession(request.sessionId);
    if (session) {
      affected += cancelTasksForSession(request.sessionId);
      affected += removeSharedContexts(request.sessionId);
      removeSession(request.sessionId);
    }
  } else if (request.scope === 'delegate') {
    affected += cancelTasksForSession(request.sessionId);
  } else if (request.scope === 'context') {
    affected += removeSharedContexts(request.sessionId);
  }
  sendLAPResponse(ws, { revoked: true, affectedTasks: [`${affected} resources cleaned`] as any });
  console.log(`[LAP] Revoked session ${request.sessionId}: ${affected} resources (reason: ${request.reason})`);
});

registerHandler('lap.heartbeat', async (req, ws) => {
  const request = req as import('./types').LAPHeartbeatRequest;
  const session = getSession(request.sessionId);
  if (session) updateHeartbeat(request.sessionId);
  sendLAPResponse(ws, { alive: !!session, serverTime: new Date().toISOString() });
});

// ── Message helpers ──

function sendLAPResponse(ws: WebSocket, payload: Record<string, any>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ lap: '2.0', ...payload }));
  }
}

async function dispatchLAPMessage(data: Buffer, ws: WebSocket): Promise<void> {
  let msg: Record<string, any>;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    ws.send(JSON.stringify({ error: 'Invalid JSON', lap: '2.0' }));
    return;
  }

  const method = msg.method as string;
  if (!method) {
    ws.send(JSON.stringify({ error: 'Missing method', lap: '2.0' }));
    return;
  }

  const handler = handlers.get(method);
  if (!handler) {
    ws.send(JSON.stringify({ error: `Unknown method: ${method}`, lap: '2.0', supportedMethods: Array.from(handlers.keys()) }));
    return;
  }

  try {
    await handler(msg as LAPRequest, ws);
  } catch (err: any) {
    console.error(`[LAP] Handler error for ${method}:`, err.message);
    ws.send(JSON.stringify({ error: `Handler error: ${err.message}`, lap: '2.0' }));
  }
}

// ── WebSocket server setup ──

export function attachLAPWebSocket(server: any, path = '/lap'): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === path) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientId = randomUUID().slice(0, 8);
    console.log(`[LAP] Client connected: ${clientId} (${req.socket.remoteAddress})`);

    ws.on('message', (data: Buffer) => dispatchLAPMessage(data, ws));

    ws.on('close', () => {
      console.log(`[LAP] Client disconnected: ${clientId}`);
    });

    ws.on('error', (err) => {
      console.error(`[LAP] WebSocket error (${clientId}):`, err.message);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      lap: '2.0',
      method: 'lap.welcome',
      agent: localAgent,
      supportedMethods: Array.from(handlers.keys()),
    }));
  });

  console.log(`[LAP] WebSocket transport ready at ws://0.0.0.0:${(server.address as any)?.()?.port || '?'}${path}`);
  return wss;
}

// ── Re-export query helpers for API routes ──

export { getSession } from './session';
export { getTask, getTasksForAgent, buildTaskListResponse } from './delegate';
export { getActiveSharedContexts } from './context';
