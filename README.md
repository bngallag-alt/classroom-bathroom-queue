# Classroom Bathroom Queue

A touchscreen-friendly, local-first classroom bathroom line. Students use their existing student number to join or leave the line, start a timestamp-based timer, and mark their return. Teachers use a PIN-protected dashboard to manage the roster and queue, review retained statistics, configure limits and shortcuts, import rosters, and manage exports and backups.

## Privacy and local storage

All application records remain in this browser's IndexedDB database, `ClassroomBathroomQueue`. The application has no backend, cloud database, account, analytics, advertising, telemetry, or external synchronization. The teacher PIN is a local classroom deterrent, not an account or a strong device-security control.

Student numbers are normalized as digit strings, preserving leading zeroes, and stored as per-installation protected lookup values: HMAC-SHA-256 values created with a random 256-bit secret held in the same local database. The raw number is not retained after entry or import. Names, classes, recent bathroom history, and queue information are still identifiable local student information; protecting student numbers does not anonymize the database or protect a compromised device/browser profile.

Detailed completed-session and queue history is retained for a rolling 30 days. Records older than the cutoff are removed at startup, after completion and restore, and before backup or history export. Rosters, classes, settings, schedules, waiting entries, active entries, and active timer timestamps are not part of that purge.

Browser storage is tied to the exact deployed origin and browser profile. Clearing site data, using incognito/private mode, changing browser profiles or devices, powerwashing a Chromebook, or changing the site's origin can make the local data unavailable. An application migration cannot repair cleared storage or move data between origins. Keep the exact existing GitHub Pages address for seamless upgrades.

## Existing-installation privacy migration

Version 4 retains the same database name, stores, PWA scope, deployment base, and internal UUID relationships. On the first load at the same origin:

1. The app opens the existing Dexie database and reads every migration store.
2. It classifies student records as legacy, protected, partial, or invalid and validates current queue and enrollment relationships.
3. It reuses a valid installation secret or generates one random 256-bit secret, normalizes every legacy student number, derives every HMAC, and checks for invalid or duplicate identifiers before mutation.
4. In one Dexie transaction it replaces student records with protected lookup fields, removes session ID snapshots, purges expired detailed history, and records schema/privacy version 4 metadata.
5. Internal student UUIDs, names, classes, enrollments, settings, PIN hash/salt, schedules, limits, bans, queue order, and active `startedAt` timestamps remain unchanged.
6. A configured teacher sees a one-time privacy-update notice and continues without setup or roster re-import.

The migration is idempotent and coordinated with the browser's same-origin Web Locks API when available. Failure aborts the destructive transaction, leaves source data recoverable, shows a non-destructive error, and offers Retry. It never factory-resets the app.

## Backups, restores, imports, and CSV exports

Version 4 full backups are portable encrypted JSON envelopes. The full payload is encrypted with AES-256-GCM using a key derived from a separate teacher-supplied password with PBKDF2-SHA-256, a random salt, and 310,000 iterations. Only format/version, KDF parameters, salt, IV, and ciphertext appear outside the encrypted payload. The backup password is not the teacher PIN, is not stored by the app, and is required for restore. Store both the encrypted file and its password securely; forgotten passwords cannot be recovered.

Legacy unencrypted version 1, 2, and 3 backups remain importable. The app validates and converts their raw numbers in memory before a single transactional replacement, removes legacy snapshots, enforces retention, and retains the current installation's teacher PIN. A legacy file may contain readable student IDs and should be securely deleted after a successful converted restore.

Aeries TXT and standard CSV imports may hold raw numbers temporarily while parsing a teacher-only preview. Selected numbers are converted to protected lookups before IndexedDB persistence. Routine roster export is name-only because raw numbers cannot be reconstructed. History CSV omits raw numbers, HMAC values, and the installation secret, but it still contains identifiable names and recent history and must be handled accordingly.

## Run and verify locally

Install Node.js 20 or newer, open PowerShell in this folder, and run:

```powershell
npm install
npm run dev
```

Open the address printed by Vite, usually `http://localhost:5173`. The first screen guides a new installation through PIN and optional roster setup.

Run the complete validation suite with:

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```

The production output is written to `dist`.

## Chromebook and offline use

Visit the deployed HTTPS address in Chrome. Choose **Start Bathroom Kiosk** and approve ordinary browser fullscreen. Escape and normal browser/operating-system controls can exit fullscreen; the app hides queue information until fullscreen is restored. Queue state and the active timer timestamp remain in IndexedDB and survive an ordinary reload.

Teacher access uses the configured keyboard shortcut (initially **Ctrl+Shift+5**) followed by the local PIN. Chrome installation is optional. After one successful online load, the service worker caches the application shell for offline use. New service-worker versions wait for a controlled, teacher-confirmed reload instead of forcing an update while the kiosk is active. Updates do not delete IndexedDB or Cache Storage.

## Static GitHub Pages deployment

The included workflow builds and publishes `dist`. It does not include browser IndexedDB contents, local backup files, or student records. Keep the current repository path and Pages URL unchanged so existing browsers retain access to their same-origin IndexedDB. No environment variables or API keys are required.

## Troubleshooting

- **Records appear missing:** verify the exact HTTPS address and Chrome profile, then check whether site data was cleared. Restore an encrypted backup if available.
- **A backup will not open:** confirm the correct backup password. Authentication failure or altered ciphertext leaves live data unchanged.
- **Storage is blocked:** allow site data, leave incognito/private mode, confirm available disk space, and reload. District policy may restrict storage or downloads.
- **Fullscreen is lost:** use **Return to fullscreen** and check site permissions if the request is denied.
- **PIN is forgotten:** factory reset is the local recovery path, but it erases all records. A backup can be restored after creating a new PIN.

Encrypted backups are the only portable protection against cleared browser data, device replacement, or a changed browser profile. They cannot preserve access if both the file or its password are lost.
