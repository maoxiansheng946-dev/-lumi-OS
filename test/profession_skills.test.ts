import { describe, expect, it } from 'vitest';
import { buildLearningProfile, buildLessonPlan, draftParentMessage } from '../server/skills/bundled/education-teacher/logic';
import { buildExecutiveBrief, calculateRunwayScenario, convertMeetingToActions } from '../server/skills/bundled/executive-ops/logic';
import { buildFollowUpPlan, draftPatientInstructions, structureClinicalNote } from '../server/skills/bundled/medical-admin/logic';

describe('education teacher skill logic', () => {
  it('builds a lesson plan with timed flow and support steps', () => {
    const plan = buildLessonPlan({
      subject: 'Math',
      grade: 'Grade 5',
      topic: 'Fractions',
      durationMinutes: 50,
      objectives: ['Compare fractions', 'Explain equivalent fractions'],
    });

    expect(plan.learningObjectives).toHaveLength(2);
    expect(plan.lessonFlow.length).toBeGreaterThanOrEqual(5);
    expect(plan.differentiation[0]).toContain('scaffolded');
  });

  it('keeps learning profiles non-diagnostic and drafts parent communication', () => {
    const profile = buildLearningProfile({
      studentName: 'Alex',
      notes: 'Homework missing twice, confidence low during reading tasks.',
      goal: 'complete weekly reading practice',
    });
    const message = draftParentMessage({
      studentName: 'Alex',
      situation: 'Alex has improved participation but needs a steadier homework routine.',
      tone: 'warm',
      nextStep: 'practice 10 minutes each evening and bring the reading log on Friday',
    });

    expect(profile.possibleGaps).toEqual(expect.arrayContaining(['homework', 'confidence', 'reading']));
    expect(profile.boundary).toContain('Do not infer');
    expect(message.message).toContain('Alex');
    expect(message.teacherChecklist).toHaveLength(3);
  });
});

describe('executive operations skill logic', () => {
  it('categorizes KPI lines for executive review', () => {
    const brief = buildExecutiveBrief({
      period: '2026-W26',
      kpiText: 'Revenue up 12%\nCash burn 80000\nCustomer complaints increased\nProject launch delayed',
      priorities: ['cash', 'delivery'],
    });

    expect(brief.metrics).toHaveLength(4);
    expect(brief.byArea.growth).toBe(1);
    expect(brief.byArea.finance).toBe(1);
    expect(brief.decisionQuestions[0]).toContain('previous period');
  });

  it('extracts meeting actions and calculates cash runway', () => {
    const actions = convertMeetingToActions({
      meetingNotes: 'Decision: launch beta\nAction owner Li due 2026-07-10 finish onboarding\nQuestion? pricing unclear',
    });
    const runway = calculateRunwayScenario({
      cash: 100000,
      monthlyRevenue: 20000,
      monthlyCost: 45000,
      plannedInvestment: 10000,
      months: 3,
    });

    expect(actions.actionCount).toBe(1);
    expect(actions.decisions[0]).toContain('launch beta');
    expect(runway.monthlyBurn).toBe(25000);
    expect(runway.runwayMonths).toBe(3);
  });
});

describe('medical admin skill logic', () => {
  it('structures clinical notes with urgent signal reminders and clinician boundary', () => {
    const note = structureClinicalNote({
      rawNotes: 'Patient reports chest pain. ECG test ordered. Current med aspirin dose unknown.',
      department: 'Cardiology',
    });

    expect(note.structuredNote.subjective[0]).toContain('chest pain');
    expect(note.extracted.testsMentioned[0]).toContain('ECG');
    expect(note.extracted.urgentSignals[0]).toContain('chest');
    expect(note.boundary).toContain('licensed clinician');
  });

  it('drafts patient instructions and follow-up plans without replacing clinicians', () => {
    const instructions = draftPatientInstructions({
      conditionOrVisit: 'follow-up visit',
      clinicianPlan: 'schedule blood test next week and continue clinician-approved medication plan',
      readingLevel: 'plain',
    });
    const followUp = buildFollowUpPlan({
      visitSummary: 'Post-visit check',
      tasks: ['book lab appointment', 'record symptoms'],
      warningSigns: ['worsening symptoms'],
    });

    expect(instructions.instructionDraft.join('\n')).toContain('Clinician plan');
    expect(instructions.boundary).toContain('does not diagnose');
    expect(followUp.taskChecklist).toEqual(['book lab appointment', 'record symptoms']);
    expect(followUp.warningSigns).toEqual(['worsening symptoms']);
  });
});
