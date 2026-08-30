import { beforeEach, describe, expect, it } from 'vitest';
import { atomicReplace, db, defaults, getSettings } from '../db';
import { localAppServices } from '../services';
import { parseAeriesRoster } from '../aeries';
import { oneClass, secondClass } from './aeries.test';
import {
  addToQueue,
  createEncryptedBackup,
  finishActive,
  restoreAnyBackup,
  startTimer,
  studentStats,
} from '../lib';
import { generateLookupSecret } from '../privacy';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await atomicReplace({
    students: [],
    classes: [],
    enrollments: [],
    queue: [],
    sessions: [],
    settings: {
      ...defaults,
      setupComplete: true,
      lookupSecret: generateLookupSecret(),
    },
  });
});

describe('future-compatible local architecture', () => {
  it('uses UUID primary keys and keyed, unique external student ID hashes', async () => {
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    await localAppServices.addStudent({
      id,
      name: 'Fictional Student',
      studentId: '001234',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const stored = await db.students.get(id);
    expect(stored?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored?.id).not.toBe('001234');
    expect(stored?.externalIdLast4).toBe('1234');
    expect(stored).not.toHaveProperty('studentId');
    await expect(
      localAppServices.addStudent({
        id: crypto.randomUUID(),
        name: 'Duplicate Fictional Student',
        studentId: '001234',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).rejects.toThrow(/unique/i);
  });

  it('creates one protected student and two enrollments for two Aeries classes', async () => {
    const parsed = parseAeriesRoster(`${oneClass}\n${secondClass}`);
    await localAppServices.importAeries(parsed, new Set(['170000']), new Set(), 'first-last');
    expect(await db.students.count()).toBe(1);
    expect(await db.classes.count()).toBe(2);
    const stored = (await db.students.toArray())[0];
    expect(stored).not.toHaveProperty('studentId');
    expect(stored.externalIdHash).toMatch(/^[0-9a-f]{64}$/);
    const enrollments = await db.enrollments.toArray();
    expect(enrollments).toHaveLength(2);
    expect(new Set(enrollments.map((item) => item.studentId)).size).toBe(1);
  });

  it('associates completed sessions with the selected class and calculates statistics', async () => {
    const parsed = parseAeriesRoster(oneClass);
    await localAppServices.importAeries(parsed, new Set(['170000']), new Set(), 'first-last');
    const student = (await db.students.toArray())[0];
    const classId = (await db.classes.toArray())[0].id;
    await localAppServices.saveSettings({ ...(await getSettings()), currentClassId: classId });
    await addToQueue(student.id);
    const queueEntry = (await db.queue.toArray())[0];
    await startTimer(queueEntry.id);
    const session = await finishActive();
    expect(session.classId).toBe(classId);
    expect(studentStats([student], [session], defaults)[0].total).toBe(1);
  });

  it('encrypts and restores classes and enrollment associations', async () => {
    const parsed = parseAeriesRoster(`${oneClass}\n${secondClass}`);
    await localAppServices.importAeries(parsed, new Set(['170000']), new Set(), 'first-last');
    const backup = await createEncryptedBackup('correct horse battery');
    expect(backup).toMatchObject({ backupVersion: 4, schemaVersion: 4 });
    expect(JSON.stringify(backup)).not.toContain('170000');
    await atomicReplace({
      students: [],
      classes: [],
      enrollments: [],
      queue: [],
      sessions: [],
      settings: { ...(await getSettings()) },
    });
    await restoreAnyBackup(backup, await getSettings(), 'correct horse battery');
    expect(await db.classes.count()).toBe(2);
    expect(await db.enrollments.count()).toBe(2);
  });
});
