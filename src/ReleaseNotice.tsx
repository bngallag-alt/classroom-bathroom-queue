export default function ReleaseNotice({ dismiss }: { dismiss: () => Promise<void> }) {
  return <div className="modalback">
    <section className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="release-title">
      <h2 id="release-title">New: Pass Suspension and weekly bathroom-time limits</h2>
      <p>Your existing roster, settings, PIN, queue, and recent history were preserved.</p>
      <p>Overtime-count warnings, weekly-time limits, and automatic suspensions are all <b>disabled by default</b>. Review them under Teacher Dashboard → Pass Suspension and Usage Limit.</p>
      <p>Teachers can set individual weekly overrides or unlimited time, and can apply, adjust, or end temporary suspensions.</p>
      <p>These restrictions control only the app’s bathroom pass. Emergency and accommodation overrides must always remain available.</p>
      <button className="primary" onClick={() => void dismiss()}>Got it</button>
    </section>
  </div>;
}
