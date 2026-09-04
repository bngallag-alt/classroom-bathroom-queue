import { beforeEach, describe, expect, it } from 'vitest';
import { atomicReplace, db, defaults, getSettings } from '../db';
import {
  activePassSuspension,
  assessProbation,
  normalizeProbationPolicy,
  probationMetrics,
  probationWarningMessages,
  reconcileStudentProbation,
  validateProbationPolicy,
} from '../probation';
import { addToQueue, createEncryptedBackup, decryptBackup, finishActive, restoreAnyBackup, useEligibility } from '../lib';
import { base64UrlToBytes, bytesToBase64Url, generateLookupSecret } from '../privacy';
import { localAppServices } from '../services';
import type { EncryptedBackupV4, ProbationPolicy, Session, Settings, Student } from '../types';

const at = new Date('2026-09-02T12:00:00.000Z');
const student: Student = {
  id: 'student-a',
  name: 'Fictional Student',
  externalIdHash: 'a'.repeat(64),
  externalIdLast4: '1234',
  createdAt: at.toISOString(),
  updatedAt: at.toISOString(),
};

function session(id: string, daysAgo: number, options: Partial<Session> = {}): Session {
  const endedAt = new Date(at.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id,
    studentId: student.id,
    studentName: student.name,
    queuedAt: endedAt,
    startedAt: endedAt,
    endedAt,
    durationSeconds: 500,
    durationFormatted: '8:20',
    reachedWarning: true,
    overLimit: true,
    status: 'completed',
    passType: 'bathroom',
    ...options,
  };
}

function settings(policyChanges: Partial<ProbationPolicy> = {}): Settings {
  const policy = normalizeProbationPolicy({
    ...policyChanges,
    rules: {
      ...defaults.probationPolicy.rules,
      ...policyChanges.rules,
    },
  });
  return { ...defaults, setupComplete: true, lookupSecret: generateLookupSecret(), probationPolicy: policy };
}

function enabledPolicy(changes: Partial<ProbationPolicy> = {}): ProbationPolicy {
  return normalizeProbationPolicy({
    warningsEnabled: true,
    automaticSuspensionsEnabled: true,
    automaticSuspensionAcknowledged: true,
    ...changes,
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await atomicReplace({ students: [student], queue: [], sessions: [], settings: settings() });
});

describe('rolling probation metrics', () => {
  it('includes the exact 30-day boundary and excludes older, future, and canceled records', () => {
    const records = [
      session('boundary', 30),
      session('older', 30, { endedAt: new Date(at.getTime() - 30 * 86_400_000 - 1).toISOString() }),
      session('future', -1),
      session('canceled', 1, { status: 'teacher-canceled' }),
      session('recent-not-over', 1, { overLimit: false }),
    ];
    expect(probationMetrics(student.id, records, settings(), at)).toEqual({ completedUses: 2, overtimeCount: 1, overtimePercent: 50 });
  });

  it('respects the existing water-pass counting preference', () => {
    const records = [session('bathroom', 1), session('water', 1, { passType: 'water' })];
    expect(probationMetrics(student.id, records, settings(), at).completedUses).toBe(1);
    expect(probationMetrics(student.id, records, { ...settings(), countWaterAsBathroom: true }, at).completedUses).toBe(2);
  });

  it('normalizes legacy completed-use and percentage rules to inactive compatibility fields', () => {
    const policy = enabledPolicy({ minimumUsesForPercent: 3, rules: {
      uses: { enabled: true, warningThreshold: 1, suspensionThreshold: 2 },
      overtimeCount: { enabled: false, warningThreshold: 1, suspensionThreshold: 2 },
      overtimePercent: { enabled: true, warningThreshold: 50, suspensionThreshold: 75 },
    } });
    const result = assessProbation(student, [session('one', 1), session('two', 2)], settings(policy), at);
    expect(result.metrics.overtimePercent).toBe(100);
    expect(policy.rules.uses.enabled).toBe(false);
    expect(policy.rules.overtimePercent.enabled).toBe(false);
    expect(policy.warningsEnabled).toBe(false);
    expect(policy.automaticSuspensionsEnabled).toBe(false);
    expect(result.statuses).toEqual([]);
  });

  it('keeps legacy aggregate metrics available without using them as automatic rules', () => {
    const policy = enabledPolicy({ rules: {
      uses: { enabled: true, warningThreshold: 1, suspensionThreshold: 2 },
      overtimeCount: { enabled: true, warningThreshold: 2, suspensionThreshold: 3 },
      overtimePercent: { enabled: true, warningThreshold: 1, suspensionThreshold: 2 },
    } });
    const records = [session('one', 1), session('two', 2), session('three', 3, { overLimit: false })];
    const configured = settings(policy);
    const result = assessProbation(student, records, configured, at);
    expect(result.metrics.overtimePercent).toBeCloseTo(66.6667, 3);
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0]).toMatchObject({ metric: 'overtimeCount', value: 2, warningReached: true, suspensionReached: false });
    expect(probationWarningMessages(student, records, configured, at)[0]).toContain('1 more over-limit return');
  });
});

describe('policy evaluation and warnings', () => {
  const overtimeOnlyRules = {
    uses: { enabled: true, warningThreshold: 1, suspensionThreshold: 2 },
    overtimeCount: { enabled: true, warningThreshold: 1, suspensionThreshold: 2 },
    overtimePercent: { enabled: true, warningThreshold: 50, suspensionThreshold: 75 },
  };

  it('supports overtime-count warnings and accurate remaining-return wording', () => {
    const policy = enabledPolicy({ rules: overtimeOnlyRules });
    const configured = settings(policy);
    const assessment = assessProbation(student, [session('one', 1)], configured, at);
    expect(assessment.warningMetrics).toEqual(['overtimeCount']);
    expect(probationWarningMessages(student, [session('one', 1)], configured, at)[0]).toContain('1 more over-limit return');
  });

  it('does not expose warning results when warnings are switched off', () => {
    const configured = settings(normalizeProbationPolicy({
      warningsEnabled: false,
      automaticSuspensionsEnabled: false,
      rules: { ...overtimeOnlyRules, overtimeCount: { enabled: true, warningThreshold: 1, suspensionThreshold: 2 } },
    }));
    const assessment = assessProbation(student, [session('one', 1)], configured, at);
    expect(assessment.statuses[0]).toMatchObject({ warningReached: true });
    expect(assessment.warningMetrics).toEqual([]);
    expect(probationWarningMessages(student, [session('one', 1)], configured, at)).toEqual([]);
  });

  it('does not warn or newly suspend from overtime rules in weekly-time mode', () => {
    const configured = { ...settings(enabledPolicy({ rules: overtimeOnlyRules })), usageLimitMode: 'weekly-time' as const };
    const records = [session('one', 1), session('two', 2)];
    const assessment = assessProbation(student, records, configured, at);
    expect(assessment.warningMetrics).toEqual([]);
    expect(assessment.suspensionTriggered).toBe(false);
    expect(reconcileStudentProbation(student, records, configured, at).passSuspension).toBeUndefined();
  });

  it('ignores legacy use, percentage, and trigger-mode rules', () => {
    const onTimeRecords = [session('one', 1, { overLimit: false }), session('two', 2, { overLimit: false })];
    const configured = settings(enabledPolicy({ triggerMode: 'all', rules: overtimeOnlyRules }));
    expect(configured.probationPolicy.triggerMode).toBe('any');
    expect(configured.probationPolicy.rules.uses.enabled).toBe(false);
    expect(configured.probationPolicy.rules.overtimePercent.enabled).toBe(false);
    expect(assessProbation(student, onTimeRecords, configured, at).suspensionTriggered).toBe(false);
    expect(assessProbation(student, [session('three', 1), session('four', 2)], configured, at).suspensionTriggered).toBe(true);
  });

  it('excludes exempt students from metrics, warnings, and automatic suspensions', () => {
    const exempt = { ...student, probationExempt: true };
    const result = assessProbation(exempt, [session('one', 1), session('two', 2)], settings(enabledPolicy({ rules: overtimeOnlyRules })), at);
    expect(result.metrics).toEqual({ completedUses: 0, overtimeCount: 0, overtimePercent: 0 });
    expect(result.warningMetrics).toEqual([]);
    expect(result.suspensionTriggered).toBe(false);
  });

  it('validates acknowledgement, integer ranges, and overtime threshold order', () => {
    expect(validateProbationPolicy(normalizeProbationPolicy({ automaticSuspensionsEnabled: true, automaticSuspensionAcknowledged: false }))).toMatch(/Acknowledge/);
    expect(validateProbationPolicy(normalizeProbationPolicy({ rules: { ...defaults.probationPolicy.rules, overtimeCount: { enabled: true, warningThreshold: 4, suspensionThreshold: 4 } } }))).toMatch(/lower/);
    expect(validateProbationPolicy(normalizeProbationPolicy({ rules: { ...defaults.probationPolicy.rules, overtimeCount: { enabled: true, warningThreshold: -1, suspensionThreshold: 4 } } }))).toMatch(/zero or more/);
    expect(validateProbationPolicy(normalizeProbationPolicy({ rules: { ...defaults.probationPolicy.rules, overtimePercent: { enabled: true, warningThreshold: 50, suspensionThreshold: 101 } } }))).toBe('');
  });
});

describe('suspension lifecycle and compatibility', () => {
  const policy = enabledPolicy({ rules: {
    uses: { enabled: false, warningThreshold: 1, suspensionThreshold: 2 },
    overtimeCount: { enabled: true, warningThreshold: 1, suspensionThreshold: 2 },
    overtimePercent: { enabled: false, warningThreshold: 50, suspensionThreshold: 75 },
  } });

  it('creates one automatic suspension on a crossing and does not reuse the same history after expiry', () => {
    const configured = settings(policy);
    const records = [session('one', 2), session('two', 1)];
    const suspended = reconcileStudentProbation(student, records, configured, at);
    expect(activePassSuspension(suspended, configured, at)?.kind).toBe('automatic');
    const afterExpiry = new Date(at.getTime() + 8 * 86_400_000);
    expect(activePassSuspension(suspended, configured, afterExpiry)).toBeUndefined();
    const unchanged = reconcileStudentProbation(suspended, records, configured, afterExpiry);
    expect(unchanged.passSuspension?.startedAt).toBe(suspended.passSuspension?.startedAt);
    const later = session('three', -8, { endedAt: afterExpiry.toISOString() });
    expect(reconcileStudentProbation(suspended, [...records, later], configured, afterExpiry).passSuspension?.startedAt).toBe(suspended.passSuspension?.startedAt);
    const rearmed = reconcileStudentProbation({ ...suspended, lastAutoSuspensionTriggerKey: undefined }, records, configured, afterExpiry, true);
    expect(rearmed.passSuspension?.startedAt).toBe(afterExpiry.toISOString());
  });

  it('keeps an existing rolling suspension active after switching to weekly-time mode', () => {
    const configured = settings(policy);
    const records = [session('one', 2), session('two', 1)];
    const suspended = reconcileStudentProbation(student, records, configured, at);
    const weeklyMode = { ...configured, usageLimitMode: 'weekly-time' as const, weeklyTimePolicy: { ...configured.weeklyTimePolicy, enabled: true } };
    expect(activePassSuspension(suspended, weeklyMode, at)).toEqual(suspended.passSuspension);
    expect(reconcileStudentProbation(suspended, records, weeklyMode, at).passSuspension).toEqual(suspended.passSuspension);
  });

  it('does not treat an unrelated policy edit as a new crossing, while explicit rearm still works', async () => {
    const date = new Date();
    const configured = settings(policy);
    const records = [
      session('recent-one', 0, { endedAt: new Date(date.getTime() - 120_000).toISOString() }),
      session('recent-two', 0, { endedAt: new Date(date.getTime() - 60_000).toISOString() }),
    ];
    const originallySuspended = reconcileStudentProbation(student, records, configured, date);
    const expiredAt = new Date(date.getTime() - 1_000).toISOString();
    const expired = { ...originallySuspended, passSuspension: { ...originallySuspended.passSuspension!, endsAt: expiredAt } };
    await atomicReplace({ students: [expired], queue: [], sessions: records, settings: configured });

    await localAppServices.saveProbationPolicy({ ...policy, suspensionDays: 8 });
    expect((await db.students.get(student.id))?.passSuspension?.endsAt).toBe(expiredAt);

    await localAppServices.rearmProbation(student.id);
    expect(new Date((await db.students.get(student.id))!.passSuspension!.endsAt).getTime()).toBeGreaterThan(date.getTime());
  });

  it('keeps manual permanent bans independent from temporary suspensions', async () => {
    const configured = settings(policy);
    await expect(useEligibility({ ...student, banned: true }, configured, [])).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('not available') });
    const manuallySuspended = { ...student, passSuspension: { kind: 'manual' as const, startedAt: at.toISOString(), endsAt: new Date(at.getTime() + 86_400_000).toISOString(), reasons: ['Teacher-applied temporary suspension'] } };
    await expect(useEligibility(manuallySuspended, { ...configured, probationPolicy: { ...policy, automaticSuspensionsEnabled: false } }, [], at)).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('temporarily suspended') });
  });

  it('atomically replaces a permanent ban with a persisted manual temporary suspension', async () => {
    await db.students.update(student.id, { banned: true });
    await localAppServices.applyManualSuspension(student.id, 7);

    const saved = await db.students.get(student.id);
    expect(saved).toMatchObject({
      banned: false,
      passSuspension: {
        kind: 'manual',
        source: 'manual',
        reasons: ['Teacher-applied temporary suspension'],
      },
    });
    expect(new Date(saved!.passSuspension!.endsAt).getTime()).toBeGreaterThan(new Date(saved!.passSuspension!.startedAt).getTime());
  });

  it('persists moved usage settings without dropping the hidden legacy water preference or records', async () => {
    const legacyWater = session('legacy-water', 1, { passType: 'water' });
    await atomicReplace({ students: [student], queue: [], sessions: [legacyWater], settings: { ...settings(), countWaterAsBathroom: true } });
    const current = await getSettings();
    await localAppServices.saveSettings({
      ...current,
      globalUseLimit: 6,
      warningSeconds: 240,
      overLimitSeconds: 360,
      weeklyTimePolicy: { ...current.weeklyTimePolicy, enabled: true, allowanceMinutes: 18 },
    });

    await expect(getSettings()).resolves.toMatchObject({
      globalUseLimit: 6,
      warningSeconds: 240,
      overLimitSeconds: 360,
      countWaterAsBathroom: true,
      weeklyTimePolicy: { enabled: true, allowanceMinutes: 18 },
    });
    await expect(db.sessions.get('legacy-water')).resolves.toMatchObject({ passType: 'water', status: 'completed' });
  });

  it('evaluates a newly completed session and blocks queue entry through the shared eligibility path', async () => {
    const configured = settings(policy);
    const recent = new Date(Date.now() - 120_000).toISOString();
    await atomicReplace({
      students: [student],
      queue: [{ id: 'active-entry', studentId: student.id, queuedAt: recent, startedAt: new Date(Date.now() - 480_000).toISOString(), status: 'active', passType: 'bathroom' }],
      sessions: [session('prior', 0, { endedAt: recent })],
      settings: configured,
    });
    await finishActive();
    expect(activePassSuspension((await db.students.get(student.id))!, configured)?.kind).toBe('automatic');
    await expect(addToQueue(student.id)).rejects.toThrow(/temporarily suspended/);
  });

  it('normalizes old settings to disabled defaults without changing schema v4', async () => {
    const old = { ...defaults } as Partial<Settings>;
    delete old.probationPolicy;
    await db.settings.put(old as Settings);
    await expect(getSettings()).resolves.toMatchObject({ schemaVersion: 4, privacyVersion: 4, probationPolicy: { warningsEnabled: false, automaticSuspensionsEnabled: false } });
  });

  it('round-trips new policy and suspension state through an encrypted backup', async () => {
    const configured = settings(policy);
    const suspended = reconcileStudentProbation(student, [session('one', 2), session('two', 1)], configured, at);
    await atomicReplace({ students: [suspended], queue: [], sessions: [], settings: configured });
    const backup = await createEncryptedBackup('correct horse battery');
    await atomicReplace({ students: [], queue: [], sessions: [], settings: settings() });
    await restoreAnyBackup(backup, await getSettings(), 'correct horse battery');
    expect((await getSettings()).probationPolicy.automaticSuspensionsEnabled).toBe(true);
    expect((await db.students.get(student.id))?.passSuspension?.kind).toBe('automatic');
  });

  it('restores an older encrypted v4 backup with no probation fields using disabled defaults', async () => {
    const backup = await createEncryptedBackup('correct horse battery');
    const payload = await decryptBackup(backup, 'correct horse battery');
    delete (payload.data.settings as Partial<Settings>).probationPolicy;
    const oldBackup = await encryptPayload(backup, payload, 'correct horse battery');
    await restoreAnyBackup(oldBackup, await getSettings(), 'correct horse battery');
    expect((await getSettings()).probationPolicy).toMatchObject({ warningsEnabled: false, automaticSuspensionsEnabled: false });
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
