import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BrainCircuit, Wrench, CheckCircle2, XCircle, MessageSquare, ChevronRight } from 'lucide-react';

export interface WorkflowStep {
  id: string;
  type: 'thinking' | 'tool_start' | 'tool_result' | 'response' | 'error';
  text: string;
  time: number;
  detail?: string;
}

interface WorkflowPanelProps {
  visible: boolean;
  agentStatus: 'idle' | 'thinking' | 'executing' | 'done' | 'error';
  steps: WorkflowStep[];
}

function StatusLights({ status }: { status: WorkflowPanelProps['agentStatus'] }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-3 h-3 rounded-full transition-all duration-500 ${
          status === 'thinking'
            ? 'bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.6)] animate-pulse'
            : 'bg-white/10'
        }`}
        style={status === 'thinking' ? { animationDuration: '1.5s' } : undefined}
      />
      <div
        className={`w-3 h-3 rounded-full transition-all duration-500 ${
          status === 'executing'
            ? 'bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.6)] animate-pulse'
            : 'bg-white/10'
        }`}
        style={status === 'executing' ? { animationDuration: '0.8s' } : undefined}
      />
      <div
        className={`w-3 h-3 rounded-full transition-all duration-500 ${
          status === 'done'
            ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]'
            : status === 'error'
              ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)] animate-pulse'
              : 'bg-white/10'
        }`}
        style={status === 'error' ? { animationDuration: '0.4s' } : undefined}
      />
    </div>
  );
}

function StatusLabel({ status }: { status: WorkflowPanelProps['agentStatus'] }) {
  const label =
    status === 'thinking' ? 'Thinking...' :
    status === 'executing' ? 'Executing tools...' :
    status === 'done' ? 'Done' :
    status === 'error' ? 'Error' :
    'Idle';
  const color =
    status === 'thinking' ? 'text-yellow-400' :
    status === 'executing' ? 'text-green-400' :
    status === 'done' ? 'text-red-400' :
    status === 'error' ? 'text-red-500' :
    'text-white/30';
  return <span className={`text-[10px] font-black uppercase tracking-widest ${color}`}>{label}</span>;
}

function StepIcon({ type }: { type: WorkflowStep['type'] }) {
  switch (type) {
    case 'thinking':
      return <BrainCircuit size={12} className="text-yellow-400 shrink-0" />;
    case 'tool_start':
      return <Wrench size={12} className="text-blue-400 shrink-0" />;
    case 'tool_result':
      return <CheckCircle2 size={12} className="text-green-400 shrink-0" />;
    case 'response':
      return <MessageSquare size={12} className="text-purple-400 shrink-0" />;
    case 'error':
      return <XCircle size={12} className="text-red-400 shrink-0" />;
  }
}

export default function WorkflowPanel({ visible, agentStatus, steps }: WorkflowPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [steps.length]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          className="fixed top-24 left-1/2 -translate-x-1/2 z-[70] w-[380px] max-w-[calc(100vw-2rem)] pointer-events-auto"
        >
          <div className="p-4 rounded-2xl bg-black/80 backdrop-blur-2xl border border-white/10 space-y-3">
            {/* Header with breathing lights */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusLights status={agentStatus} />
                <StatusLabel status={agentStatus} />
              </div>
              <span className="text-[8px] text-white/20 font-mono">
                {steps.length > 0 ? `${steps.length} steps` : ''}
              </span>
            </div>

            {/* Step log */}
            {steps.length > 0 && (
              <div
                ref={listRef}
                className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar pr-1"
              >
                {steps.map((step) => (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-start gap-2 text-[10px] text-white/60"
                  >
                    <StepIcon type={step.type} />
                    <div className="min-w-0 flex-1">
                      <span className="text-white/80">{step.text}</span>
                      {step.detail && (
                        <div className="text-white/30 truncate mt-0.5">{step.detail}</div>
                      )}
                    </div>
                    {step.type === 'tool_start' && (
                      <ChevronRight size={10} className="text-white/20 shrink-0 mt-0.5" />
                    )}
                  </motion.div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {steps.length === 0 && (
              <div className="text-[10px] text-white/20 text-center py-4">
                Waiting for agent activity...
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
