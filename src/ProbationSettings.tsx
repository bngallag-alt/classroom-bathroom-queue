import { useState } from 'react';
import type { ProbationPolicy, Settings } from './types';
import { localAppServices } from './services';
import { normalizeProbationPolicy, validateProbationPolicy } from './probation';

export default function ProbationSettings({
  settings,
  changed,
  notice,
}: {
  settings: Settings;
  changed: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [policy, setPolicy] = useState(() => normalizeProbationPolicy(settings.probationPolicy));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const effectiveAcknowledgement = policy.automaticSuspensionAcknowledged || settings.probationPolicy.automaticSuspensionAcknowledged;
  const overtimeRule = policy.rules.overtimeCount;

  function updatePolicy(changes: Partial<ProbationPolicy>) {
    setPolicy((current) => ({ ...current, ...changes }));
    setError('');
  }

  function updateOvertimeRule(changes: Partial<ProbationPolicy['rules']['overtimeCount']>) {
    setPolicy((current) => ({
      ...current,
      rules: { ...current.rules, overtimeCount: { ...current.rules.overtimeCount, ...changes } },
    }));
    setError('');
  }

  async function save() {
    const nextPolicy = normalizeProbationPolicy({
      ...policy,
      automaticSuspensionAcknowledged: effectiveAcknowledgement,
      rules: {
        ...policy.rules,
        overtimeCount: {
          ...policy.rules.overtimeCount,
          enabled: policy.warningsEnabled || policy.automaticSuspensionsEnabled || policy.rules.overtimeCount.enabled,
        },
      },
    });
    const validation = validateProbationPolicy(nextPolicy);
    if (validation) return setError(validation);
    setSaving(true);
    try {
      await localAppServices.saveProbationPolicy(nextPolicy);
      await changed();
      setPolicy(nextPolicy);
      setError('');
      notice('Automatic pass suspension settings saved.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="card probation-settings">
    <h2>Automatic Pass Suspensions</h2>
    <p>Warnings and automatic suspensions use only the number of over-limit bathroom returns from the rolling last 30 days.</p>
    <label className="check-label"><input type="checkbox" checked={policy.warningsEnabled} onChange={(event) => { updatePolicy({ warningsEnabled: event.target.checked }); if (event.target.checked) updateOvertimeRule({ enabled: true }); }} /> Enable overtime-count warnings</label>
    <label className="check-label"><input type="checkbox" checked={policy.automaticSuspensionsEnabled} onChange={(event) => { updatePolicy({ automaticSuspensionsEnabled: event.target.checked }); if (event.target.checked) updateOvertimeRule({ enabled: true }); }} /> Enable automatic pass suspensions</label>
    {policy.automaticSuspensionsEnabled && !effectiveAcknowledgement && <div className="privacy">
      <p><b>Teacher acknowledgement required</b></p>
      <p>Automatic suspensions control this app’s pass only. I will provide immediate overrides for emergencies and accommodations.</p>
      <label className="check-label"><input type="checkbox" checked={policy.automaticSuspensionAcknowledged} onChange={(event) => updatePolicy({ automaticSuspensionAcknowledged: event.target.checked })} /> I understand and will provide emergency and accommodation overrides.</label>
    </div>}
    <div className="grid2">
      <label>Overtime-count warning threshold<input type="number" min="0" step="1" value={overtimeRule.warningThreshold} onChange={(event) => updateOvertimeRule({ warningThreshold: Number(event.target.value) })} /></label>
      <label>Overtime-count suspension threshold<input type="number" min="0" step="1" value={overtimeRule.suspensionThreshold} onChange={(event) => updateOvertimeRule({ suspensionThreshold: Number(event.target.value) })} /></label>
      <label>Automatic suspension duration (days)<input type="number" min="1" max="30" step="1" value={policy.suspensionDays} onChange={(event) => updatePolicy({ suspensionDays: Number(event.target.value) })} /></label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Automatic Suspension Settings'}</button>
    <p><small>This feature is disabled by default. It applies only while Bathroom Passes is the selected usage limit.</small></p>
  </section>;
}
