import { useEffect, useState } from 'react';
import type { Settings, UsageLimitMode } from './types';
import { localAppServices } from './services';
import UsageLimitSettings from './UsageLimitSettings';
import WeeklyTimeSettings from './WeeklyTimeSettings';
import ProbationSettings from './ProbationSettings';

export default function UsageLimitsPanel({
  settings,
  changed,
  notice,
}: {
  settings: Settings;
  changed: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [selectedMode, setSelectedMode] = useState(settings.usageLimitMode);
  const [savingMode, setSavingMode] = useState(false);

  useEffect(() => setSelectedMode(settings.usageLimitMode), [settings.usageLimitMode]);

  async function selectMode(mode: UsageLimitMode) {
    if (mode === selectedMode || savingMode) return;
    const previousMode = selectedMode;
    setSelectedMode(mode);
    setSavingMode(true);
    try {
      await localAppServices.saveUsageLimitMode(mode);
      await changed();
      notice(`${mode === 'bathroom-passes' ? 'Bathroom Passes' : 'Weekly Bathroom Time'} selected. Only this usage limit is active.`);
    } catch (error) {
      setSelectedMode(previousMode);
      notice((error as Error).message);
    } finally {
      setSavingMode(false);
    }
  }

  return <>
    <section className="teacher-tab-intro" aria-labelledby="usage-limit-title">
      <h1 id="usage-limit-title">Usage Limit</h1>
      <p>Choose one way to limit bathroom use. Your settings for the other option are saved, but only the selected option is enforced.</p>
    </section>
    <fieldset className="usage-mode-selector" disabled={savingMode}>
      <legend>Choose a usage limit</legend>
      <label className={selectedMode === 'bathroom-passes' ? 'selected' : ''}>
        <input type="radio" name="usage-limit-mode" value="bathroom-passes" checked={selectedMode === 'bathroom-passes'} onChange={() => void selectMode('bathroom-passes')} />
        <span><b>Bathroom Passes</b><small>Limit completed passes and use per-pass timer thresholds.</small></span>
      </label>
      <label className={selectedMode === 'weekly-time' ? 'selected' : ''}>
        <input type="radio" name="usage-limit-mode" value="weekly-time" checked={selectedMode === 'weekly-time'} onChange={() => void selectMode('weekly-time')} />
        <span><b>Weekly Bathroom Time</b><small>Give each student a total amount of bathroom time per week.</small></span>
      </label>
    </fieldset>
    {selectedMode === 'bathroom-passes' ? <div className="usage-mode-content" data-mode="bathroom-passes">
      <UsageLimitSettings settings={settings} changed={changed} notice={notice} />
      <details className="advanced-disclosure bathroom-pass-advanced">
        <summary>Advanced</summary>
        <div className="advanced-content"><ProbationSettings settings={settings} changed={changed} notice={notice} /></div>
      </details>
    </div> : <div className="usage-mode-content" data-mode="weekly-time">
      <WeeklyTimeSettings settings={settings} changed={changed} notice={notice} />
    </div>}
  </>;
}
