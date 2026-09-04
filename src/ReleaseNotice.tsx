export default function ReleaseNotice({ dismiss }: { dismiss: () => Promise<void> }) {
  return <div className="modalback">
    <section className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="release-title">
      <h2 id="release-title">New: Weekly overtime can reduce next week’s allowance</h2>
      <p>Your existing roster, settings, PIN, queue, and recent history were preserved.</p>
      <p>Weekly automatic suspensions have been replaced by an optional setting that deducts overtime beyond a teacher-selected grace period from the following week’s allowance. It is <b>disabled by default</b>.</p>
      <p>Any already-active suspension remains in effect until it expires or a teacher ends it. Temporary suspensions and Bathroom Passes overtime rules are unchanged.</p>
      <p>Review the new option under Teacher Dashboard → Usage Limit → Weekly Bathroom Time → Advanced.</p>
      <p>These restrictions control only the app’s bathroom pass. Emergency and accommodation overrides must always remain available.</p>
      <button className="primary" onClick={() => void dismiss()}>Got it</button>
    </section>
  </div>;
}
