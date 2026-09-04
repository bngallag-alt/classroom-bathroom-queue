import { useState } from 'react';
import type { Settings, Weekday } from './types';
import { localAppServices } from './services';
import { normalizeWeeklyTimePolicy, validateWeeklyTimePolicy, weekdayOptions } from './weeklyTime';

export default function WeeklyTimeSettings({
  settings,
  changed,
  notice,
}: {
  settings: Settings;
  changed: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [policy, setPolicy] = useState(() => normalizeWeeklyTimePolicy(settings.weeklyTimePolicy));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const nextPolicy = { ...policy, enabled: true };
    const validation = validateWeeklyTimePolicy(nextPolicy);
    if (validation) return setError(validation);
    setSaving(true);
    try {
      await localAppServices.saveWeeklyTimePolicy(nextPolicy);
      await changed();
      setError('');
      notice('Weekly bathroom-time settings saved.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="card weekly-time-settings">
    <h2>Weekly Bathroom Time</h2>
    <p>Set how much counted, completed bathroom time each student receives per school week. Time is calculated locally from retained session history.</p>
    <div className="grid2">
      <label>Weekly allowance (minutes)<input type="number" min="1" step="1" value={policy.allowanceMinutes} onChange={(event) => { setPolicy({ ...policy, allowanceMinutes: Number(event.target.value) }); setError(''); }} /></label>
      <label>Weekly reset day<select value={policy.resetDay} onChange={(event) => { setPolicy({ ...policy, resetDay: Number(event.target.value) as Weekday }); setError(''); }}>{weekdayOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      <label>Warn student when remaining time is at or below (minutes)<input type="number" min="0" step="1" value={policy.warningRemainingMinutes} onChange={(event) => { setPolicy({ ...policy, warningRemainingMinutes: Number(event.target.value) }); setError(''); }} /></label>
    </div>
    <p><small>Set the warning to 0 to turn off low-time warnings.</small></p>
    <details className="advanced-disclosure weekly-time-advanced">
      <summary>Advanced</summary>
      <div className="advanced-content">
        <p>Optionally deduct last week’s overtime from this week’s allowance. Only overtime beyond the grace period is deducted.</p>
        <label className="check-label"><input type="checkbox" checked={policy.deductOvertimeNextWeek} onChange={(event) => { setPolicy({ ...policy, deductOvertimeNextWeek: event.target.checked }); setError(''); }} /> Additional overtime minutes taken from student allowance next week</label>
        {policy.deductOvertimeNextWeek && <label>Grace period (minutes)<input type="number" min="0" step="1" value={policy.overtimeGraceMinutes} onChange={(event) => { setPolicy({ ...policy, overtimeGraceMinutes: Number(event.target.value) }); setError(''); }} /><small>Overtime within this grace period will not be deducted from the following week.</small></label>}
      </div>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save weekly bathroom-time settings'}</button>
    <p><small>Weekly Bathroom Time is the active usage limit. Individual overrides are managed on the Roster page.</small></p>
  </section>;
}
