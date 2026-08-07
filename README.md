# Classroom Bathroom Queue

A private, touchscreen-friendly classroom bathroom line. Students can join or leave the line, see their position, start an exact timer, and mark their return. Teachers can manage the roster and queue, review statistics, change time limits, import/export CSV files, and make or restore complete backups.

## Privacy and storage

Everything is stored locally in this browser's IndexedDB database. There is no backend, cloud database, account, analytics, advertising, or tracking. Clearing Chrome site data, resetting/powerwashing the Chromebook, or changing to a different web address may erase or separate the records. Export a full backup regularly, and store backups securely because they contain student information.

The application does not require a Chromebook administrator, Google Admin Console, managed ChromeOS kiosk mode, or a browser extension. District policy can still restrict websites, downloads, storage, fullscreen, or other browser features.

## Run it on this computer

Install current Node.js (version 20 or newer), open PowerShell in this folder, then run:

```powershell
npm install
npm run dev
```

Open the address Vite prints, usually `http://localhost:5173`. The first screen guides the teacher through PIN and roster setup. To check the project:

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
npm run preview
```

The production site is created in `dist`. `npm run preview` serves that build for a final local check.

## Chromebook use

Visit the deployed HTTPS address in Chrome. Complete setup, choose **Start Bathroom Kiosk**, and approve ordinary browser fullscreen. Normal browser and operating-system controls—including Escape—can exit fullscreen. The queue and running timer remain intact; the app hides student information until **Return to fullscreen** is pressed.

Teacher access is intentionally hidden from the student screen. Press **Ctrl+Shift+5**, then enter the teacher PIN. If fullscreen is blocked, click the page first, use the teacher dashboard's fullscreen button, and check Chrome's site permissions. The app never forces fullscreen automatically.

Chrome may offer **Install app** in its menu or address bar. Installation is optional; the hosted site works normally. After one successful online load, the service worker caches the application shell for essential offline use.

## Roster, backup, and exports

In the teacher dashboard:

- Roster CSV files use the exact headings `name,studentId`. IDs stay as text, including leading zeroes. Import shows a complete preview and blocks files with invalid rows. A fictional example is: `Jordan Lee,001482`.
- **Export full backup** downloads roster, queue, active timer timestamps, history, and non-secret settings as versioned JSON. The current teacher PIN is intentionally retained when restoring.
- **Restore full backup** validates the file and shows its date and record counts before replacing local data.
- **Export roster CSV** exports current students only.
- **Export bathroom history CSV** exports completed and teacher-canceled sessions newest-first.

## Static HTTPS deployment

Any static HTTPS host can serve the `dist` folder; no environment variables or API keys are needed. The app uses relative asset paths, so refreshes work from a project subfolder. To publish with GitHub Pages, push the repository to GitHub, open **Settings → Pages**, choose **GitHub Actions**, and run the included deployment workflow. The workflow builds and publishes `dist`.

App updates should deploy new static files at the same HTTPS address. They do not intentionally erase IndexedDB. Changing the hostname or path can give Chrome a different storage origin, so export a backup before changing deployment addresses.

## Troubleshooting

- **Lost records:** confirm you opened the exact same HTTPS address and Chrome profile. Check whether site data was cleared. Restore the newest secure backup if needed.
- **Storage fails or is blocked:** allow site data for the address, leave private/incognito mode, confirm free disk space, and reload. District browser policy may disable storage.
- **Fullscreen is lost:** queue information is deliberately hidden. Press **Return to fullscreen**. If denied, check site permissions or use the teacher dashboard.
- **PIN forgotten:** the welcome screen provides teacher access; a full local reset is the recovery route, but it deletes all records. Restore a backup afterward if available.

Regular backup exports are the only durable protection against cleared browser data, Chromebook replacement, or powerwashing.
