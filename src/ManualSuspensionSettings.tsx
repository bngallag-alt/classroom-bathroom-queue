import { useMemo, useState } from 'react';
import type { Settings, Student } from './types';
import { verifyPin } from './lib';
import { localAppServices } from './services';

export default function ManualSuspensionSettings({
  students,
  settings,
  changed,
  notice,
}: {
  students: Student[];
  settings: Settings;
  changed: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const sorted = useMemo(() => [...students].sort((a, b) => a.name.localeCompare(b.name)), [students]);
  const [studentId, setStudentId] = useState('');
  const [days, setDays] = useState('7');
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const selected = students.find((student) => student.id === studentId);

  function begin() {
    const duration = Number(days);
    if (!selected) return setError('Select a student.');
    if (!Number.isInteger(duration) || duration < 1 || duration > 30) return setError('Suspension duration must be a whole number from 1 through 30 days.');
    setPin('');
    setError('');
    setConfirming(true);
  }

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!await verifyPin(pin, settings)) return setError('Incorrect PIN.');
    setWorking(true);
    try {
      await localAppServices.applyManualSuspension(selected.id, Number(days));
      await changed();
      setConfirming(false);
      setStudentId('');
      notice(`${selected.name}: temporary suspension applied.`);
    } finally {
      setWorking(false);
    }
  }

  return <>
    <section className="card manual-suspension-settings">
      <h2>Temporary Suspensions</h2>
      <p>Apply a temporary app pass suspension to any rostered student. Applying one also removes an existing permanent ban so only the temporary suspension remains.</p>
      <div className="grid2">
        <label>Select student<select value={studentId} onChange={(event) => { setStudentId(event.target.value); setError(''); }}><option value="">Choose a student</option>{sorted.map((student) => <option value={student.id} key={student.id}>{student.name} — ID ending in {student.externalIdLast4}</option>)}</select></label>
        <label>Suspension duration (days)<input type="number" min="1" max="30" step="1" value={days} onChange={(event) => { setDays(event.target.value); setError(''); }} /></label>
      </div>
      {error && !confirming && <p className="error" role="alert">{error}</p>}
      <button className="danger" disabled={!students.length} onClick={begin}>Apply Temporary Suspension</button>
    </section>
    {confirming && selected && <div className="modalback"><form className="modal" role="dialog" aria-modal="true" onSubmit={apply}>
      <h2>Confirm temporary suspension</h2>
      <p><b>{selected.name}</b> will receive a {days}-day app pass suspension. Any permanent ban on this student will be removed.</p>
      <p>The stored reason will be “Teacher-applied temporary suspension.” Emergency and accommodation access must remain available outside this app restriction.</p>
      <label>Confirm teacher PIN<input autoFocus type="password" inputMode="numeric" value={pin} onChange={(event) => { setPin(event.target.value); setError(''); }} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={() => { setConfirming(false); setError(''); }}>Cancel</button><button className="danger" disabled={working}>{working ? 'Saving…' : 'Confirm temporary suspension'}</button></div>
    </form></div>}
  </>;
}
