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
  const [acknowledged, setAcknowledged] = useState(settings.probationPolicy.automaticSuspensionAcknowledged);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const effectiveAcknowledgement = acknowledged || settings.probationPolicy.automaticSuspensionAcknowledged;

  async function save() {
    const validation = validateWeeklyTimePolicy(policy, effectiveAcknowledgement);
    if (validation) return setError(validation);
    setSaving(true);
    try {
      await localAppServices.saveWeeklyTimePolicy(policy, effectiveAcknowledgement);
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
    <label className="check-label"><input type="checkbox" checked={policy.enabled} onChange={(event) => { setPolicy({ ...policy, enabled: event.target.checked, automaticSuspensionEnabled: event.target.checked ? policy.automaticSuspensionEnabled : false }); setError(''); }} /> Enable weekly bathroom-time allowance</label>
    <div className="grid2">
      <label>Weekly allowance (minutes)<input type="number" min="1" step="1" value={policy.allowanceMinutes} onChange={(event) => { setPolicy({ ...policy, allowanceMinutes: Number(event.target.value) }); setError(''); }} /></label>
      <label>Weekly reset day<select value={policy.resetDay} onChange={(event) => { setPolicy({ ...policy, resetDay: Number(event.target.value) as Weekday }); setError(''); }}>{weekdayOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    </div>
    <details className="advanced-disclosure weekly-time-advanced">
      <summary>Advanced</summary>
      <div className="advanced-content">
        <p>Optional automatic suspension rules apply after a student exceeds the weekly allowance by the configured amount.</p>
        <label className="check-label"><input type="checkbox" checked={policy.automaticSuspensionEnabled} onChange={(event) => { setPolicy({ ...policy, automaticSuspensionEnabled: event.target.checked }); setError(''); }} /> Automatically suspend passes after the allowed weekly overage</label>
        <div className="grid2">
          <label>Allowed overage before suspension (minutes)<input type="number" min="0" step="1" value={policy.overageGraceMinutes} onChange={(event) => { setPolicy({ ...policy, overageGraceMinutes: Number(event.target.value) }); setError(''); }} /></label>
          <label>Weekly suspension duration (days)<input type="number" min="1" max="30" step="1" value={policy.suspensionDays} onChange={(event) => { setPolicy({ ...policy, suspensionDays: Number(event.target.value) }); setError(''); }} /></label>
        </div>
        {policy.automaticSuspensionEnabled && !settings.probationPolicy.automaticSuspensionAcknowledged && <div className="privacy">
          <p><b>Teacher acknowledgement required</b></p>
          <p>Automatic suspensions control this app’s pass only. Immediate overrides must remain available for emergencies and accommodations.</p>
          <label className="check-label"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); setError(''); }} /> I understand and will provide emergency and accommodation overrides.</label>
        </div>}
      </div>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save weekly bathroom-time settings'}</button>
    <p><small>The weekly allowance is disabled by default. Individual overrides are managed on the Roster page.</small></p>
  </section>;
}
