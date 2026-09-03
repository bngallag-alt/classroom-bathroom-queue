import { beforeEach, describe, expect, it } from 'vitest';
import { atomicReplace, db, defaults, getSettings } from '../db';
import { createEncryptedBackup, decryptBackup, restoreAnyBackup, useEligibility } from '../lib';
import { normalizeProbationPolicy, reconcileStudentProbation } from '../probation';
import { base64UrlToBytes, bytesToBase64Url, generateLookupSecret } from '../privacy';
import type { EncryptedBackupV4, Session, Settings, Student, Weekday, WeeklyTimePolicy } from '../types';
import {
  assessWeeklyTime,
  defaultWeeklyTimePolicy,
  effectiveWeeklyAllowance,
  formatWeeklyDuration,
  normalizeWeeklyTimePolicy,
  reconcileStudentWeeklyTime,
  schoolWeek,
  validateWeeklyTimePolicy,
  weeklyCountedSessions,
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
    expect(defaultWeeklyTimePolicy).toMatchObject({ enabled: false, allowanceMinutes: 20, resetDay: 1, automaticSuspensionEnabled: false, overageGraceMinutes: 1, suspensionDays: 7 });
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ allowanceMinutes: 0 }), true)).toMatch(/positive whole number/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ overageGraceMinutes: -1 }), true)).toMatch(/nonnegative/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ suspensionDays: 31 }), true)).toMatch(/1 through 30/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ enabled: false, automaticSuspensionEnabled: true }), true)).toMatch(/Enable the weekly/);
    expect(validateWeeklyTimePolicy(normalizeWeeklyTimePolicy({ enabled: true, automaticSuspensionEnabled: true }), false)).toMatch(/Acknowledge/);
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
});

describe('weekly automatic suspensions', () => {
  const automatic = { automaticSuspensionEnabled: true, overageGraceMinutes: 1, suspensionDays: 1 };

  it('compares the overage in exact seconds', () => {
    const { settings } = configured(automatic);
    expect(assessWeeklyTime(student, [completed('under', new Date(at.getTime() - 1_000), 1_259)], settings, at).automaticSuspensionTriggered).toBe(false);
    expect(assessWeeklyTime(student, [completed('at', new Date(at.getTime() - 1_000), 1_260)], settings, at).automaticSuspensionTriggered).toBe(true);
  });

  it('creates one source-specific suspension and does not reuse identical history after expiry', () => {
    const { settings } = configured(automatic);
    const records = [completed('overage', new Date(at.getTime() - 1_000), 1_275)];
    const suspended = reconcileStudentWeeklyTime(student, records, settings, at);
    expect(suspended.passSuspension).toMatchObject({ kind: 'automatic', source: 'weekly-time', reasons: ['Weekly bathroom-time allowance exceeded by 1 minute 15 seconds.'] });
    expect(suspended.lastWeeklyTimeSuspensionTriggerKey).toContain('overage');
    const afterExpiry = new Date(at.getTime() + 2 * 86_400_000);
    const unchanged = reconcileStudentWeeklyTime(suspended, records, settings, afterExpiry);
    expect(unchanged.passSuspension?.startedAt).toBe(suspended.passSuspension?.startedAt);
    const newRelevantSession = completed('new-overage-use', new Date(afterExpiry.getTime() - 1_000), 60);
    const newlySuspended = reconcileStudentWeeklyTime(suspended, [...records, newRelevantSession], settings, afterExpiry);
    expect(newlySuspended.passSuspension?.startedAt).toBe(afterExpiry.toISOString());
    const rearmed = reconcileStudentWeeklyTime({ ...suspended, lastWeeklyTimeSuspensionTriggerKey: undefined }, records, settings, afterExpiry, true);
    expect(rearmed.passSuspension?.startedAt).toBe(afterExpiry.toISOString());
  });

  it('keeps weekly and rolling trigger tracking independent', () => {
    const { settings } = configured(automatic);
    const withRollingKey = { ...student, lastAutoSuspensionTriggerKey: 'rolling-existing' };
    const weekly = reconcileStudentWeeklyTime(withRollingKey, [completed('overage', new Date(at.getTime() - 1_000), 1_260)], settings, at);
    expect(weekly.lastAutoSuspensionTriggerKey).toBe('rolling-existing');
    expect(weekly.lastWeeklyTimeSuspensionTriggerKey).toContain('overage');
    expect(reconcileStudentProbation(weekly, [], settings, at)).toMatchObject({ lastAutoSuspensionTriggerKey: 'rolling-existing', lastWeeklyTimeSuspensionTriggerKey: weekly.lastWeeklyTimeSuspensionTriggerKey });
  });

  it('keeps the rolling-probation exemption separate from weekly enforcement', () => {
    const { settings } = configured(automatic);
    const exemptFromRolling = { ...student, probationExempt: true };
    const result = reconcileStudentWeeklyTime(exemptFromRolling, [completed('weekly-overage', new Date(at.getTime() - 1_000), 1_260)], settings, at);
    expect(result.passSuspension).toMatchObject({ source: 'weekly-time' });
  });

  it('keeps permanent bans and manual temporary suspensions independent', async () => {
    const { settings } = configured(automatic);
    await expect(useEligibility({ ...student, banned: true }, settings, [], at)).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('not available') });
    const manual = { ...student, passSuspension: { kind: 'manual' as const, source: 'manual' as const, startedAt: at.toISOString(), endsAt: new Date(at.getTime() + 86_400_000).toISOString(), reasons: ['Teacher-applied temporary suspension'] } };
    await expect(useEligibility(manual, settings, [], at)).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('temporarily suspended') });
  });
});

describe('weekly compatibility and encrypted backups', () => {
  it('normalizes old schema-v4 settings to disabled weekly defaults', async () => {
    const old = { ...defaults, lookupSecret: generateLookupSecret() } as Partial<Settings>;
    delete old.weeklyTimePolicy;
    await db.settings.put(old as Settings);
    await expect(getSettings()).resolves.toMatchObject({ schemaVersion: 4, weeklyTimePolicy: { enabled: false, automaticSuspensionEnabled: false, allowanceMinutes: 20 } });
  });

  it('round-trips weekly policy, override, and suspension state through an encrypted backup', async () => {
    const { settings } = configured({ automaticSuspensionEnabled: true, overageGraceMinutes: 1 });
    const overridden = { ...student, weeklyTimeLimitMinutes: 10 };
    const suspended = reconcileStudentWeeklyTime(overridden, [completed('overage', new Date(at.getTime() - 1_000), 660)], settings, at);
    await atomicReplace({ students: [suspended], queue: [], sessions: [], settings });
    const backup = await createEncryptedBackup('correct horse battery');
    await atomicReplace({ students: [], queue: [], sessions: [], settings: { ...defaults, lookupSecret: generateLookupSecret() } });
    await restoreAnyBackup(backup, await getSettings(), 'correct horse battery');
    expect((await getSettings()).weeklyTimePolicy).toMatchObject({ enabled: true, automaticSuspensionEnabled: true });
    expect(await db.students.get(student.id)).toMatchObject({ weeklyTimeLimitMinutes: 10, passSuspension: { source: 'weekly-time' }, lastWeeklyTimeSuspensionTriggerKey: expect.any(String) });
  });

  it('restores an older encrypted v4 backup with no weekly fields using disabled defaults', async () => {
    const { settings } = configured();
    await atomicReplace({ students: [student], queue: [], sessions: [], settings });
    const backup = await createEncryptedBackup('correct horse battery');
    const payload = await decryptBackup(backup, 'correct horse battery');
    delete (payload.data.settings as Partial<Settings>).weeklyTimePolicy;
    for (const item of payload.data.students) {
      delete item.weeklyTimeLimitMinutes;
      delete item.lastWeeklyTimeSuspensionTriggerKey;
    }
    const oldBackup = await encryptPayload(backup, payload, 'correct horse battery');
    await restoreAnyBackup(oldBackup, await getSettings(), 'correct horse battery');
    expect((await getSettings()).weeklyTimePolicy).toMatchObject({ enabled: false, automaticSuspensionEnabled: false });
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
