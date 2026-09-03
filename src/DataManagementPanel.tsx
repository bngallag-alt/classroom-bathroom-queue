import { useRef, useState } from 'react';
import type { Backup, Session, Settings, Student } from './types';
import { localAppServices } from './services';
import {
  createEncryptedBackup,
  download,
  makePin,
  purgedHistoryCsv,
  purgedRosterCsv,
  restoreAnyBackup,
  validateBackup,
  verifyPin,
} from './lib';

export default function DataManagementPanel({
  data,
  onChanged,
  onNotice,
}: {
  data: { students: Student[]; sessions: Session[]; settings: Settings };
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [display, setDisplay] = useState(data.settings.idDisplay);
  const [newPin, setNewPin] = useState('');
  const [action, setAction] = useState<'history' | 'reset' | null>(null);
  const [actionPin, setActionPin] = useState('');
  const [actionError, setActionError] = useState('');
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<Backup>();
  const [restorePin, setRestorePin] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupConfirm, setBackupConfirm] = useState('');
  const [backupError, setBackupError] = useState('');
  const restore = useRef<HTMLInputElement>(null);

  async function save() {
    let extra = {};
    if (newPin) {
      if (!/^\d{4,}$/.test(newPin)) return onNotice('PIN must be at least four digits.');
      extra = await makePin(newPin);
    }
    await localAppServices.saveSettings({ ...data.settings, idDisplay: display, ...extra });
    setNewPin('');
    await onChanged();
    onNotice('General settings saved.');
  }

  async function backup() {
    if (backupPassword.length < 10) return setBackupError('Use a backup password with at least 10 characters.');
    if (backupPassword !== backupConfirm) return setBackupError('Backup passwords do not match.');
    setWorking(true);
    try {
      const encrypted = await createEncryptedBackup(backupPassword);
      download(`classroom-bathroom-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(encrypted, null, 2), 'application/json');
      setBackupOpen(false);
      setBackupPassword('');
      setBackupConfirm('');
      setBackupError('');
      onNotice('Encrypted full backup exported. Store it securely with its password.');
    } catch (reason) {
      setBackupError((reason as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function chooseRestore(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!validateBackup(parsed)) throw new Error('Invalid or unsupported backup file.');
      setRestoreCandidate(parsed);
      setRestorePin('');
      setRestorePassword('');
      setRestoreError('');
    } catch (reason) {
      onNotice((reason as Error).message);
    }
  }

  async function applyRestore(event: React.FormEvent) {
    event.preventDefault();
    if (!restoreCandidate) return;
    setWorking(true);
    try {
      if (!await verifyPin(restorePin, data.settings)) return setRestoreError('Incorrect teacher PIN.');
      const result = await restoreAnyBackup(restoreCandidate, data.settings, restoreCandidate.format === 'classroom-bathroom-queue-encrypted' ? restorePassword : undefined);
      await onChanged();
      setRestoreCandidate(undefined);
      onNotice(result.legacy ? 'Legacy backup converted and restored. Securely delete the old source backup because it contains readable student IDs.' : 'Encrypted backup restored successfully.');
    } catch (reason) {
      setRestoreError((reason as Error).message);
    } finally {
      setWorking(false);
    }
  }

  function openAction(next: 'history' | 'reset') {
    setAction(next);
    setActionPin('');
    setActionError('');
    setResetConfirmed(false);
  }

  async function performAction(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    try {
      if (!await verifyPin(actionPin, data.settings)) return setActionError('Incorrect PIN.');
      if (action === 'history') {
        await localAppServices.clearHistory();
        await onChanged();
        setAction(null);
        onNotice('Bathroom history deleted.');
      } else if (action === 'reset') {
        if (!resetConfirmed) return setActionError('Confirm that you understand all local app data will be erased.');
        await localAppServices.resetAll();
        location.reload();
      }
    } catch (reason) {
      setActionError((reason as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return <>
    <section className="settings-grid">
      <div className="card">
        <h1>General Settings</h1>
        <p>Manage student-facing privacy and teacher access. Usage rules now have their own tab.</p>
        <label>Student-facing ID display<select value={display} onChange={(event) => setDisplay(event.target.value as Settings['idDisplay'])}><option value="masked">Masked ID</option><option value="full">Last four digits</option><option value="name">Name only</option></select></label>
        <label>New teacher PIN (leave blank to keep)<input type="password" inputMode="numeric" value={newPin} onChange={(event) => setNewPin(event.target.value)} /></label>
        <button className="primary" onClick={() => void save()}>Save General Settings</button>
        <p>The teacher PIN is a local classroom deterrent, not an online account or strong device security control.</p>
      </div>
      <div className="card data-management">
        <h1>Backup &amp; Recovery</h1>
        <button className="primary hero" onClick={() => setBackupOpen(true)}>Export Encrypted Full Backup</button>
        <p>Requires a separate backup password. The encrypted file contains identifiable student information and must be stored securely.</p>
        <button onClick={() => restore.current?.click()}>Restore Full Backup</button>
        <input hidden ref={restore} type="file" accept="application/json,.json" onChange={(event) => void chooseRestore(event.target.files?.[0])} />
        <hr />
        <h1>Data Reset</h1>
        <button className="danger" onClick={() => openAction('reset')}>Factory Reset</button>
        <p>Erases all local app data. Export an encrypted full backup first.</p>
        <details className="advanced-tools">
          <summary>Advanced Data Tools</summary>
          <p>Exports contain identifiable student names. Detailed history covers only the retained last 30 days. The roster export contains names only; student numbers cannot be reconstructed from protected lookup values.</p>
          <button onClick={async () => download('classroom-bathroom-roster-names.csv', await purgedRosterCsv(), 'text/csv;charset=utf-8')}>Export Name-Only Roster CSV</button>
          <button onClick={async () => download('classroom-bathroom-history.csv', await purgedHistoryCsv(), 'text/csv;charset=utf-8')}>Export Bathroom History CSV</button>
          <button className="danger" onClick={() => openAction('history')}>Delete Bathroom History</button>
        </details>
      </div>
    </section>
    {backupOpen && <div className="modalback"><form className="modal" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void backup(); }}>
      <h2>Export Encrypted Full Backup</h2>
      <p>Choose a password of at least 10 characters. It is separate from your teacher PIN and is required to restore this backup.</p>
      <label>Backup password<input autoFocus type="password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} /></label>
      <label>Confirm backup password<input type="password" value={backupConfirm} onChange={(event) => setBackupConfirm(event.target.value)} /></label>
      {backupError && <p className="error" role="alert">{backupError}</p>}
      <div className="actions"><button type="button" onClick={() => setBackupOpen(false)}>Cancel</button><button className="primary" disabled={working}>{working ? 'Encrypting…' : 'Encrypt and Download'}</button></div>
    </form></div>}
    {action && <div className="modalback"><form className="modal" role="dialog" aria-modal="true" onSubmit={performAction}>
      <h2>{action === 'reset' ? 'Factory Reset' : 'Delete Bathroom History'}</h2>
      <p>{action === 'reset' ? 'This permanently erases the roster, classes, queue, active timer, queue history, recent bathroom history, schedules, settings, protected lookup secret, and teacher PIN.' : 'This permanently erases retained bathroom history.'}</p>
      <p><b>Export an encrypted full backup first if you may need this information.</b></p>
      <label>Teacher PIN<input autoFocus type="password" inputMode="numeric" value={actionPin} onChange={(event) => setActionPin(event.target.value)} aria-label="Confirm teacher PIN" /></label>
      {action === 'reset' && <label className="check-label"><input type="checkbox" checked={resetConfirmed} onChange={(event) => setResetConfirmed(event.target.checked)} /> I understand that all local app data will be erased.</label>}
      {actionError && <p className="error" role="alert">{actionError}</p>}
      <div className="actions"><button type="button" onClick={() => setAction(null)}>Cancel</button><button className="danger" disabled={working || action === 'reset' && !resetConfirmed}>{working ? 'Working…' : action === 'reset' ? 'Factory Reset Permanently' : 'Delete History Permanently'}</button></div>
    </form></div>}
    {restoreCandidate && <div className="modalback"><form className="modal" role="dialog" aria-modal="true" onSubmit={applyRestore}>
      <h2>Restore Full Backup?</h2>
      <p>This validates and decrypts or converts the complete backup before replacing current local data. Your current teacher PIN remains in place.</p>
      {restoreCandidate.format === 'classroom-bathroom-queue-encrypted' ? <label>Backup password<input type="password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} /></label> : <p className="banner">This legacy backup may contain readable student IDs. After successful conversion, securely delete the old source file.</p>}
      <label>Current teacher PIN<input autoFocus type="password" inputMode="numeric" value={restorePin} onChange={(event) => setRestorePin(event.target.value)} aria-label="Restore teacher PIN" /></label>
      {restoreError && <p className="error" role="alert">{restoreError}</p>}
      <div className="actions"><button type="button" onClick={() => setRestoreCandidate(undefined)}>Cancel</button><button className="primary" disabled={working}>{working ? 'Restoring…' : 'Restore and Replace Current Data'}</button></div>
    </form></div>}
  </>;
}
