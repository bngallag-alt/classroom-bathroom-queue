import { useState } from 'react';
import type { Settings } from './types';
import { localAppServices } from './services';

export default function UsageLimitSettings({
  settings,
  changed,
  notice,
}: {
  settings: Settings;
  changed: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [limit, setLimit] = useState(String(settings.globalUseLimit ?? 0));
  const [warning, setWarning] = useState(Math.floor(settings.warningSeconds / 60));
  const [over, setOver] = useState(Math.floor(settings.overLimitSeconds / 60));
  const [savingLimit, setSavingLimit] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [thresholdError, setThresholdError] = useState('');

  async function saveLimit(next: string) {
    setLimit(next);
    setSavingLimit(true);
    try {
      await localAppServices.saveSettings({ ...settings, globalUseLimit: Number(next) });
      await changed();
      notice('Bathroom Passes saved automatically.');
    } finally {
      setSavingLimit(false);
    }
  }

  async function saveThresholds() {
    if (!Number.isInteger(warning) || warning < 1) return setThresholdError('Warning Threshold must be a whole number of at least 1 minute.');
    if (!Number.isInteger(over) || over <= warning) return setThresholdError('Over the Limit Threshold must be a whole number greater than the Warning Threshold.');
    setSavingThresholds(true);
    try {
      await localAppServices.saveSettings({ ...settings, warningSeconds: warning * 60, overLimitSeconds: over * 60 });
      await changed();
      setThresholdError('');
      notice('Bathroom timer thresholds saved.');
    } finally {
      setSavingThresholds(false);
    }
  }

  return <>
    <section className="teacher-tab-intro" aria-labelledby="usage-limit-title">
      <h1 id="usage-limit-title">Usage Limit</h1>
      <p>Set how often students may use a bathroom pass, how much weekly bathroom time they receive, and when the timer changes to warning or over-limit status.</p>
    </section>
    <div className="settings-grid usage-limit-grid">
      <section className="card usage-settings">
        <h2>Bathroom Passes</h2>
        <p>Choose the number of counted, completed bathroom passes allowed for each student.</p>
        <label>Bathroom Passes<select value={limit} disabled={savingLimit} onChange={(event) => void saveLimit(event.target.value)}><option value="0">Unlimited</option>{[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <p>Individual student limits and permanent bans are managed on the Roster page.</p>
        <small aria-live="polite">{savingLimit ? 'Saving…' : 'Changes save automatically.'}</small>
      </section>
      <section className="card usage-settings">
        <h2>Bathroom Timer Thresholds</h2>
        <p>Choose when an active bathroom timer displays its warning and over-limit states.</p>
        <label>Warning Threshold (minutes)<input type="number" min="1" step="1" value={warning} onChange={(event) => { setWarning(Number(event.target.value)); setThresholdError(''); }} /></label>
        <label>Over the Limit Threshold (minutes)<input type="number" min="2" step="1" value={over} onChange={(event) => { setOver(Number(event.target.value)); setThresholdError(''); }} /></label>
        {thresholdError && <p className="error" role="alert">{thresholdError}</p>}
        <button className="primary" disabled={savingThresholds} onClick={() => void saveThresholds()}>{savingThresholds ? 'Saving…' : 'Save Timer Thresholds'}</button>
      </section>
    </div>
  </>;
}
