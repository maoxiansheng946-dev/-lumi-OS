function splitList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '').split(/\n|,|;|，|；/).map(s => s.trim()).filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function words(text: string): string[] {
  return String(text || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/u).filter(Boolean);
}

export function buildLessonPlan(args: {
  subject?: string;
  grade?: string;
  topic?: string;
  durationMinutes?: number;
  objectives?: string | string[];
  materials?: string | string[];
  classProfile?: string;
  constraints?: string;
}) {
  const duration = clamp(Number(args.durationMinutes || 45), 20, 180);
  const objectives = splitList(args.objectives);
  const materials = splitList(args.materials);
  const practiceMinutes = Math.max(8, Math.round(duration * 0.32));
  const explainMinutes = Math.max(8, Math.round(duration * 0.28));
  const reviewMinutes = Math.max(5, Math.round(duration * 0.12));

  return {
    subject: args.subject || 'general subject',
    grade: args.grade || 'mixed level',
    topic: args.topic || 'lesson topic',
    durationMinutes: duration,
    learningObjectives: objectives.length > 0 ? objectives : [
      `Understand the core concept of ${args.topic || 'the lesson topic'}.`,
      'Apply the concept through guided and independent practice.',
      'Explain the reasoning process using clear examples.',
    ],
    lessonFlow: [
      { phase: 'Warm-up', minutes: Math.max(5, Math.round(duration * 0.1)), activity: 'Activate prior knowledge with one quick prompt or mini problem.' },
      { phase: 'Direct instruction', minutes: explainMinutes, activity: 'Introduce the concept, vocabulary, model example, and common mistake.' },
      { phase: 'Guided practice', minutes: practiceMinutes, activity: 'Students practice with teacher prompts, peer checks, and immediate correction.' },
      { phase: 'Independent task', minutes: Math.max(6, duration - explainMinutes - practiceMinutes - reviewMinutes - 5), activity: 'Short task that shows whether each objective is reachable.' },
      { phase: 'Exit check', minutes: reviewMinutes, activity: 'One question, one reflection, and one misconception check.' },
    ],
    materials,
    differentiation: [
      'Prepare a scaffolded version with hints, sentence starters, or worked examples.',
      'Prepare an extension task that asks students to transfer the idea to a new case.',
      'Use quick checks to decide who needs reteaching, paired support, or enrichment.',
    ],
    assessment: [
      'Exit ticket tied to the first objective.',
      'Observe one process skill during guided practice.',
      'Collect one independent response for error-pattern review.',
    ],
    homework: `Short reinforcement task for ${args.topic || 'the lesson topic'} plus one reflection question.`,
    contextNotes: {
      classProfile: args.classProfile || '',
      constraints: args.constraints || '',
    },
  };
}

export function buildRubric(args: {
  assignment?: string;
  grade?: string;
  criteria?: string | string[];
  totalPoints?: number;
}) {
  const totalPoints = clamp(Number(args.totalPoints || 100), 10, 1000);
  const criteria = splitList(args.criteria);
  const selected = criteria.length > 0 ? criteria : ['Understanding', 'Accuracy', 'Evidence or process', 'Communication', 'Completion'];
  const base = Math.floor(totalPoints / selected.length);
  const remainder = totalPoints - base * selected.length;

  return {
    assignment: args.assignment || 'assignment',
    grade: args.grade || 'mixed level',
    totalPoints,
    rubric: selected.map((criterion, idx) => ({
      criterion,
      points: base + (idx < remainder ? 1 : 0),
      excellent: `Consistently demonstrates ${criterion.toLowerCase()} with clear, accurate, independent work.`,
      proficient: `Usually demonstrates ${criterion.toLowerCase()} with minor gaps or teacher prompts.`,
      developing: `Partially demonstrates ${criterion.toLowerCase()} but needs clearer reasoning or correction.`,
      beginning: `Shows limited evidence of ${criterion.toLowerCase()} and needs reteaching or support.`,
    })),
    gradingNotes: [
      'Grade evidence of learning, not handwriting, speed, or personality.',
      'Mark one strength and one next step for each student.',
      'Keep late-work, effort, and behavior policies separate from academic criteria when possible.',
    ],
  };
}

export function buildQuizOutline(args: {
  topic?: string;
  grade?: string;
  questionCount?: number;
  difficulty?: 'easy' | 'mixed' | 'hard';
  questionTypes?: string | string[];
}) {
  const count = clamp(Number(args.questionCount || 8), 3, 30);
  const types = splitList(args.questionTypes);
  const pool = types.length > 0 ? types : ['recall', 'application', 'explain reasoning', 'error correction'];
  const topic = args.topic || 'lesson topic';

  return {
    topic,
    grade: args.grade || 'mixed level',
    difficulty: args.difficulty || 'mixed',
    questions: Array.from({ length: count }, (_, idx) => {
      const type = pool[idx % pool.length];
      return {
        number: idx + 1,
        type,
        prompt: `Create a ${type} question about ${topic} for ${args.grade || 'the target learners'}.`,
        answerKeyGuidance: `Expected answer should show the core idea of ${topic}, not just a memorized phrase.`,
      };
    }),
    balanceCheck: [
      'Include at least one misconception check.',
      'Include at least one item that requires explanation.',
      'Keep reading load appropriate for the grade level.',
    ],
  };
}

export function buildLearningProfile(args: {
  studentName?: string;
  notes?: string;
  recentScores?: string;
  goal?: string;
}) {
  const text = `${args.notes || ''}\n${args.recentScores || ''}`;
  const tokens = words(text);
  const flags = {
    attendance: /absent|attendance|迟到|缺勤|出勤/.test(text),
    homework: /homework|assignment|作业|未交|missing/.test(text),
    confidence: /confidence|anxious|焦虑|不敢|信心/.test(text),
    accuracy: /accuracy|mistake|wrong|错误|粗心|正确率/.test(text),
    reading: /reading|vocab|阅读|词汇|读/.test(text),
  };

  return {
    studentName: args.studentName || 'student',
    goal: args.goal || 'Improve learning consistency and targeted mastery.',
    observedSignals: {
      noteLength: tokens.length,
      flags,
    },
    strengthsToConfirm: [
      'Identify one topic or task type where the student already succeeds.',
      'Look for effort, participation, organization, or peer-help moments, not only scores.',
    ],
    possibleGaps: Object.entries(flags).filter(([, value]) => value).map(([key]) => key),
    supportPlan: [
      'Pick one measurable goal for the next 2 weeks.',
      'Use short daily practice or retrieval checks instead of large catch-up tasks.',
      'Give the student one clear success criterion before each assignment.',
      'Review progress with evidence: scores, completed work, corrections, and student reflection.',
    ],
    parentSummaryDraft: `We are focusing on ${args.goal || 'steady progress'} for ${args.studentName || 'the student'}. The next step is a short, measurable practice plan and a follow-up check with recent work samples.`,
    boundary: 'Learning support only. Do not infer medical, psychological, or disability diagnoses from school notes.',
  };
}

export function draftParentMessage(args: {
  studentName?: string;
  situation?: string;
  tone?: 'warm' | 'firm' | 'celebratory' | 'concerned';
  nextStep?: string;
}) {
  const name = args.studentName || 'your child';
  const tone = args.tone || 'warm';
  const opener = tone === 'celebratory'
    ? `I wanted to share a positive update about ${name}.`
    : tone === 'firm'
      ? `I am writing to keep you informed about an important learning matter for ${name}.`
      : tone === 'concerned'
        ? `I wanted to reach out early so we can support ${name} together.`
        : `I hope you are well. I wanted to share a quick update about ${name}.`;

  return {
    studentName: name,
    tone,
    message: [
      opener,
      args.situation || 'Here is the classroom situation or learning observation.',
      args.nextStep ? `Next step: ${args.nextStep}` : 'Next step: I will monitor progress and share another update after the next checkpoint.',
      'Thank you for working with us to support steady progress.',
    ].join('\n\n'),
    teacherChecklist: [
      'Keep the message factual and evidence-based.',
      'Avoid labels, blame, or confidential comparisons with other students.',
      'Offer one concrete next step and one reasonable follow-up time.',
    ],
  };
}
