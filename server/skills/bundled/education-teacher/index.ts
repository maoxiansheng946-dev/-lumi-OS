import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  buildLearningProfile,
  buildLessonPlan,
  buildQuizOutline,
  buildRubric,
  draftParentMessage,
} from './logic';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: 'education-teacher', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('lesson_plan_builder', {
  description: 'Build a teacher-facing lesson plan with objectives, timed flow, differentiation, assessment, and homework.',
  inputSchema: {
    subject: z.string().optional().describe('Subject, e.g. math, Chinese, English, science'),
    grade: z.string().optional().describe('Grade or learner level'),
    topic: z.string().describe('Lesson topic'),
    durationMinutes: z.number().optional().describe('Class duration in minutes'),
    objectives: z.union([z.string(), z.array(z.string())]).optional().describe('Learning objectives'),
    materials: z.union([z.string(), z.array(z.string())]).optional().describe('Materials or resources'),
    classProfile: z.string().optional().describe('Class context, levels, needs, or known constraints'),
    constraints: z.string().optional().describe('Time, exam, classroom, policy, or technology constraints'),
  },
}, async (args: any) => ok(buildLessonPlan(args)));

server.registerTool('assignment_rubric_builder', {
  description: 'Create a grading rubric with criteria, point distribution, performance levels, and teacher grading notes.',
  inputSchema: {
    assignment: z.string().describe('Assignment name or description'),
    grade: z.string().optional().describe('Grade or learner level'),
    criteria: z.union([z.string(), z.array(z.string())]).optional().describe('Rubric criteria'),
    totalPoints: z.number().optional().describe('Total points. Default 100.'),
  },
}, async (args: any) => ok(buildRubric(args)));

server.registerTool('quiz_outline_generator', {
  description: 'Generate a quiz blueprint with question types, prompts, answer-key guidance, and balance checks.',
  inputSchema: {
    topic: z.string().describe('Quiz topic'),
    grade: z.string().optional().describe('Grade or learner level'),
    questionCount: z.number().optional().describe('Number of questions, 3-30'),
    difficulty: z.enum(['easy', 'mixed', 'hard']).optional().describe('Difficulty mix'),
    questionTypes: z.union([z.string(), z.array(z.string())]).optional().describe('Question types to include'),
  },
}, async (args: any) => ok(buildQuizOutline(args)));

server.registerTool('student_learning_profile', {
  description: 'Summarize learning-support signals from teacher notes and scores, then suggest non-diagnostic support steps and parent summary draft.',
  inputSchema: {
    studentName: z.string().optional().describe('Student name'),
    notes: z.string().describe('Teacher observations, homework notes, classroom behavior, or tutoring notes'),
    recentScores: z.string().optional().describe('Recent score or assessment notes'),
    goal: z.string().optional().describe('Target learning goal'),
  },
}, async (args: any) => ok(buildLearningProfile(args)));

server.registerTool('parent_message_draft', {
  description: 'Draft a factual parent communication message for progress, concern, behavior, homework, or celebration.',
  inputSchema: {
    studentName: z.string().optional().describe('Student name'),
    situation: z.string().describe('Situation or observation to communicate'),
    tone: z.enum(['warm', 'firm', 'celebratory', 'concerned']).optional().describe('Communication tone'),
    nextStep: z.string().optional().describe('Next step or requested cooperation'),
  },
}, async (args: any) => ok(draftParentMessage(args)));

const transport = new StdioServerTransport();
await server.connect(transport);
