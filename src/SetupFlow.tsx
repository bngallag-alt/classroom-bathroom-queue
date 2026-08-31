import { useRef, useState } from 'react';
import { defaults, getSettings } from './db';
import type { Backup, Settings, Student } from './types';
import {
  HOTKEY_OPTIONS,
  makePin,
  now,
  parseRosterCsv,
  resolveTeacherHotkeyAfterRestore,
  restoreAnyBackup,
  uid,
  validateBackup,
  validateHotkeyPair,
  validateStudent,
} from './lib';
import { localAppServices } from './services';
import AeriesImportPanel from './AeriesImportPanel';

export default function SetupFlow({
  students,
  onChanged,
  onDone,
}: {
  students: Student[];
  onChanged: () => Promise<void>;
  onDone: () => Promise<void>;
}) {
  const [step, setStep] = useState<'pin' | 'shortcut' | 'roster'>('pin');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinSettings, setPinSettings] = useState<Settings>();
  const [teacherHotkey, setTeacherHotkey] = useState(defaults.teacherHotkey);
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [backup, setBackup] = useState<Backup>();
  const [backupPassword, setBackupPassword] = useState('');
  const [restoredLegacy, setRestoredLegacy] = useState(false);
  const standard = useRef<HTMLInputElement>(null);
  const restore = useRef<HTMLInputElement>(null);

  async function continueFromPin() {
    if (pin.length < 4) return setError('Choose a PIN with at least four digits.');
    if (!/^\d+$/.test(pin)) return setError('PIN must contain digits only.');
    if (pin !== confirmPin) return setError('PINs do not match.');
    const current = await getSettings();
    const settings = { ...defaults, ...current, ...(await makePin(pin)), setupComplete: false };
    await localAppServices.saveSettings(settings);
    setPinSettings(settings);
    setTeacherHotkey(settings.teacherHotkey);
    setError('');
    setStep('shortcut');
  }

  async function saveShortcut() {
    if (!pinSettings) return;
    const validation = validateHotkeyPair(teacherHotkey, pinSettings.clearQueueHotkey);
    if (validation) return setError(validation);
    const settings = { ...pinSettings, teacherHotkey };
    await localAppServices.saveSettings(settings);
    setPinSettings(settings);
    setError('');
    setStep('roster');
  }

  async function finish() {
    if (!pinSettings) return;
    await localAppServices.saveSettings({ ...pinSettings, setupComplete: true });
    await onDone();
  }

  async function addStudent() {
    const validation = validateStudent(name, studentId);
    if (validation) return setError(validation);
    const stamp = now();
    try {
      await localAppServices.addStudent({ id: uid(), name: name.trim(), studentId: studentId.trim(), createdAt: stamp, updatedAt: stamp, maxUses: null, banned: false });
      setName('');
      setStudentId('');
      setError('');
      await onChanged();
      setNotice('Student added.');
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function importStandard(file?: File) {
    if (!file) return;
    const rows = parseRosterCsv(await file.text(), students);
    if (rows.some((row) => row.error)) return setError('The standard roster has errors. Correct the file and try again.');
    await localAppServices.importStandard(rows, false);
    if (standard.current) standard.current.value = '';
    await onChanged();
    setError('');
    setNotice('Standard roster imported and student numbers were protected before storage.');
  }

  async function chooseBackup(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!validateBackup(parsed)) throw new Error('Invalid or unsupported backup file.');
      setBackup(parsed);
      setBackupPassword('');
      setError('');
    } catch (reason) {
      setBackup(undefined);
      setError((reason as Error).message);
    }
  }

  async function applyBackup() {
    if (!backup || !pinSettings) return;
    try {
      const result = await restoreAnyBackup(backup, pinSettings, backup.format === 'classroom-bathroom-queue-encrypted' ? backupPassword : undefined);
      const restoredSettings = await getSettings();
      const preservedHotkey = resolveTeacherHotkeyAfterRestore(teacherHotkey, restoredSettings.teacherHotkey, restoredSettings.clearQueueHotkey);
      await localAppServices.saveSettings({ ...restoredSettings, teacherHotkey: preservedHotkey, setupComplete: true });
      setBackup(undefined);
      setBackupPassword('');
      if (restore.current) restore.current.value = '';
      if (result.legacy) {
        setRestoredLegacy(true);
        setNotice('Legacy backup converted and restored. Securely delete the old backup because it contains readable student IDs.');
        await onChanged();
      } else await onDone();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  if (step === 'pin') {
    return <main className="setup center">
      <h1>Create teacher PIN</h1>
      <p>This PIN is a local classroom deterrent for teacher-only screens. It is not an online account.</p>
      <label>Teacher PIN<input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} /></label>
      <label>Confirm PIN<input type="password" inputMode="numeric" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary hero" onClick={() => void continueFromPin()}>Continue</button>
    </main>;
  }

  if (step === 'shortcut') {
    return <main className="setup center shortcut-setup">
      <p className="eyebrow">Teacher access setup</p>
      <h1>Choose your teacher dashboard shortcut</h1>
      <p>This shortcut opens the teacher PIN screen from student/kiosk mode. You must then enter your teacher PIN.</p>
      <p>You can change it later under <b>Teacher Dashboard → Settings</b>.</p>
      <label>Open teacher dashboard
        <select value={teacherHotkey} onChange={(event) => { setTeacherHotkey(event.target.value); setError(''); }}>
          {HOTKEY_OPTIONS.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <div className="selected-shortcut" aria-live="polite">
        <span>Your selected shortcut</span>
        <strong>{teacherHotkey}</strong>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary hero" onClick={() => void saveShortcut()}>Save Shortcut and Continue</button>
    </main>;
  }

  return <main className="setup setup-simple">
    <p className="eyebrow">Optional roster setup</p>
    <h1>Set up your roster</h1>
    <p>You can import students now, restore a previous backup, add students manually, or do this later. Student numbers are protected before storage.</p>
    <p aria-live="polite"><b>{students.length} student{students.length === 1 ? '' : 's'} currently added</b></p>
    {notice && <p className="privacy" role="status">{notice}</p>}
    <div className="setup-options">
      <AeriesImportPanel students={students} onChanged={onChanged} onNotice={setNotice} />
      <section className="card">
        <h2>Restore an installation</h2>
        <button className="primary hero" onClick={() => restore.current?.click()}>Restore Full Backup</button>
        <input hidden ref={restore} type="file" accept="application/json,.json" onChange={(event) => void chooseBackup(event.target.files?.[0])} />
        {backup && <div className="privacy">
          <b>Valid {backup.backupVersion === 4 ? 'encrypted' : 'legacy'} backup ready</b>
          {backup.format === 'classroom-bathroom-queue-encrypted'
            ? <label>Backup password<input type="password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} /></label>
            : <p>This old backup may contain readable student IDs. It will be converted before anything is stored.</p>}
          <button className="primary" onClick={() => void applyBackup()}>Confirm Restore Full Backup</button>
        </div>}
      </section>
      <section className="card">
        <h2>Other roster options</h2>
        <button onClick={() => standard.current?.click()}>Import Standard Roster</button>
        <input hidden ref={standard} type="file" accept=".csv,text/csv" onChange={(event) => void importStandard(event.target.files?.[0])} />
        <button onClick={() => setManual((value) => !value)}>Add Student Manually</button>
        {manual && <div>
          <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Student ID<input value={studentId} inputMode="numeric" onChange={(event) => setStudentId(event.target.value)} /></label>
          <button onClick={() => void addStudent()}>Add Student</button>
        </div>}
      </section>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {restoredLegacy
      ? <button className="primary hero continue-empty" onClick={() => void onDone()}>Continue to Restored App</button>
      : <button className="primary hero continue-empty" onClick={() => void finish()}>{students.length ? 'Continue to App' : 'Continue Without Students'}</button>}
  </main>;
}
