import type { Session, Settings, Student, Weekday, WeeklyTimePolicy } from './types';

const DAY_MS = 86_400_000;

export const weekdayOptions: Array<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export const defaultWeeklyTimePolicy: WeeklyTimePolicy = {
  enabled: false,
  allowanceMinutes: 20,
  resetDay: 1,
  warningRemainingMinutes: 5,
  automaticSuspensionEnabled: false,
  overageGraceMinutes: 1,
  suspensionDays: 7,
};

export function normalizeWeeklyTimePolicy(value?: Partial<WeeklyTimePolicy>): WeeklyTimePolicy {
  return { ...defaultWeeklyTimePolicy, ...value };
}

export function validateWeeklyTimePolicy(input: WeeklyTimePolicy, automaticSuspensionAcknowledged: boolean) {
  const policy = normalizeWeeklyTimePolicy(input);
  if (typeof policy.enabled !== 'boolean' || typeof policy.automaticSuspensionEnabled !== 'boolean') return 'Weekly bathroom-time switches are invalid.';
  if (!Number.isInteger(policy.allowanceMinutes) || policy.allowanceMinutes < 1) return 'Weekly allowance must be a positive whole number of minutes.';
  if (!weekdayOptions.some((option) => option.value === policy.resetDay)) return 'Select a valid weekly reset day.';
  if (!Number.isInteger(policy.warningRemainingMinutes) || policy.warningRemainingMinutes < 0) return 'The weekly warning must be a whole number of zero or more minutes.';
  if (!Number.isInteger(policy.overageGraceMinutes) || policy.overageGraceMinutes < 0) return 'Minutes over before suspension must be a nonnegative whole number.';
  if (!Number.isInteger(policy.suspensionDays) || policy.suspensionDays < 1 || policy.suspensionDays > 30) return 'Suspension duration must be a whole number from 1 through 30 days.';
  if (policy.automaticSuspensionEnabled && !policy.enabled) return 'Enable the weekly bathroom-time allowance before enabling automatic weekly suspensions.';
  if (policy.automaticSuspensionEnabled && !automaticSuspensionAcknowledged) return 'Acknowledge the emergency and accommodation override requirement before enabling automatic weekly suspensions.';
  return '';
}

export function schoolWeek(at = new Date(), resetDay: Weekday = 1) {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const daysSinceReset = (start.getDay() - resetDay + 7) % 7;
  start.setDate(start.getDate() - daysSinceReset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

export function weeklyCountedSessions(studentId: string, sessions: Session[], settings: Settings, at = new Date()) {
  const policy = normalizeWeeklyTimePolicy(settings.weeklyTimePolicy);
  const { start, end } = schoolWeek(at, policy.resetDay);
  const nowTime = at.getTime();
  return sessions.filter((session) => {
    const ended = new Date(session.endedAt).getTime();
    const started = new Date(session.startedAt).getTime();
    return session.studentId === studentId
      && session.status === 'completed'
      && Number.isFinite(ended)
      && Number.isFinite(started)
      && started <= ended
      && ended >= start.getTime()
      && ended < end.getTime()
      && ended <= nowTime
      && (settings.countWaterAsBathroom || (session.passType ?? 'bathroom') === 'bathroom');
  });
}

export type WeeklyAllowanceMode = 'disabled' | 'inherited' | 'override' | 'unlimited';

export function effectiveWeeklyAllowance(student: Student, settings: Settings) {
  const policy = normalizeWeeklyTimePolicy(settings.weeklyTimePolicy);
  if (settings.usageLimitMode !== 'weekly-time' || !policy.enabled) return { mode: 'disabled' as WeeklyAllowanceMode, allowanceSeconds: undefined };
  if (student.weeklyTimeLimitMinutes === 0) return { mode: 'unlimited' as WeeklyAllowanceMode, allowanceSeconds: undefined };
  if (typeof student.weeklyTimeLimitMinutes === 'number' && student.weeklyTimeLimitMinutes > 0) {
    return { mode: 'override' as WeeklyAllowanceMode, allowanceSeconds: student.weeklyTimeLimitMinutes * 60 };
  }
  return { mode: 'inherited' as WeeklyAllowanceMode, allowanceSeconds: policy.allowanceMinutes * 60 };
}

export type WeeklyTimeAssessment = {
  mode: WeeklyAllowanceMode;
  allowanceSeconds?: number;
  usedSeconds: number;
  remainingSeconds?: number;
  overageSeconds: number;
  blocked: boolean;
  automaticSuspensionTriggered: boolean;
  weekStart: Date;
  weekEnd: Date;
  countedSessions: Session[];
};

export function assessWeeklyTime(student: Student, sessions: Session[], settings: Settings, at = new Date()): WeeklyTimeAssessment {
  const policy = normalizeWeeklyTimePolicy(settings.weeklyTimePolicy);
  const { start, end } = schoolWeek(at, policy.resetDay);
  const allowance = effectiveWeeklyAllowance(student, { ...settings, weeklyTimePolicy: policy });
  const counted = weeklyCountedSessions(student.id, sessions, { ...settings, weeklyTimePolicy: policy }, at);
  const usedSeconds = counted.reduce((total, session) => total + Math.max(0, session.durationSeconds), 0);
  const remainingSeconds = allowance.allowanceSeconds === undefined ? undefined : Math.max(0, allowance.allowanceSeconds - usedSeconds);
  const overageSeconds = allowance.allowanceSeconds === undefined ? 0 : Math.max(0, usedSeconds - allowance.allowanceSeconds);
  return {
    mode: allowance.mode,
    allowanceSeconds: allowance.allowanceSeconds,
    usedSeconds,
    remainingSeconds,
    overageSeconds,
    blocked: allowance.allowanceSeconds !== undefined && usedSeconds >= allowance.allowanceSeconds,
    automaticSuspensionTriggered: allowance.allowanceSeconds !== undefined
      && policy.enabled
      && policy.automaticSuspensionEnabled
      && overageSeconds > 0
      && overageSeconds >= policy.overageGraceMinutes * 60,
    weekStart: start,
    weekEnd: end,
    countedSessions: counted,
  };
}

export function formatWeeklyDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  const parts: string[] = [];
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (remainingSeconds || !parts.length) parts.push(`${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function weeklyTimeWarningMessage(student: Student, sessions: Session[], settings: Settings, at = new Date()) {
  if (settings.usageLimitMode !== 'weekly-time') return '';
  const policy = normalizeWeeklyTimePolicy(settings.weeklyTimePolicy);
  if (policy.warningRemainingMinutes <= 0) return '';
  const assessment = assessWeeklyTime(student, sessions, settings, at);
  if (assessment.blocked || assessment.remainingSeconds === undefined || assessment.remainingSeconds <= 0 || assessment.remainingSeconds > policy.warningRemainingMinutes * 60) return '';
  return `You have ${formatWeeklyDuration(assessment.remainingSeconds)} of bathroom time remaining this week.`;
}

function newestWeeklySession(assessment: WeeklyTimeAssessment) {
  return [...assessment.countedSessions].sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
}

export function reconcileStudentWeeklyTime(student: Student, sessions: Session[], settings: Settings, at = new Date(), forceCurrentCrossing = false): Student {
  const policy = normalizeWeeklyTimePolicy(settings.weeklyTimePolicy);
  const source = student.passSuspension?.source;
  const isWeeklySuspension = student.passSuspension?.kind === 'automatic' && source === 'weekly-time';
  const assessment = assessWeeklyTime(student, sessions, { ...settings, weeklyTimePolicy: policy }, at);
  const active = student.passSuspension && new Date(student.passSuspension.endsAt).getTime() > at.getTime();
  if (isWeeklySuspension && active && (!policy.enabled || !policy.automaticSuspensionEnabled || assessment.mode === 'unlimited')) {
    return { ...student, passSuspension: undefined, updatedAt: at.toISOString() };
  }
  if (active || !assessment.automaticSuspensionTriggered) return student;
  const newest = newestWeeklySession(assessment);
  if (!newest) return student;
  const triggerKey = `weekly:${assessment.weekStart.toISOString()}:${newest.id}`;
  if (!forceCurrentCrossing && student.lastWeeklyTimeSuspensionTriggerKey === triggerKey) return student;
  const startedAt = at.toISOString();
  return {
    ...student,
    passSuspension: {
      kind: 'automatic',
      source: 'weekly-time',
      startedAt,
      endsAt: new Date(at.getTime() + policy.suspensionDays * DAY_MS).toISOString(),
      reasons: [`Weekly bathroom-time allowance exceeded by ${formatWeeklyDuration(assessment.overageSeconds)}.`],
      triggerKey,
    },
    lastWeeklyTimeSuspensionTriggerKey: triggerKey,
    updatedAt: startedAt,
  };
}
