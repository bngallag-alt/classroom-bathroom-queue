import { beforeEach, describe, expect, it } from 'vitest';
import { atomicReplace, db, defaults, getSettings, normalizeSettings } from '../db';
import { createEncryptedBackup, decryptBackup, restoreAnyBackup, useEligibility } from '../lib';
import { activePassSuspension, normalizeProbationPolicy } from '../probation';
import { base64UrlToBytes, bytesToBase64Url, generateLookupSecret } from '../privacy';
import { localAppServices } from '../services';
import type { EncryptedBackupV4, Session, Settings, Student, Weekday, WeeklyTimePolicy } from '../types';
import {
  assessWeeklyTime,
  defaultWeeklyTimePolicy,
  effectiveWeeklyAllowance,
  formatWeeklyDuration,
  normalizeWeeklyTimePolicy,
  previousWeekOvertimeDeduction,
  reconcileStudentWeeklyTime,
  schoolWeek,
  validateWeeklyTimePolicy,
  weeklyCountedSessions,
  weeklyTimeWarningMessage,
} from '../weeklyTime';

const at = new Date(2026, 8, 2, 12, 0, 0, 0);
const student: Student = {
  id: 'weekly-student',
  name: 'Fictional Weekly Student',
  externalIdHash: 'b'.repeat(64),
  externalIdLast4: '4321',
  createdAt: at.toISOString(),
  updatedAt: at.toISOString(),
};

function configured(policyChanges: Partial<WeeklyTimePolicy> = {}, studentPolicy: Partial<Student> = {}) {
  const weeklyTimePolicy = normalizeWeeklyTimePolicy({ enabled: true, ...policyChanges });
  const settings: Settings = {
    ...defaults,
    setupComplete: true,
    usageLimitMode: 'weekly-time',
    lookupSecret: generateLookupSecret(),
    probationPolicy: normalizeProbationPolicy({ automaticSuspensionAcknowledged: true }),
    weeklyTimePolicy,
  };
  return { settings, student: { ...student, ...studentPolicy } };
}

function completed(id: string, endedAt: Date, durationSeconds: number, changes: Partial<Session> = {}): Session {
  const start = new Date(endedAt.getTime() - durationSeconds * 1_000).toISOString();
  return {
    id,
    studentId: student.id,
    studentName: student.name,
    queuedAt: start,
    startedAt: start,
    endedAt: endedAt.toISOString(),
    durationSeconds,
    durationFormatted: '0:00',
    reachedWarning: false,
    overLimit: false,
    status: 'completed',
    passType: 'bathroom',
    ...changes,
  };
}

function previousWeekCompleted(id: string, durationSeconds: number, settings: Settings, changes: Partial<Session> = {}) {
  const { start } = schoolWeek(at, settings.weeklyTimePolicy.resetDay);
  return completed(id, new Date(start.getTime() - 1_000), durationSeconds, changes);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('school-week boundaries', () => {
  it('supports every reset weekday at local midnight', () => {
    for (let day = 0; day <= 6; day += 1) {
      const { start, end } = schoolWeek(at, day as Weekday);
      expect(start.getDay()).toBe(day);
      expect(end.getDay()).toBe(day);
      expect(start.getHours()).toBe(0);
      expect(end.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      const calendarEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      expect(end.getFullYear()).toBe(calendarEnd.getFullYear());
      expect(end.getMonth()).toBe(calendarEnd.getMonth());
      expect(end.getDate()).toBe(calendarEnd.getDate());
    }
  });

  it('builds a daylight-saving week from local calendar midnights', () => {
    const duringSpringChange = new Date(2026, 2, 10, 12);
    const { start, end } = schoolWeek(duringSpringChange, 0);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 2, 8, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()]).toEqual([2026, 2, 15, 0]);
  });
});

describe('weekly duration calculations and eligibility', () => {
  it('starts disabled and validates every weekly setting', () => {
    expect(defaultWeeklyTimePolicy).toMatchObject({ enabled: false, allowanceMinutes: 20, resetDay: 1, warningRemainingMinutes: 5, deductOvertimeNextWeek: false, overtimeGraceMinutes: 0, automaticSuspensionEnabled: false });
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ allowanceMinutes: 0 }))).toMatch(/positive whole number/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ warningRemainingMinutes: -1 }))).toMatch(/zero or more/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ overtimeGraceMinutes: -1 }))).toMatch(/Grace period/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ overtimeGraceMinutes: 1.5 }))).toMatch(/whole number/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ deductOvertimeNextWeek: true, overtimeGraceMinutes: 2 }))).toBe('');
  });

  it('counts exact completed duration and excludes canceled, unstarted, old, and future sessions', () => {
    const { settings } = configured();
    const { start } = schoolWeek(at, settings.weeklyTimePolicy.resetDay);
    const records = [
      completed('first', new Date(at.getTime() - 60_000), 720),
      completed('canceled', new Date(at.getTime() - 50_000), 999, { status: 'teacher-canceled' }),
      completed('unstarted', new Date(at.getTime() - 40_000), 999, { startedAt: '' }),
      completed('old', new Date(start.getTime() - 1), 999),
      completed('future', new Date(at.getTime() + 60_000), 999),
    ];
    expect(weeklyCountedSessions(student.id, records, settings, at).map((item) => item.id)).toEqual(['first']);
    expect(assessWeeklyTime(student, records, settings, at)).toMatchObject({ usedSeconds: 720, remainingSeconds: 480, overageSeconds: 0, blocked: false });
    expect(formatWeeklyDuration(480)).toBe('8 minutes');
  });

  it('preserves exact seconds when calculating remaining time', () => {
    const { settings } = configured();
    const result = assessWeeklyTime(student, [completed('exact', new Date(at.getTime() - 1_000), 750)], settings, at);
    expect(result.remainingSeconds).toBe(450);
    expect(formatWeeklyDuration(result.remainingSeconds!)).toBe('7 minutes 30 seconds');
  });

  it('respects the existing water-pass counting preference', () => {
    const record = completed('water', new Date(at.getTime() - 1_000), 600, { passType: 'water' });
    const { settings } = configured();
    expect(assessWeeklyTime(student, [record], settings, at).usedSeconds).toBe(0);
    expect(assessWeeklyTime(student, [record], { ...settings, countWaterAsBathroom: true }, at).usedSeconds).toBe(600);
  });

  it('supports inherited, individual, and unlimited allowances', () => {
    const { settings } = configured({ allowanceMinutes: 20 });
    expect(effectiveWeeklyAllowance(student, settings)).toEqual({ mode: 'inherited', allowanceSeconds: 1200 });
    expect(effectiveWeeklyAllowance({ ...student, weeklyTimeLimitMinutes: 10 }, settings)).toEqual({ mode: 'override', allowanceSeconds: 600 });
    expect(effectiveWeeklyAllowance({ ...student, weeklyTimeLimitMinutes: 0 }, settings)).toEqual({ mode: 'unlimited', allowanceSeconds: undefined });
  });

  it('blocks at exact equality, permits any positive remainder, and resets next week', async () => {
    const { settings } = configured();
    const nineteenMinutes = completed('nineteen', new Date(at.getTime() - 1_000), 1_199);
    await expect(useEligibility(student, settings, [nineteenMinutes], at, 'bathroom')).resolves.toMatchObject({ allowed: true });
    const exact = completed('exact', new Date(at.getTime() - 1_000), 1_200);
    await expect(useEligibility(student, settings, [exact], at, 'bathroom')).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('weekly bathroom-time allowance') });
    const nextWeek = new Date(schoolWeek(at, settings.weeklyTimePolicy.resetDay).end.getTime() + 1_000);
    await expect(useEligibility(student, settings, [exact], nextWeek, 'bathroom')).resolves.toMatchObject({ allowed: true });
  });

  it('does not block uncounted water when bathroom time is exhausted', async () => {
    const { settings } = configured();
    const exact = completed('exact', new Date(at.getTime() - 1_000), 1_200);
    await expect(useEligibility(student, settings, [exact], at, 'water')).resolves.toMatchObject({ allowed: true });
    await expect(useEligibility(student, { ...settings, countWaterAsBathroom: true }, [exact], at, 'water')).resolves.toMatchObject({ allowed: false });
  });

  it('shows exact low-time warnings only in weekly mode and not at zero', () => {
    const { settings } = configured({ warningRemainingMinutes: 8 });
    const twelveMinutes = completed('twelve', new Date(at.getTime() - 1_000), 720);
    expect(weeklyTimeWarningMessage(student, [twelveMinutes], settings, at)).toBe('You have 8 minutes of bathroom time remaining this week.');
    expect(weeklyTimeWarningMessage(student, [completed('under-minute', new Date(at.getTime() - 1_000), 1_151)], { ...settings, weeklyTimePolicy: { ...settings.weeklyTimePolicy, warningRemainingMinutes: 1 } }, at)).toBe('You have 49 seconds of bathroom time remaining this week.');
    expect(weeklyTimeWarningMessage(student, [completed('above', new Date(at.getTime() - 1_000), 719)], settings, at)).toBe('');
    expect(weeklyTimeWarningMessage(student, [completed('zero', new Date(at.getTime() - 1_000), 1_200)], settings, at)).toBe('');
    expect(weeklyTimeWarningMessage(student, [twelveMinutes], { ...settings, usageLimitMode: 'bathroom-passes' }, at)).toBe('');
    expect(weeklyTimeWarningMessage(student, [twelveMinutes], { ...settings, weeklyTimePolicy: { ...settings.weeklyTimePolicy, warningRemainingMinutes: 0 } }, at)).toBe('');
  });

  it('enforces only the selected usage-limit system', async () => {
    const { settings } = configured({ allowanceMinutes: 20 });
    const oneUse = completed('one-use', new Date(at.getTime() - 1_000), 60);
    await expect(useEligibility(student, { ...settings, globalUseLimit: 1 }, [oneUse], at)).resolves.toMatchObject({ allowed: true });
    await expect(useEligibility(student, { ...settings, usageLimitMode: 'bathroom-passes', globalUseLimit: 1 }, [oneUse], at)).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('limit of 1 use') });
    const exhausted = completed('exhausted', new Date(at.getTime() - 1_000), 1_200);
    await expect(useEligibility(student, { ...settings, usageLimitMode: 'bathroom-passes', globalUseLimit: 0 }, [exhausted], at)).resolves.toMatchObject({ allowed: true });
  });
});

describe('next-week overtime deductions', () => {
  const deductionPolicy = { deductOvertimeNextWeek: true, overtimeGraceMinutes: 0 };

  it('does not deduct overtime when the feature is disabled', () => {
    const { settings } = configured({ deductOvertimeNextWeek: false });
    const previous = previousWeekCompleted('disabled-overtime', 1_380, settings);
    expect(previousWeekOvertimeDeduction(student, [previous], settings, at).deductionSeconds).toBe(0);
    expect(assessWeeklyTime(student, [previous], settings, at)).toMatchObject({ baseAllowanceSeconds: 1_200, allowanceSeconds: 1_200, deductionSeconds: 0 });
  });

  it('deducts exact previous-week overtime when grace is zero', () => {
    const { settings } = configured(deductionPolicy);
    const previous = previousWeekCompleted('three-over', 1_380, settings);
    expect(previousWeekOvertimeDeduction(student, [previous], settings, at)).toMatchObject({ previousUsedSeconds: 1_380, previousAllowanceSeconds: 1_200, overtimeSeconds: 180, graceSeconds: 0, deductionSeconds: 180 });
    expect(assessWeeklyTime(student, [previous], settings, at)).toMatchObject({ baseAllowanceSeconds: 1_200, allowanceSeconds: 1_020, remainingSeconds: 1_020, deductionSeconds: 180, blocked: false });
  });

  it('forgives overtime within grace and deducts only the excess', () => {
    const { settings } = configured({ ...deductionPolicy, overtimeGraceMinutes: 2 });
    const threeOver = previousWeekCompleted('three-over-grace', 1_380, settings);
    const atBoundary = previousWeekCompleted('at-grace', 1_320, settings);
    expect(assessWeeklyTime(student, [threeOver], settings, at).deductionSeconds).toBe(60);
    expect(assessWeeklyTime(student, [atBoundary], settings, at).deductionSeconds).toBe(0);
    expect(assessWeeklyTime(student, [previousWeekCompleted('below-grace', 1_319, settings)], settings, at).deductionSeconds).toBe(0);
  });

  it('never lowers the effective allowance below zero and blocks at zero', async () => {
    const { settings } = configured(deductionPolicy);
    const previous = previousWeekCompleted('far-over', 3_000, settings);
    const assessment = assessWeeklyTime(student, [previous], settings, at);
    expect(assessment).toMatchObject({ allowanceSeconds: 0, remainingSeconds: 0, deductionSeconds: 1_200, blocked: true });
    await expect(useEligibility(student, settings, [previous], at, 'bathroom')).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('weekly bathroom-time allowance') });
  });

  it('uses only the immediately previous week and excludes canceled sessions', () => {
    const { settings } = configured(deductionPolicy);
    const { start } = schoolWeek(at, settings.weeklyTimePolicy.resetDay);
    const twoWeeksOld = completed('two-weeks-old', new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7, 0, 0, 0, -1), 1_800);
    const canceled = previousWeekCompleted('canceled-overtime', 1_800, settings, { status: 'teacher-canceled' });
    expect(assessWeeklyTime(student, [twoWeeksOld, canceled], settings, at).deductionSeconds).toBe(0);
  });

  it('supports individual allowances and exempts unlimited students', () => {
    const { settings } = configured(deductionPolicy);
    const overridden = { ...student, weeklyTimeLimitMinutes: 10 };
    const previous = previousWeekCompleted('override-over', 720, settings);
    expect(assessWeeklyTime(overridden, [previous], settings, at)).toMatchObject({ baseAllowanceSeconds: 600, allowanceSeconds: 480, deductionSeconds: 120 });
    expect(assessWeeklyTime({ ...student, weeklyTimeLimitMinutes: 0 }, [previous], settings, at)).toMatchObject({ mode: 'unlimited', allowanceSeconds: undefined, deductionSeconds: 0, blocked: false });
  });

  it('uses the reduced allowance for warnings and eligibility only in weekly mode', async () => {
    const { settings } = configured({ ...deductionPolicy, warningRemainingMinutes: 8 });
    const previous = previousWeekCompleted('three-over-for-warning', 1_380, settings);
    const current = completed('current-nine', new Date(at.getTime() - 1_000), 540);
    expect(weeklyTimeWarningMessage(student, [previous, current], settings, at)).toBe('You have 8 minutes of bathroom time remaining this week.');
    const exhausted = completed('current-seventeen', new Date(at.getTime() - 1_000), 1_020);
    await expect(useEligibility(student, settings, [previous, exhausted], at, 'bathroom')).resolves.toMatchObject({ allowed: false });
    const bathroomMode = { ...settings, usageLimitMode: 'bathroom-passes' as const };
    expect(assessWeeklyTime(student, [previous], bathroomMode, at)).toMatchObject({ mode: 'disabled', deductionSeconds: 0, allowanceSeconds: undefined, blocked: false });
    expect(weeklyTimeWarningMessage(student, [previous, current], bathroomMode, at)).toBe('');
  });

  it('never creates a new weekly suspension and preserves an existing active one', async () => {
    const { settings } = configured({ ...deductionPolicy, automaticSuspensionEnabled: true });
    const currentOvertime = completed('legacy-trigger-attempt', new Date(at.getTime() - 1_000), 1_800);
    expect(assessWeeklyTime(student, [currentOvertime], settings, at).automaticSuspensionTriggered).toBe(false);
    expect(reconcileStudentWeeklyTime(student, [currentOvertime], settings, at)).toEqual(student);
    const legacySuspended = { ...student, passSuspension: { kind: 'automatic' as const, source: 'weekly-time' as const, startedAt: at.toISOString(), endsAt: new Date(at.getTime() + 86_400_000).toISOString(), reasons: ['Legacy weekly suspension'] } };
    const retiredSettings = { ...settings, usageLimitMode: 'bathroom-passes' as const, weeklyTimePolicy: { ...settings.weeklyTimePolicy, enabled: false, automaticSuspensionEnabled: false } };
    expect(reconcileStudentWeeklyTime(legacySuspended, [], retiredSettings, at)).toEqual(legacySuspended);
    expect(activePassSuspension(legacySuspended, retiredSettings, at)).toEqual(legacySuspended.passSuspension);
    await expect(useEligibility(legacySuspended, retiredSettings, [], at)).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('temporarily suspended') });
  });
});

describe('weekly compatibility and encrypted backups', () => {
  it('derives a single mode for existing settings that predate the selector', () => {
    const olderWeekly = { ...defaults, weeklyTimePolicy: { ...defaults.weeklyTimePolicy, enabled: true } } as Partial<Settings>;
    const olderPasses = { ...defaults, weeklyTimePolicy: { ...defaults.weeklyTimePolicy, enabled: false } } as Partial<Settings>;
    delete olderWeekly.usageLimitMode;
    delete olderPasses.usageLimitMode;
    expect(normalizeSettings(olderWeekly).usageLimitMode).toBe('weekly-time');
    expect(normalizeSettings(olderPasses).usageLimitMode).toBe('bathroom-passes');
  });

  it('switches one canonical mode while preserving both configurations', async () => {
    const { settings } = configured({ allowanceMinutes: 24, warningRemainingMinutes: 6, deductOvertimeNextWeek: true, overtimeGraceMinutes: 3 });
    const configuredSettings = { ...settings, globalUseLimit: 4, warningSeconds: 240, overLimitSeconds: 360 };
    await atomicReplace({ students: [student], queue: [], sessions: [], settings: configuredSettings });
    await localAppServices.saveUsageLimitMode('bathroom-passes');
    await expect(getSettings()).resolves.toMatchObject({ usageLimitMode: 'bathroom-passes', globalUseLimit: 4, warningSeconds: 240, overLimitSeconds: 360, weeklyTimePolicy: { enabled: true, allowanceMinutes: 24, warningRemainingMinutes: 6, deductOvertimeNextWeek: true, overtimeGraceMinutes: 3 } });
    await localAppServices.saveUsageLimitMode('weekly-time');
    await expect(getSettings()).resolves.toMatchObject({ usageLimitMode: 'weekly-time', globalUseLimit: 4, warningSeconds: 240, overLimitSeconds: 360, weeklyTimePolicy: { enabled: true, allowanceMinutes: 24, warningRemainingMinutes: 6, deductOvertimeNextWeek: true, overtimeGraceMinutes: 3 } });
  });

  it('normalizes old schema-v4 settings to disabled weekly defaults', async () => {
    const old = { ...defaults, lookupSecret: generateLookupSecret() } as Partial<Settings>;
    delete old.weeklyTimePolicy;
    await db.settings.put(old as Settings);
    await expect(getSettings()).resolves.toMatchObject({ schemaVersion: 4, weeklyTimePolicy: { enabled: false, deductOvertimeNextWeek: false, overtimeGraceMinutes: 0, automaticSuspensionEnabled: false, allowanceMinutes: 20 } });
  });

  it('round-trips weekly policy, override, and suspension state through an encrypted backup', async () => {
    const { settings } = configured({ deductOvertimeNextWeek: true, overtimeGraceMinutes: 2, automaticSuspensionEnabled: true });
    const suspended = { ...student, weeklyTimeLimitMinutes: 10, passSuspension: { kind: 'automatic' as const, source: 'weekly-time' as const, startedAt: at.toISOString(), endsAt: new Date(at.getTime() + 86_400_000).toISOString(), reasons: ['Legacy weekly suspension'] } };
    const previous = previousWeekCompleted('backup-overage', 780, settings);
    await atomicReplace({ students: [suspended], queue: [], sessions: [previous], settings });
    const backup = await createEncryptedBackup('correct horse battery');
    await atomicReplace({ students: [], queue: [], sessions: [], settings: { ...defaults, lookupSecret: generateLookupSecret() } });
    await restoreAnyBackup(backup, await getSettings(), 'correct horse battery');
    const restoredSettings = await getSettings();
    expect(restoredSettings).toMatchObject({ usageLimitMode: 'weekly-time', weeklyTimePolicy: { enabled: true, deductOvertimeNextWeek: true, overtimeGraceMinutes: 2, automaticSuspensionEnabled: true } });
    expect(await db.students.get(student.id)).toMatchObject({ weeklyTimeLimitMinutes: 10, passSuspension: { source: 'weekly-time' } });
    expect(assessWeeklyTime(suspended, await db.sessions.toArray(), restoredSettings, at)).toMatchObject({ baseAllowanceSeconds: 600, deductionSeconds: 60, allowanceSeconds: 540 });
  });

  it('restores an older encrypted v4 backup with no weekly fields using disabled defaults', async () => {
    const { settings } = configured();
    await atomicReplace({ students: [student], queue: [], sessions: [], settings });
    const backup = await createEncryptedBackup('correct horse battery');
    const payload = await decryptBackup(backup, 'correct horse battery');
    delete (payload.data.settings as Partial<Settings>).weeklyTimePolicy;
    delete (payload.data.settings as Partial<Settings>).usageLimitMode;
    for (const item of payload.data.students) {
      delete item.weeklyTimeLimitMinutes;
      delete item.lastWeeklyTimeSuspensionTriggerKey;
    }
    const oldBackup = await encryptPayload(backup, payload, 'correct horse battery');
    await restoreAnyBackup(oldBackup, await getSettings(), 'correct horse battery');
    expect(await getSettings()).toMatchObject({ usageLimitMode: 'bathroom-passes', weeklyTimePolicy: { enabled: false, deductOvertimeNextWeek: false, overtimeGraceMinutes: 0, automaticSuspensionEnabled: false, warningRemainingMinutes: 5 } });
  });

  it('restores an older encrypted v4 backup without overtime-deduction fields', async () => {
    const { settings } = configured({ allowanceMinutes: 22, deductOvertimeNextWeek: true, overtimeGraceMinutes: 3 });
    await atomicReplace({ students: [student], queue: [], sessions: [], settings });
    const backup = await createEncryptedBackup('correct horse battery');
    const payload = await decryptBackup(backup, 'correct horse battery');
    delete (payload.data.settings.weeklyTimePolicy as Partial<WeeklyTimePolicy>).deductOvertimeNextWeek;
    delete (payload.data.settings.weeklyTimePolicy as Partial<WeeklyTimePolicy>).overtimeGraceMinutes;
    const oldBackup = await encryptPayload(backup, payload, 'correct horse battery');
    await restoreAnyBackup(oldBackup, await getSettings(), 'correct horse battery');
    expect(await getSettings()).toMatchObject({ usageLimitMode: 'weekly-time', weeklyTimePolicy: { enabled: true, allowanceMinutes: 22, deductOvertimeNextWeek: false, overtimeGraceMinutes: 0 } });
  });

  it('restores an older encrypted backup without a mode using its weekly enabled state', async () => {
    const { settings } = configured({ allowanceMinutes: 22, warningRemainingMinutes: 4 });
    await atomicReplace({ students: [student], queue: [], sessions: [], settings });
    const backup = await createEncryptedBackup('correct horse battery');
    const payload = await decryptBackup(backup, 'correct horse battery');
    delete (payload.data.settings as Partial<Settings>).usageLimitMode;
    const oldBackup = await encryptPayload(backup, payload, 'correct horse battery');
    await restoreAnyBackup(oldBackup, await getSettings(), 'correct horse battery');
    expect(await getSettings()).toMatchObject({ usageLimitMode: 'weekly-time', weeklyTimePolicy: { enabled: true, allowanceMinutes: 22, warningRemainingMinutes: 4 } });
  });
});

async function encryptPayload(template: EncryptedBackupV4, payload: unknown, password: string): Promise<EncryptedBackupV4> {
  const salt = base64UrlToBytes(template.kdf.salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: template.kdf.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { ...template, cipher: { name: 'AES-GCM', iv: bytesToBase64Url(iv) }, ciphertext: bytesToBase64Url(new Uint8Array(encrypted)) };
}
