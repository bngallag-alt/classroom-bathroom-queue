import type { ProbationMetric, ProbationPolicy, Session, Settings, Student } from './types';

const DAY_MS = 86_400_000;

export const probationMetricOrder: ProbationMetric[] = ['overtimeCount'];

export const probationMetricLabels: Record<ProbationMetric, string> = {
  uses: 'Completed uses',
  overtimeCount: 'Raw overtime count',
  overtimePercent: 'Overtime percentage',
};

export const displayProbationPercent = (value: number) => Math.round(value * 10) / 10;

export const defaultProbationPolicy: ProbationPolicy = {
  warningsEnabled: false,
  automaticSuspensionsEnabled: false,
  automaticSuspensionAcknowledged: false,
  suspensionDays: 7,
  minimumUsesForPercent: 3,
  triggerMode: 'any',
  rules: {
    uses: { enabled: false, warningThreshold: 6, suspensionThreshold: 8 },
    overtimeCount: { enabled: true, warningThreshold: 2, suspensionThreshold: 4 },
    overtimePercent: { enabled: false, warningThreshold: 50, suspensionThreshold: 75 },
  },
};

export function normalizeProbationPolicy(value?: Partial<ProbationPolicy>): ProbationPolicy {
  const rules = value?.rules as Partial<Record<ProbationMetric, Partial<ProbationPolicy['rules'][ProbationMetric]>>> | undefined;
  const overtimeCount = { ...defaultProbationPolicy.rules.overtimeCount, ...rules?.overtimeCount };
  const activeMetricWasEnabled = overtimeCount.enabled;
  return {
    ...defaultProbationPolicy,
    ...value,
    warningsEnabled: Boolean(value?.warningsEnabled && activeMetricWasEnabled),
    automaticSuspensionsEnabled: Boolean(value?.automaticSuspensionsEnabled && activeMetricWasEnabled),
    triggerMode: 'any',
    rules: {
      uses: { ...defaultProbationPolicy.rules.uses, ...rules?.uses, enabled: false },
      overtimeCount,
      overtimePercent: { ...defaultProbationPolicy.rules.overtimePercent, ...rules?.overtimePercent, enabled: false },
    },
  };
}

export type ProbationMetrics = {
  completedUses: number;
  overtimeCount: number;
  overtimePercent: number;
};

export type ProbationMetricStatus = {
  metric: ProbationMetric;
  value: number;
  eligible: boolean;
  warningReached: boolean;
  suspensionReached: boolean;
};

export type ProbationAssessment = {
  metrics: ProbationMetrics;
  statuses: ProbationMetricStatus[];
  warningMetrics: ProbationMetric[];
  suspensionMetrics: ProbationMetric[];
  suspensionTriggered: boolean;
};

export function probationSessions(sessions: Session[], settings: Settings, at = new Date()) {
  const end = at.getTime();
  const cutoff = end - 30 * DAY_MS;
  return sessions.filter((session) => {
    const ended = new Date(session.endedAt).getTime();
    return session.status === 'completed'
      && Number.isFinite(ended)
      && ended >= cutoff
      && ended <= end
      && (settings.countWaterAsBathroom || (session.passType ?? 'bathroom') === 'bathroom');
  });
}

export function probationMetrics(studentId: string, sessions: Session[], settings: Settings, at = new Date()): ProbationMetrics {
  const completed = probationSessions(sessions, settings, at).filter((session) => session.studentId === studentId);
  const overtimeCount = completed.filter((session) => session.overLimit).length;
  return {
    completedUses: completed.length,
    overtimeCount,
    overtimePercent: completed.length ? overtimeCount / completed.length * 100 : 0,
  };
}

function metricValue(metric: ProbationMetric, metrics: ProbationMetrics) {
  if (metric === 'overtimeCount') return metrics.overtimeCount;
  return metric === 'uses' ? metrics.completedUses : metrics.overtimePercent;
}

export function assessProbation(student: Student, sessions: Session[], settings: Settings, at = new Date()): ProbationAssessment {
  const policy = normalizeProbationPolicy(settings.probationPolicy);
  const bathroomPassMode = settings.usageLimitMode === 'bathroom-passes';
  const metrics = student.probationExempt ? { completedUses: 0, overtimeCount: 0, overtimePercent: 0 } : probationMetrics(student.id, sessions, settings, at);
  const statuses = probationMetricOrder.filter((metric) => policy.rules[metric].enabled).map((metric) => {
    const value = metricValue(metric, metrics);
    const eligible = true;
    return {
      metric,
      value,
      eligible,
      warningReached: eligible && value >= policy.rules[metric].warningThreshold,
      suspensionReached: eligible && value >= policy.rules[metric].suspensionThreshold,
    };
  });
  const suspensionMetrics = statuses.filter((status) => status.suspensionReached).map((status) => status.metric);
  const warningMetrics = !bathroomPassMode || student.probationExempt || !policy.warningsEnabled
    ? []
    : statuses.filter((status) => status.warningReached && !status.suspensionReached).map((status) => status.metric);
  const suspensionTriggered = bathroomPassMode
    && !student.probationExempt
    && policy.automaticSuspensionsEnabled
    && statuses.length > 0
    && suspensionMetrics.length > 0;
  return { metrics, statuses, warningMetrics, suspensionMetrics, suspensionTriggered };
}

export function validateProbationPolicy(input: ProbationPolicy) {
  const policy = normalizeProbationPolicy(input);
  if (typeof policy.warningsEnabled !== 'boolean' || typeof policy.automaticSuspensionsEnabled !== 'boolean' || typeof policy.automaticSuspensionAcknowledged !== 'boolean') return 'Automatic pass suspension switches are invalid.';
  if (!Number.isInteger(policy.suspensionDays) || policy.suspensionDays < 1 || policy.suspensionDays > 30) return 'Suspension duration must be a whole number from 1 through 30 days.';
  const enabled = probationMetricOrder.filter((metric) => policy.rules[metric].enabled);
  if (policy.automaticSuspensionsEnabled && !enabled.length) return 'Raw overtime count must be enabled before enabling automatic suspensions.';
  for (const metric of probationMetricOrder) {
    const rule = policy.rules[metric];
    if (!Number.isInteger(rule.warningThreshold) || rule.warningThreshold < 0) return `${probationMetricLabels[metric]} warning threshold must be a whole number of zero or more.`;
    if (!Number.isInteger(rule.suspensionThreshold) || rule.suspensionThreshold < 0) return `${probationMetricLabels[metric]} suspension threshold must be a whole number of zero or more.`;
    if (rule.warningThreshold >= rule.suspensionThreshold) return `${probationMetricLabels[metric]} warning threshold must be lower than its suspension threshold.`;
  }
  if (policy.automaticSuspensionsEnabled && !policy.automaticSuspensionAcknowledged) return 'Acknowledge the emergency and accommodation override requirement before enabling automatic suspensions.';
  return '';
}

export function activePassSuspension(student: Student, settings: Settings, at = new Date()) {
  const suspension = student.passSuspension;
  if (!suspension || new Date(suspension.endsAt).getTime() <= at.getTime()) return undefined;
  if (suspension.kind === 'automatic' && suspension.source !== 'weekly-time' && (student.probationExempt || !settings.probationPolicy.automaticSuspensionsEnabled)) return undefined;
  if (suspension.kind === 'automatic' && suspension.source === 'weekly-time' && (!settings.weeklyTimePolicy.enabled || !settings.weeklyTimePolicy.automaticSuspensionEnabled || student.weeklyTimeLimitMinutes === 0)) return undefined;
  return suspension;
}

function suspensionReasons(assessment: ProbationAssessment, policy: ProbationPolicy) {
  return assessment.suspensionMetrics.map((metric) => {
    const threshold = policy.rules[metric].suspensionThreshold;
    if (metric === 'overtimeCount') return `Raw overtime threshold (${threshold})`;
    return metric === 'uses' ? `Completed uses threshold (${threshold})` : `Overtime percentage threshold (${threshold}%)`;
  });
}

function newestStudentSession(studentId: string, sessions: Session[], settings: Settings, at: Date) {
  return probationSessions(sessions, settings, at).filter((session) => session.studentId === studentId).sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
}

export function reconcileStudentProbation(student: Student, sessions: Session[], settings: Settings, at = new Date(), forceCurrentCrossing = false): Student {
  const policy = normalizeProbationPolicy(settings.probationPolicy);
  const active = activePassSuspension(student, { ...settings, probationPolicy: policy }, at);
  if (student.passSuspension?.kind === 'automatic' && student.passSuspension.source !== 'weekly-time' && !active && (student.probationExempt || !policy.automaticSuspensionsEnabled)) return { ...student, passSuspension: undefined, updatedAt: at.toISOString() };
  if (active || student.probationExempt || !policy.automaticSuspensionsEnabled) return student;
  const assessment = assessProbation(student, sessions, { ...settings, probationPolicy: policy }, at);
  if (!assessment.suspensionTriggered) return student;
  const newest = newestStudentSession(student.id, sessions, settings, at);
  if (!newest) return student;
  const triggerKey = `session:${newest.id}:${assessment.suspensionMetrics.join(',')}`;
  if (student.lastAutoSuspensionTriggerKey === triggerKey) return student;
  if (!forceCurrentCrossing) {
    const withoutNewest = sessions.filter((session) => session.id !== newest.id);
    if (assessProbation(student, withoutNewest, { ...settings, probationPolicy: policy }, at).suspensionTriggered) return student;
  }
  const startedAt = at.toISOString();
  return {
    ...student,
    passSuspension: {
      kind: 'automatic',
      source: 'rolling-30-day',
      startedAt,
      endsAt: new Date(at.getTime() + policy.suspensionDays * DAY_MS).toISOString(),
      reasons: suspensionReasons(assessment, policy),
      triggerKey,
    },
    lastAutoSuspensionTriggerKey: triggerKey,
    updatedAt: startedAt,
  };
}

export function probationWarningMessages(student: Student, sessions: Session[], settings: Settings, at = new Date()) {
  const policy = normalizeProbationPolicy(settings.probationPolicy);
  const assessment = assessProbation(student, sessions, { ...settings, probationPolicy: policy }, at);
  return assessment.warningMetrics.map((metric) => {
    const status = assessment.statuses.find((item) => item.metric === metric)!;
    const threshold = policy.rules[metric].suspensionThreshold;
    if (metric === 'overtimeCount') return policy.automaticSuspensionsEnabled
      ? `WARNING: You are approaching the overtime limit. ${threshold - status.value} more over-limit return${threshold - status.value === 1 ? '' : 's'} within the rolling 30-day period will result in a ${policy.suspensionDays}-day pass suspension.`
      : 'WARNING: You are approaching the teacher’s overtime review limit. Please return on time.';
    return '';
  });
}
