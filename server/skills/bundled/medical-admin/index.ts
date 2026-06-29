import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  buildFollowUpPlan,
  buildMedicalResearchChecklist,
  buildVisitPrep,
  draftPatientInstructions,
  structureClinicalNote,
} from './logic';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: 'medical-admin', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('clinical_note_structurer', {
  description: 'Structure raw clinical notes into a SOAP-style documentation draft with missing-info checklist and explicit clinician-review boundary.',
  inputSchema: {
    rawNotes: z.string().describe('Raw visit notes, dictation, or patient summary'),
    noteType: z.enum(['soap', 'admission', 'follow_up', 'discharge']).optional().describe('Note type'),
    department: z.string().optional().describe('Department or specialty'),
  },
}, async (args: any) => ok(structureClinicalNote(args)));

server.registerTool('visit_prep_checklist', {
  description: 'Prepare a patient/clinician visit checklist: symptoms, history, medications, questions, records to bring, and urgent-signal reminders.',
  inputSchema: {
    patientGoal: z.string().optional().describe('Patient goal for the visit'),
    symptoms: z.string().optional().describe('Symptoms or current concern'),
    history: z.string().optional().describe('Relevant history'),
    medications: z.union([z.string(), z.array(z.string())]).optional().describe('Current medications'),
    questions: z.union([z.string(), z.array(z.string())]).optional().describe('Questions to ask clinician'),
  },
}, async (args: any) => ok(buildVisitPrep(args)));

server.registerTool('patient_instruction_draft', {
  description: 'Draft plain-language patient instructions from a clinician-provided plan, including teach-back prompts and safety-net language.',
  inputSchema: {
    conditionOrVisit: z.string().optional().describe('Condition, visit reason, or procedure name'),
    clinicianPlan: z.string().describe('Clinician-reviewed plan to explain'),
    readingLevel: z.enum(['plain', 'standard']).optional().describe('Plain or standard reading level'),
    language: z.string().optional().describe('Target language label'),
  },
}, async (args: any) => ok(draftPatientInstructions(args)));

server.registerTool('follow_up_plan_builder', {
  description: 'Build a follow-up checklist and message template from a visit summary, tasks, timing, and clinician-provided warning signs.',
  inputSchema: {
    visitSummary: z.string().optional().describe('Visit summary or discharge context'),
    followUpWindow: z.string().optional().describe('Follow-up timing or window'),
    tasks: z.union([z.string(), z.array(z.string())]).optional().describe('Tasks to complete before follow-up'),
    warningSigns: z.union([z.string(), z.array(z.string())]).optional().describe('Clinician-provided warning signs'),
  },
}, async (args: any) => ok(buildFollowUpPlan(args)));

server.registerTool('medical_research_checklist', {
  description: 'Turn a clinical research question into a PICO-style evidence checklist and appraisal questions. Does not provide medical advice.',
  inputSchema: {
    clinicalQuestion: z.string().describe('Clinical question to research'),
    population: z.string().optional().describe('Patient/population'),
    interventionOrExposure: z.string().optional().describe('Intervention or exposure'),
    comparison: z.string().optional().describe('Comparator'),
    outcomes: z.union([z.string(), z.array(z.string())]).optional().describe('Outcomes to evaluate'),
  },
}, async (args: any) => ok(buildMedicalResearchChecklist(args)));

const transport = new StdioServerTransport();
await server.connect(transport);
