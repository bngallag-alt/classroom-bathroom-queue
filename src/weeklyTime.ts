import type { Session, Settings, Student, Weekday, WeeklyTimePolicy } from './types';

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
  deductOvertimeNextWeek: false,
  overtimeGraceMinutes: 0,
  // Retained only so older settings and backups remain readable.
  automaticSuspensionEnabled: false,
  overageGraceMinutes: 1,
  suspensionDays: 7,
};

export function normalizeWeeklyTimePolicy(value?: Partial<WeeklyTimePolicy>): WeeklyTimePolicy {
  return { ...defaultWeeklyTimePolicy, ...value };
}

export function validateWeeklyTimePolicy(input: WeeklyTimePolicy) {
  const policy = normalizeWeeklyTimePolicy(input);
  if (typeof policy.enabled !== 'boolean' || typeof policy.deductOvertimeNextWeek !== 'boolean' || typeof policy.automaticSuspensionEnabled !== 'boolean') return 'Weekly bathroom-time switches are invalid.';
  if (!Number.isInteger(policy.allowanceMinutes) || policy.allowanceMinutes < 1) return 'Weekly allowance must be a positive whole number of minutes.';
  if (!weekdayOptions.some((option) => option.value === policy.resetDay)) return 'Select a valid weekly reset day.';
  if (!Number.isInteger(policy.warningRemainingMinutes) || policy.warningRemainingMinutes < 0) return 'The weekly warning must be a whole number of zero or more minutes.';
  if (!Number.isInteger(policy.overtimeGraceMinutes) || policy.overtimeGraceMinutes < 0) return 'Grace period must be a whole number of zero or more minutes.';
  // Deprecated fields are still validated because current encrypted backups may contain them.
  if (!Number.isInteger(policy.overageGraceMinutes) || policy.overageGraceMinutes < 0) return 'Legacy weekly overage must be a nonnegative whole number of minutes.';
  if (!Number.isInteger(policy.suspensionDays) || policy.suspensionDays < 1 || policy.suspensionDays > 30) return 'Legacy weekly suspension duration must be a whole number from 1 through 30 days.';
  return '';
}

export function schoolWeek(at = new Date(), resetDay: Weekday = 1) {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const daysSinceReset = (start.getDay() - resetDay + 7) % 7;
  start.setDate(start.getDate() - daysSinceReset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

function countedSessionsWithin(studentId: string, sessions: Session[], settings: Settings, start: Date, end: Date, notAfter: Date) {
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
      && ended <= notAfter.getTime()
      && (settings.countWaterAsBathroom || (session.passType ?? 'bathroom') === 'bathroom');
  });
}

export function weeklyCountedSessions(studentId: string, sessions: Session[], settings: Settings, at = new Date()) {
  const policy = normalizeWeeklyTimePolicy(settings.weeklyTimePolicy);
  const { start, end } = schoolWeek(at, policy.resetDay);
  return countedSessionsWithin(studentId, sessions, settings, start, end, at);
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

export type WeeklyOvertimeDeduction = {
  previousWeekStart: Date;
  previousWeekEnd: Date;
  previousUsedSeconds: number;
  previousAllowanceSeconds?: number;
  overtimeSeconds: number;
  graceSeconds: number;
  deductionSeconds: number;
};

export function previousWeekOvertimeDeduction(student: Student, sessions: Session[], settings: Settings, at = new Date()): WeeklyOvertimeDeduction {
  const policy = normalizeWeeklyTimePolicy(settings.weeklyTimePolicy);
  const currentWeek = schoolWeek(at, policy.resetDay);
  const previousWeekEnd = currentWeek.start;
  const previousWeekStart = new Date(previousWeekEnd.getFullYear(), previousWeekEnd.getMonth(), previousWeekEnd.getDate() - 7);
  const allowance = effectiveWeeklyAllowance(student, { ...settings, weeklyTimePolicy: policy });
  const previous = countedSessionsWithin(student.id, sessions, settings, previousWeekStart, previousWeekEnd, at);
  const previousUsedSeconds = previous.reduce((total, session) => total + Math.max(0, session.durationSeconds), 0);
  const graceSeconds = policy.overtimeGraceMinutes * 60;
  const previousAllowanceSeconds = allowance.allowanceSeconds;
  if (!policy.deductOvertimeNextWeek || previousAllowanceSeconds === undefined) {
    return { previousWeekStart, previousWeekEnd, previousUsedSeconds, previousAllowanceSeconds, overtimeSeconds: 0, graceSeconds, deductionSeconds: 0 };
  }
  const overtimeSeconds = Math.max(0, previousUsedSeconds - previousAllowanceSeconds);
  const deductionSeconds = Math.min(previousAllowanceSeconds, Math.max(0, overtimeSeconds - graceSeconds));
  return { previousWeekStart, previousWeekEnd, previousUsedSeconds, previousAllowanceSeconds, overtimeSeconds, graceSeconds, deductionSeconds };
}

export type WeeklyTimeAssessment = {
  mode: WeeklyAllowanceMode;
  baseAllowanceSeconds?: number;
  allowanceSeconds?: number;
  deductionSeconds: number;
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
  const baseAllowance = effectiveWeeklyAllowance(student, { ...settings, weeklyTimePolicy: policy });
  const deduction = previousWeekOvertimeDeduction(student, sessions, { ...settings, weeklyTimePolicy: policy }, at);
  const allowanceSeconds = baseAllowance.allowanceSeconds === undefined ? undefined : Math.max(0, baseAllowance.allowanceSeconds - deduction.deductionSeconds);
  const counted = weeklyCountedSessions(student.id, sessions, { ...settings, weeklyTimePolicy: policy }, at);
  const usedSeconds = counted.reduce((total, session) => total + Math.max(0, session.durationSeconds), 0);
  const remainingSeconds = allowanceSeconds === undefined ? undefined : Math.max(0, allowanceSeconds - usedSeconds);
  const overageSeconds = allowanceSeconds === undefined ? 0 : Math.max(0, usedSeconds - allowanceSeconds);
  return {
    mode: baseAllowance.mode,
    baseAllowanceSeconds: baseAllowance.allowanceSeconds,
    allowanceSeconds,
    deductionSeconds: deduction.deductionSeconds,
    usedSeconds,
    remainingSeconds,
    overageSeconds,
    blocked: allowanceSeconds !== undefined && usedSeconds >= allowanceSeconds,
    // Weekly automatic suspensions are deprecated. This field remains for service compatibility.
    automaticSuspensionTriggered: false,
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

export function reconcileStudentWeeklyTime(student: Student, sessions: Session[], settings: Settings, at = new Date(), forceCurrentCrossing = false): Student {
  void sessions;
  void settings;
  void at;
  void forceCurrentCrossing;
  // Older weekly automatic suspensions remain stored, but this version never creates or removes one.
  return student;
}
