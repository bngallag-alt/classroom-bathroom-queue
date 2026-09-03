import { useMemo, useState } from 'react';
import type { Session, Settings, Student } from './types';
import { activePassSuspension, assessProbation } from './probation';
import { assessWeeklyTime, formatWeeklyDuration } from './weeklyTime';
import { verifyPin } from './lib';
import { localAppServices } from './services';

type Action = { kind: 'exempt' | 'unexempt' | 'end' | 'suspend' | 'adjust' | 'rearm'; student: Student };

export default function ProbationPanel({
  students,
  sessions,
  settings,
  changed,
  notice,
  openRoster,
}: {
  students: Student[];
  sessions: Session[];
  settings: Settings;
  changed: () => Promise<void>;
  notice: (message: string) => void;
  openRoster: () => void;
}) {
  const [action, setAction] = useState<Action>();
  const [pin, setPin] = useState('');
  const [days, setDays] = useState(String(settings.probationPolicy.suspensionDays));
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const rows = useMemo(() => students.map((student) => {
    const at = new Date();
    const assessment = assessProbation(student, sessions, settings, at);
    const suspension = activePassSuspension(student, settings, at);
    const weekly = assessWeeklyTime(student, sessions, settings, at);
    const reached = assessment.statuses.filter((status) => status.warningReached).map((status) => status.metric);
    return { student, assessment, suspension, weekly, reached };
  }).filter((row) => row.reached.length || row.weekly.blocked || row.suspension || row.student.banned || row.student.probationExempt).sort((a, b) => a.student.name.localeCompare(b.student.name)), [students, sessions, settings]);

  function open(next: Action) {
    setAction(next);
    setPin('');
    setDays(String(settings.probationPolicy.suspensionDays));
    setError('');
  }

  async function perform(event: React.FormEvent) {
    event.preventDefault();
    if (!action) return;
    if (!await verifyPin(pin, settings)) return setError('Incorrect PIN.');
    const duration = Number(days);
    if ((action.kind === 'suspend' || action.kind === 'adjust') && (!Number.isInteger(duration) || duration < 1 || duration > 30)) return setError('Suspension duration must be a whole number from 1 through 30 days.');
    setWorking(true);
    try {
      if (action.kind === 'exempt') await localAppServices.setProbationExempt(action.student.id, true);
      else if (action.kind === 'unexempt') await localAppServices.setProbationExempt(action.student.id, false);
      else if (action.kind === 'end') await localAppServices.endPassSuspension(action.student.id);
      else if (action.kind === 'suspend') await localAppServices.applyManualSuspension(action.student.id, duration);
      else if (action.kind === 'adjust') await localAppServices.adjustPassSuspension(action.student.id, duration);
      else await localAppServices.rearmProbation(action.student.id);
      await changed();
      notice(`${action.student.name}: ${actionLabel(action.kind)} completed.`);
      setAction(undefined);
    } finally {
      setWorking(false);
    }
  }

  return <>
    <section className="card probation-list">
      <div className="titleline"><div><h2>Pass Suspension List</h2><p>Rolling 30-day metrics, weekly bathroom-time status, temporary suspensions, exemptions, and permanent bans.</p></div><button onClick={openRoster}>Open roster controls</button></div>
      {!rows.length ? <p>No students currently meet a warning threshold, have used their weekly allowance, have a suspension or permanent ban, or have an exemption.</p> : <div className="probation-rows">
        {rows.map(({ student, assessment, suspension, weekly, reached }) => <article className="probation-row" key={student.id}>
          <div><h2>{student.name}</h2><small>ID ending in {student.externalIdLast4}</small></div>
          <dl className="overtime-metrics"><div><dt>Raw overtime count</dt><dd>{assessment.metrics.overtimeCount}</dd></div></dl>
          <dl className="weekly-metrics"><div><dt>Weekly allowance</dt><dd>{weekly.mode === 'disabled' ? 'Disabled' : weekly.mode === 'unlimited' ? 'Unlimited' : formatWeeklyDuration(weekly.allowanceSeconds!)}</dd></div><div><dt>Weekly used</dt><dd>{formatWeeklyDuration(weekly.usedSeconds)}</dd></div><div><dt>Weekly remaining</dt><dd>{weekly.remainingSeconds === undefined ? 'Unlimited' : formatWeeklyDuration(weekly.remainingSeconds)}</dd></div><div><dt>Weekly overage</dt><dd>{formatWeeklyDuration(weekly.overageSeconds)}</dd></div></dl>
          {weekly.mode !== 'disabled' && <small>Weekly setting: {weekly.mode === 'inherited' ? 'Standard allowance' : weekly.mode === 'override' ? 'Individual override' : 'Individual unlimited time'} · Resets {weekly.weekEnd.toLocaleString()}</small>}
          <div className="status-list">
            {student.banned && <span className="status danger-status">Permanent ban</span>}
            {student.probationExempt && <span className="status exempt-status">Exempt</span>}
            {weekly.blocked && <span className="status warning-status">Weekly allowance used</span>}
            {suspension && <span className="status suspension-status">{suspension.kind === 'manual' ? 'Temporary suspension' : suspension.source === 'weekly-time' ? 'Weekly-time automatic suspension' : 'Rolling 30-day automatic suspension'} until {new Date(suspension.endsAt).toLocaleString()}</span>}
            {!suspension && reached.map((metric) => <span className="status warning-status" key={metric}>Warning: {metric === 'overtimeCount' ? 'Raw overtime count' : 'Automatic suspension threshold'}</span>)}
            {suspension?.reasons.map((reason) => <small key={reason}>{reason}</small>)}
          </div>
          <div className="actions">
            <button onClick={() => open({ kind: student.probationExempt ? 'unexempt' : 'exempt', student })}>{student.probationExempt ? 'Remove exemption' : 'Exempt student'}</button>
            {suspension ? <><button onClick={() => open({ kind: 'adjust', student })}>Adjust suspension</button><button className="danger" onClick={() => open({ kind: 'end', student })}>End suspension</button></> : <button className="danger" onClick={() => open({ kind: 'suspend', student })}>Apply Temporary Suspension</button>}
            <button onClick={() => open({ kind: 'rearm', student })}>Reset automatic trigger</button>
          </div>
        </article>)}
      </div>}
    </section>
    {action && <div className="modalback"><form className="modal" role="dialog" aria-modal="true" onSubmit={perform}>
      <h2>{actionTitle(action.kind)}</h2>
      <p><b>{action.student.name}</b></p>
      {action.kind === 'exempt' && <p>This student will be excluded from overtime-count warnings and automatic suspensions. Any active rolling automatic suspension will end.</p>}
      {action.kind === 'unexempt' && <p>This student will again be eligible for configured overtime-count warnings and future automatic threshold crossings.</p>}
      {action.kind === 'end' && <p>This immediately ends the current temporary pass suspension.</p>}
      {action.kind === 'rearm' && <p>This clears the saved automatic trigger. If current data meets the policy, it may trigger again during the next evaluation.</p>}
      {action.kind === 'suspend' && action.student.banned && <p>Applying this temporary suspension will remove the student’s permanent ban.</p>}
      {(action.kind === 'suspend' || action.kind === 'adjust') && <label>Suspension days from now<input type="number" min="1" max="30" step="1" value={days} onChange={(event) => setDays(event.target.value)} /></label>}
      <p>Emergency and accommodation access must remain available outside this app restriction.</p>
      <label>Confirm teacher PIN<input autoFocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={() => setAction(undefined)}>Cancel</button><button className={action.kind === 'end' || action.kind === 'suspend' ? 'danger' : 'primary'} disabled={working}>{working ? 'Saving…' : 'Confirm change'}</button></div>
    </form></div>}
  </>;
}

function actionTitle(kind: Action['kind']) {
  return kind === 'exempt' ? 'Exempt student from automatic suspension rules'
    : kind === 'unexempt' ? 'Remove automatic-suspension exemption'
      : kind === 'end' ? 'End temporary suspension'
        : kind === 'suspend' ? 'Apply temporary suspension'
          : kind === 'adjust' ? 'Adjust temporary suspension'
            : 'Reset automatic suspension trigger';
}

function actionLabel(kind: Action['kind']) {
  return kind === 'exempt' ? 'automatic-suspension exemption'
    : kind === 'unexempt' ? 'exemption removal'
      : kind === 'end' ? 'suspension end'
        : kind === 'suspend' ? 'temporary suspension'
          : kind === 'adjust' ? 'suspension adjustment'
            : 'automatic trigger reset';
}
