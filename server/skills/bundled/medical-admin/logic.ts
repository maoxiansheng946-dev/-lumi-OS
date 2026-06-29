function splitList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '').split(/\n|,|;|，|；/).map(s => s.trim()).filter(Boolean);
}

function splitLines(value?: string): string[] {
  return String(value || '').split(/\n|;/).map(s => s.trim()).filter(Boolean);
}

const MEDICAL_BOUNDARY = 'Documentation and communication support only. It does not diagnose, prescribe, triage, or replace licensed clinical judgment; a licensed clinician must review clinical accuracy and decisions.';

function containsUrgentSignals(text: string): string[] {
  const signals = [
    { re: /chest pain|胸痛|胸闷/i, label: 'chest pain or chest tightness mentioned' },
    { re: /shortness of breath|呼吸困难|喘不上气/i, label: 'breathing difficulty mentioned' },
    { re: /stroke|偏瘫|口角歪斜|言语不清/i, label: 'possible neurologic emergency signal mentioned' },
    { re: /suicid|自杀|自伤/i, label: 'self-harm signal mentioned' },
    { re: /severe bleeding|大出血|大量出血/i, label: 'severe bleeding mentioned' },
    { re: /infant|newborn|新生儿|婴儿/i, label: 'infant/newborn context mentioned' },
  ];
  return signals.filter(signal => signal.re.test(text)).map(signal => signal.label);
}

export function structureClinicalNote(args: {
  rawNotes?: string;
  noteType?: 'soap' | 'admission' | 'follow_up' | 'discharge';
  department?: string;
}) {
  const text = String(args.rawNotes || '');
  const lines = splitLines(text);
  const meds = lines.filter(line => /med|drug|tablet|dose|药|片|针|剂量/i.test(line));
  const tests = lines.filter(line => /lab|test|ct|mri|xray|ultrasound|检查|化验|影像|检验/i.test(line));
  const symptoms = lines.filter(line => /pain|fever|cough|nausea|dizzy|疼|痛|发热|咳|头晕|恶心/i.test(line));

  return {
    noteType: args.noteType || 'soap',
    department: args.department || '',
    structuredNote: {
      subjective: symptoms.length > 0 ? symptoms : ['Summarize patient-reported symptoms, onset, duration, severity, and relevant history.'],
      objective: tests.length > 0 ? tests : ['Summarize vitals, physical exam, labs, and imaging findings if available.'],
      assessmentDraft: ['Clinician to enter assessment. Do not treat this draft as diagnosis.'],
      planDraft: ['Clinician to enter plan, medication, follow-up, and safety-net instructions.'],
    },
    extracted: {
      medicationsMentioned: meds,
      testsMentioned: tests,
      urgentSignals: containsUrgentSignals(text),
    },
    missingInfoChecklist: [
      'Chief concern, onset time, duration, severity, and progression.',
      'Vitals, allergies, current medications, pregnancy status when relevant, and major history.',
      'Red-flag symptoms and reasons for urgent escalation.',
      'Clinician-confirmed diagnosis, orders, medication, and follow-up.',
    ],
    boundary: MEDICAL_BOUNDARY,
  };
}

export function buildVisitPrep(args: {
  patientGoal?: string;
  symptoms?: string;
  history?: string;
  medications?: string | string[];
  questions?: string | string[];
}) {
  const text = `${args.symptoms || ''}\n${args.history || ''}`;
  return {
    patientGoal: args.patientGoal || 'Clarify concern and prepare for visit.',
    preVisitSummary: {
      symptoms: splitLines(args.symptoms),
      history: splitLines(args.history),
      medications: splitList(args.medications),
      urgentSignals: containsUrgentSignals(text),
    },
    questionsForClinician: [
      ...splitList(args.questions),
      'What symptoms or changes should prompt urgent care?',
      'What tests or follow-up are needed, and when should results be reviewed?',
      'What medication instructions, side effects, or interactions should be confirmed?',
    ].filter(Boolean),
    bringList: [
      'Medication list with dose and frequency.',
      'Allergy list and prior relevant records.',
      'Recent test reports, images, and discharge summaries.',
      'Timeline of symptoms and prior treatments.',
    ],
    boundary: MEDICAL_BOUNDARY,
  };
}

export function draftPatientInstructions(args: {
  conditionOrVisit?: string;
  clinicianPlan?: string;
  readingLevel?: 'plain' | 'standard';
  language?: string;
}) {
  const plain = args.readingLevel !== 'standard';
  return {
    conditionOrVisit: args.conditionOrVisit || 'visit',
    language: args.language || 'patient preferred language',
    instructionDraft: [
      `Reason for today's visit: ${args.conditionOrVisit || 'to be confirmed by the clinician'}.`,
      `Clinician plan to follow: ${args.clinicianPlan || 'add clinician-reviewed plan here'}.`,
      plain ? 'Take the next steps exactly as your clinician explained.' : 'Follow the clinician-reviewed plan, including medication, testing, and activity guidance.',
      'Seek urgent care or contact the clinic if symptoms worsen, new severe symptoms appear, or you are unsure about instructions.',
    ],
    teachBackPrompts: [
      'Can you tell me when and how you will take the medicine or complete the next step?',
      'What warning signs would make you contact the clinic or seek urgent care?',
      'When is your next follow-up or result review?',
    ],
    boundary: MEDICAL_BOUNDARY,
  };
}

export function buildFollowUpPlan(args: {
  visitSummary?: string;
  followUpWindow?: string;
  tasks?: string | string[];
  warningSigns?: string | string[];
}) {
  const tasks = splitList(args.tasks);
  const warningSigns = splitList(args.warningSigns);
  return {
    followUpWindow: args.followUpWindow || 'Clinician to confirm timing.',
    visitSummary: args.visitSummary || '',
    taskChecklist: tasks.length > 0 ? tasks : [
      'Confirm medication or care instructions.',
      'Confirm tests, referrals, or result review timing.',
      'Schedule follow-up appointment if needed.',
    ],
    warningSigns: warningSigns.length > 0 ? warningSigns : [
      'Symptoms get worse or new severe symptoms appear.',
      'Medication reaction or inability to follow the plan.',
      'Any clinician-specified red flag.',
    ],
    messageTemplate: 'Checking in after your visit: please confirm symptoms, completed tasks, medication tolerance, and any warning signs.',
    boundary: MEDICAL_BOUNDARY,
  };
}

export function buildMedicalResearchChecklist(args: {
  clinicalQuestion?: string;
  population?: string;
  interventionOrExposure?: string;
  comparison?: string;
  outcomes?: string | string[];
}) {
  const outcomes = splitList(args.outcomes);
  return {
    clinicalQuestion: args.clinicalQuestion || 'Clinical question to research',
    pico: {
      population: args.population || 'Patient/population to define',
      interventionOrExposure: args.interventionOrExposure || 'Intervention/exposure to define',
      comparison: args.comparison || 'Comparator or usual care if applicable',
      outcomes: outcomes.length > 0 ? outcomes : ['Patient-important outcomes', 'Harms/adverse effects', 'Follow-up duration'],
    },
    sourcePlan: [
      'Start with current clinical guidelines and systematic reviews.',
      'Check primary studies only after guideline/review context is clear.',
      'Record date searched, database/source, inclusion criteria, and conflicts of interest.',
    ],
    appraisalQuestions: [
      'Is the population similar to the patient/context?',
      'Are benefits, harms, absolute risks, and uncertainty reported?',
      'Is the evidence current enough for this clinical area?',
      'Does local regulation, availability, or clinician judgment change applicability?',
    ],
    boundary: MEDICAL_BOUNDARY,
  };
}
