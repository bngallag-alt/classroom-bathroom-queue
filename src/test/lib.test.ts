import { beforeEach, describe, expect, it } from 'vitest';
import { atomicReplace, db, defaults, getSettings, snapshot } from '../db';
import {
  addToQueue,
  createEncryptedBackup,
  decryptBackup,
  finishActive,
  formatDuration,
  HOTKEY_OPTIONS,
  historyCsv,
  hotkeyMatches,
  parseRosterCsv,
  purgedHistoryCsv,
  restoreAnyBackup,
  rosterCsv,
  resolveTeacherHotkeyAfterRestore,
  startTimer,
  studentIdKeyboardAction,
  studentStats,
  timerLevel,
  useEligibility,
  validateStudent,
  validateHotkeyPair,
} from '../lib';
import {
  deriveExternalIdHash,
  generateLookupSecret,
  normalizeExternalId,
} from '../privacy';
import { ensurePrivacyMigration } from '../migration';
import { purgeDetailedHistory } from '../retention';
import type { LegacyBackup, QueueEntry, Session, Student } from '../types';

const stamp = '2026-08-30T12:00:00.000Z';
let secret = '';

async function student(id: string, name: string, raw: string): Promise<Student> {
  return {
    id,
    name,
    externalIdHash: await deriveExternalIdHash(secret, raw),
    externalIdLast4: raw.slice(-4),
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function session(id: string, studentId = 'a', endedAt = stamp): Session {
  return {
    id,
    studentId,
    studentName: 'Fictional Alpha',
    queuedAt: stamp,
    startedAt: stamp,
    endedAt,
    durationSeconds: 500,
    durationFormatted: '8:20',
    reachedWarning: true,
    overLimit: true,
    status: 'completed',
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  secret = generateLookupSecret();
  await atomicReplace({
    students: [],
    queue: [],
    sessions: [],
    settings: {
      ...defaults,
      lookupSecret: secret,
      setupComplete: true,
      pinHash: 'pin-hash',
      pinSalt: 'pin-salt',
      privacyMigrationCompletedAt: stamp,
    },
  });
});

describe('privacy lookup', () => {
  it('normalizes conservatively and preserves leading zeroes', async () => {
    expect(normalizeExternalId(' 001482 ')).toBe('001482');
    await expect(deriveExternalIdHash(secret, '001482')).resolves.not.toBe(
      await deriveExternalIdHash(secret, '1482'),
    );
    expect(() => normalizeExternalId('12A')).toThrow('digits only');
  });

  it('uses a per-installation keyed HMAC', async () => {
    expect(await deriveExternalIdHash(secret, '001482')).not.toBe(
      await deriveExternalIdHash(generateLookupSecret(), '001482'),
    );
  });

  it('finds only an exact complete ID', async () => {
    const record = await student('a', 'Fictional Alpha', '001482');
    await db.students.add(record);
    const { localAppServices } = await import('../services');
    await expect(localAppServices.findStudentByExternalId('001482')).resolves.toMatchObject({ id: 'a' });
    await expect(localAppServices.findStudentByExternalId('0014')).resolves.toBeUndefined();
    await expect(localAppServices.findStudentByExternalId('001483')).resolves.toBeUndefined();
  });
});

describe('queue and retained statistics', () => {
  it('keeps internal UUID relationships and timer behavior', async () => {
    const first = await student('a', 'Fictional Alpha', '001482');
    const second = await student('b', 'Fictional Beta', '001937');
    await db.students.bulkAdd([first, second]);
    await addToQueue(first.id);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await addToQueue(second.id);
    const queue = await db.queue.orderBy('queuedAt').toArray();
    await expect(startTimer(queue[1].id)).rejects.toThrow('first');
    await startTimer(queue[0].id);
    expect((await db.queue.get(queue[0].id))?.startedAt).toBeTruthy();
    await finishActive();
    expect((await db.queue.get(queue[1].id))?.startedAt).toBeUndefined();
    expect((await db.sessions.toArray())[0]).not.toHaveProperty('studentIdSnapshot');
  });

  it('purges expired history after completing a session without touching the waiting queue', async () => {
    const first = await student('a', 'Fictional Alpha', '001482');
    const second = await student('b', 'Fictional Beta', '001937');
    await db.students.bulkAdd([first, second]);
    await db.sessions.add(session('expired', first.id, '2020-01-01T00:00:00.000Z'));
    await addToQueue(first.id);
    await startTimer((await db.queue.toArray())[0].id);
    await addToQueue(second.id);
    await finishActive();
    expect(await db.sessions.get('expired')).toBeUndefined();
    await expect(db.queue.where('studentId').equals(second.id).first()).resolves.toBeTruthy();
  });

  it('formats and classifies timers', () => {
    expect(formatDuration(299)).toBe('4:59');
    expect(timerLevel(300, defaults)).toBe('warning');
    expect(timerLevel(420, defaults)).toBe('over');
  });

  it('counts completed retained records, not cancellations or warnings', async () => {
    const record = await student('a', 'Fictional Alpha', '001482');
    const completedOver = session('over');
    const completedWarning = { ...session('warning'), overLimit: false };
    const canceled = { ...session('canceled'), status: 'teacher-canceled' as const };
    expect(studentStats([record], [completedOver, completedWarning, canceled], defaults)[0]).toMatchObject({
      total: 2,
      over: 1,
      percent: 50,
    });
    expect((await useEligibility(record, { ...defaults, globalUseLimit: 2 }, [completedOver, completedWarning])).allowed).toBe(false);
  });
});

describe('retention', () => {
  it('purges older records and keeps the exact boundary, recent, invalid, and active records', async () => {
    const at = new Date('2026-08-30T12:00:00.000Z');
    const boundary = new Date(at.getTime() - 30 * 86_400_000).toISOString();
    const older = new Date(new Date(boundary).getTime() - 1).toISOString();
    const recent = new Date(at.getTime() - 1000).toISOString();
    await db.sessions.bulkAdd([
      session('old', 'a', older),
      session('boundary', 'a', boundary),
      session('recent', 'a', recent),
      session('invalid', 'a', 'not-a-date'),
    ]);
    await db.queueHistory.bulkAdd([
      { id: 'old-q', queueEntryId: 'q', studentId: 'a', joinedAt: stamp, exitedAt: older, waitDurationSeconds: 1, exitReason: 'student-removed', createdAt: older, updatedAt: older },
      { id: 'boundary-q', queueEntryId: 'q2', studentId: 'a', joinedAt: stamp, exitedAt: boundary, waitDurationSeconds: 1, exitReason: 'student-removed', createdAt: boundary, updatedAt: boundary },
    ]);
    await db.queue.add({ id: 'active', studentId: 'a', queuedAt: stamp, startedAt: stamp, status: 'active' });
    await purgeDetailedHistory(at);
    expect((await db.sessions.toArray()).map((item) => item.id).sort()).toEqual(['boundary', 'invalid', 'recent']);
    expect((await db.queueHistory.toArray()).map((item) => item.id)).toEqual(['boundary-q']);
    expect(await db.queue.get('active')).toBeTruthy();
    expect((await getSettings()).lastSuccessfulPurgeAt).toBe(at.toISOString());
  });

  it('purges before full backup and history export', async () => {
    await db.sessions.add(session('old', 'a', '2020-01-01T00:00:00.000Z'));
    const encrypted = await createEncryptedBackup('correct horse battery');
    expect((await decryptBackup(encrypted, 'correct horse battery')).data.sessions).toEqual([]);
    await db.sessions.add(session('old-again', 'a', '2020-01-01T00:00:00.000Z'));
    expect(await purgedHistoryCsv()).not.toContain('old-again');
    expect(await db.sessions.get('old-again')).toBeUndefined();
  });
});

describe('version 3 to 4 migration', () => {
  it('atomically preserves setup, relationships, queue order, schedules, limits, bans, and active timestamp', async () => {
    await db.students.clear();
    await db.bellSchedules.clear();
    await db.settings.put({
      ...defaults,
      schemaVersion: 3,
      privacyVersion: 3,
      lookupSecret: '',
      setupComplete: true,
      pinHash: 'old-pin',
      pinSalt: 'old-salt',
      warningSeconds: 240,
      overLimitSeconds: 360,
      globalUseLimit: 4,
      teacherHotkey: 'Ctrl+Shift+9',
    } as never);
    await db.students.bulkAdd([
      { id: 'one', name: 'Fictional One', studentId: '001001', createdAt: stamp, updatedAt: stamp, maxUses: 2, banned: true },
      { id: 'two', name: 'Fictional Two', studentId: '001002', createdAt: stamp, updatedAt: stamp },
    ] as never);
    await db.classes.add({ id: 'class', period: 'P1', createdAt: stamp, updatedAt: stamp });
    await db.enrollments.add({ id: 'enrollment', studentId: 'one', classId: 'class', createdAt: stamp, updatedAt: stamp });
    await db.bellSchedules.add({ id: 'custom', name: 'Custom schedule', createdAt: stamp, updatedAt: stamp, days: {} });
    const activeStarted = '2026-08-30T11:55:00.000Z';
    await db.queue.bulkAdd([
      { id: 'active', studentId: 'one', queuedAt: '2026-08-30T11:50:00.000Z', status: 'active', startedAt: activeStarted },
      { id: 'waiting', studentId: 'two', queuedAt: '2026-08-30T11:56:00.000Z', status: 'waiting' },
    ] as QueueEntry[]);
    await db.sessions.add({ ...session('legacy', 'one'), studentIdSnapshot: '001001' } as never);
    await ensurePrivacyMigration();
    const data = await snapshot();
    const storedStudents = await db.students.toArray() as unknown as Record<string, unknown>[];
    const storedSessions = await db.sessions.toArray() as unknown as Record<string, unknown>[];
    expect(data.students.map((item) => [item.id, item.name])).toEqual([['one', 'Fictional One'], ['two', 'Fictional Two']]);
    expect(data.students[0]).toMatchObject({ maxUses: 2, banned: true, externalIdLast4: '1001' });
    expect(data.enrollments[0]).toMatchObject({ studentId: 'one', classId: 'class' });
    expect(data.bellSchedules[0].name).toBe('Custom schedule');
    expect(data.settings).toMatchObject({ pinHash: 'old-pin', pinSalt: 'old-salt', setupComplete: true, warningSeconds: 240, overLimitSeconds: 360, globalUseLimit: 4, teacherHotkey: 'Ctrl+Shift+9', schemaVersion: 4, privacyVersion: 4, privacyNoticeAcknowledged: false });
    expect(data.queue.map((item) => item.id)).toEqual(['active', 'waiting']);
    expect(data.queue[0].startedAt).toBe(activeStarted);
    expect(storedStudents.every((item) => !('studentId' in item))).toBe(true);
    expect(storedSessions.every((item) => !('studentIdSnapshot' in item))).toBe(true);
    const { localAppServices } = await import('../services');
    await expect(localAppServices.findStudentByExternalId('001001')).resolves.toMatchObject({ id: 'one' });
  });

  it('rolls back invalid legacy data and reruns or overlaps harmlessly', async () => {
    await db.students.clear();
    await db.students.add({ id: 'bad', name: 'Bad', studentId: 'ABC', createdAt: stamp, updatedAt: stamp } as never);
    await db.settings.put({ ...defaults, schemaVersion: 3, privacyVersion: 3, lookupSecret: '' } as never);
    await expect(ensurePrivacyMigration()).rejects.toThrow();
    expect(await db.students.get('bad') as unknown).toHaveProperty('studentId', 'ABC');
    await db.students.put({ id: 'bad', name: 'Fixed', studentId: '000009', createdAt: stamp, updatedAt: stamp } as never);
    await expect(Promise.all([ensurePrivacyMigration(), ensurePrivacyMigration()])).resolves.toBeTruthy();
    const first = await db.students.get('bad');
    const firstSettings = await getSettings();
    await ensurePrivacyMigration();
    expect(await db.students.get('bad')).toEqual(first);
    expect((await getSettings()).lookupSecret).toBe(firstSettings.lookupSecret);
  });
});

describe('encrypted and legacy backups', () => {
  it('round-trips v4 on a clean browser without plaintext disclosure and preserves the new browser PIN', async () => {
    const record = await student('a', 'Fictional Alpha', '001482');
    await db.students.add(record);
    await db.sessions.add(session('private-session'));
    const encrypted = await createEncryptedBackup('correct horse battery');
    const plain = JSON.stringify(encrypted);
    for (const sensitive of ['Fictional Alpha', '001482', record.externalIdHash, secret, 'pin-hash', 'private-session', 'startedAt']) expect(plain).not.toContain(sensitive);
    await db.delete();
    await db.open();
    const cleanSecret = generateLookupSecret();
    await atomicReplace({ students: [], queue: [], sessions: [], settings: { ...defaults, lookupSecret: cleanSecret, setupComplete: true, pinHash: 'current-pin', pinSalt: 'current-salt' } });
    await restoreAnyBackup(encrypted, await getSettings(), 'correct horse battery');
    expect((await db.students.get('a'))?.name).toBe('Fictional Alpha');
    expect(await getSettings()).toMatchObject({ pinHash: 'current-pin', pinSalt: 'current-salt', setupComplete: true });
    const { localAppServices } = await import('../services');
    await expect(localAppServices.findStudentByExternalId('001482')).resolves.toMatchObject({ id: 'a' });
  });

  it('wrong password or altered ciphertext leaves live data unchanged', async () => {
    const record = await student('a', 'Fictional Alpha', '001482');
    await db.students.add(record);
    const encrypted = await createEncryptedBackup('correct horse battery');
    const before = await snapshot();
    await expect(restoreAnyBackup(encrypted, before.settings, 'wrong password')).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await expect(restoreAnyBackup({ ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}aa` }, before.settings, 'correct horse battery')).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it.each([1, 2, 3] as const)('converts legacy v%s backups before storage', async (version) => {
    const current = await getSettings();
    const legacy: LegacyBackup = {
      format: 'classroom-bathroom-queue',
      backupVersion: version,
      schemaVersion: version,
      exportedAt: stamp,
      students: [{ id: 'legacy', name: 'Legacy Fictional', studentId: '000123', createdAt: stamp, updatedAt: stamp }],
      queue: [],
      sessions: [{ ...session('old', 'legacy'), studentIdSnapshot: '000123' }],
      settings: { id: 'settings', setupComplete: false },
    };
    await restoreAnyBackup(legacy, current);
    const raw = await db.students.get('legacy') as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('studentId');
    expect(raw.externalIdHash).toBe(await deriveExternalIdHash(secret, '000123'));
    expect(await db.sessions.get('old') as unknown).not.toHaveProperty('studentIdSnapshot');
    expect(await getSettings()).toMatchObject({ pinHash: 'pin-hash', pinSalt: 'pin-salt', setupComplete: true, schemaVersion: 4 });
  });

  it('rejects an invalid legacy backup before changing live data', async () => {
    const record = await student('a', 'Fictional Alpha', '001482');
    await db.students.add(record);
    const before = await snapshot();
    const invalid: LegacyBackup = { format: 'classroom-bathroom-queue', backupVersion: 3, schemaVersion: 3, exportedAt: stamp, students: [{ id: 'bad', name: 'Bad', studentId: '12A', createdAt: stamp, updatedAt: stamp }], queue: [], sessions: [], settings: { id: 'settings' } };
    await expect(restoreAnyBackup(invalid, before.settings)).rejects.toThrow(/invalid legacy/i);
    expect(await snapshot()).toEqual(before);
  });
});

describe('exports and input validation', () => {
  it('exports a name-only roster and recent history without IDs or hashes', async () => {
    const record = await student('a', 'Fictional Alpha', '001482');
    expect(rosterCsv([record])).toBe('name\r\n"Fictional Alpha"');
    expect(rosterCsv([record])).not.toContain('1482');
    expect(historyCsv([session('s')])).not.toMatch(/studentId/i);
    expect(historyCsv([session('s')])).toContain('Fictional Alpha');
  });

  it('validates standard imports without converting IDs to numbers', () => {
    expect(parseRosterCsv('name,studentId\nFictional,001234')[0]).toMatchObject({ studentId: '001234', error: '' });
    expect(validateStudent('Fictional', '12A')).toMatch(/digits/);
  });
});

describe('custom keyboard shortcuts', () => {
  it('matches the physical shifted digit', () => {
    const event = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: '(', code: 'Digit9' };
    expect(hotkeyMatches(event, 'Ctrl+Shift+9')).toBe(true);
  });

  it('validates, resolves restore conflicts, and persists the shared teacher shortcut setting', async () => {
    expect(HOTKEY_OPTIONS).toContain('Ctrl+Shift+9');
    expect(validateHotkeyPair('Ctrl+Shift+9', 'Ctrl+Shift+9')).toMatch(/different/);
    expect(validateHotkeyPair('Ctrl+Shift+9', 'Ctrl+Shift+6')).toBe('');
    expect(resolveTeacherHotkeyAfterRestore('Ctrl+Shift+9', 'Ctrl+Shift+5', 'Ctrl+Shift+6')).toBe('Ctrl+Shift+9');
    expect(resolveTeacherHotkeyAfterRestore('Ctrl+Shift+9', 'Ctrl+Shift+5', 'Ctrl+Shift+9')).toBe('Ctrl+Shift+5');
    const { localAppServices } = await import('../services');
    await localAppServices.saveSettings({ ...(await getSettings()), teacherHotkey: 'Ctrl+Shift+9' });
    expect((await getSettings()).teacherHotkey).toBe('Ctrl+Shift+9');
  });
});

describe('Student ID keyboard input', () => {
  const key = (code: string, value: string, modifiers = {}) => studentIdKeyboardAction({ ctrlKey: false, altKey: false, metaKey: false, code, key: value, ...modifiers });

  it('maps top-row and numpad digits without converting their values to numbers', () => {
    expect(key('Digit0', '0')).toEqual({ type: 'digit', digit: '0' });
    expect(key('Numpad9', '9')).toEqual({ type: 'digit', digit: '9' });
  });

  it('maps editing controls and ignores modifier-based shortcuts', () => {
    expect(key('Backspace', 'Backspace')).toEqual({ type: 'backspace' });
    expect(key('Enter', 'Enter')).toEqual({ type: 'submit' });
    expect(key('Escape', 'Escape')).toEqual({ type: 'clear' });
    expect(key('Digit5', '%', { ctrlKey: true })).toEqual({ type: 'none' });
    expect(key('Digit6', '^', { altKey: true })).toEqual({ type: 'none' });
  });
});
