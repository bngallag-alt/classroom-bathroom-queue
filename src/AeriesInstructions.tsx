export default function AeriesInstructions() {
  const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;

  return <section className="card aeries-instructions">
    <h1>How to download an Aeries roster</h1>
    <ol>
      <li>Go to Aeries Reports.</li>
      <li>
        Select <b>Class Rosters</b>.
        <details>
          <summary>View Screenshot 1</summary>
          <a href={asset('aeries-step-2.png')} target="_blank" rel="noreferrer" aria-label="Open Screenshot 1 full size">
            <img src={asset('aeries-step-2.png')} alt="Aeries Reports page with an arrow pointing to Class Rosters" />
          </a>
          <small>Select the image to open it full size.</small>
        </details>
      </li>
      <li>
        Set <b>Report Format</b> to <b>TXT</b>, set <b>Print For</b> to <b>One Day</b>, and leave every checkbox unchecked.
        <details>
          <summary>View Screenshot 2</summary>
          <a href={asset('aeries-step-3.png')} target="_blank" rel="noreferrer" aria-label="Open Screenshot 2 full size">
            <img src={asset('aeries-step-3.png')} alt="Aeries Class Roster settings showing TXT, One Day, and unchecked options" />
          </a>
          <small>Select the image to open it full size.</small>
        </details>
      </li>
      <li>Run the report for all desired classes.</li>
      <li>Download the report, then import the downloaded TXT file here.</li>
    </ol>
  </section>;
}
