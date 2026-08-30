# Future cloud architecture

## Current architecture

```text
React UI
  ↓
Application services
  ↓
Repository interfaces
  ↓
IndexedDB
```

The current application is local-first and single-teacher. Student records, classes, enrollments, queue entries, retained bathroom sessions, and settings remain in the Chromebook browser. Portable full backups are exported only as password-encrypted files. The repository interfaces in `src/repositories.ts` isolate storage details, while `src/services.ts` centralizes application mutations. The only implementations are local IndexedDB repositories. No record is transmitted anywhere.

Students have internal UUIDs distinct from their district student numbers. Raw student numbers are not durable fields: exact kiosk and import matching uses per-installation HMAC-SHA-256 lookup values, while relationships continue to use internal UUIDs. Aeries imports retain class metadata and create enrollment relationships, so one student can belong to several classes without duplication. Sessions optionally record the class currently designated for the kiosk. Statistics are calculated from the rolling 30-day retained session window; no permanent per-student aggregate is kept.

Bell schedules and queue-history records are also local repository entities. The schedule engine resolves the current block from local date and time, while application services reconcile class transitions and record why a waiting entry left the queue. Bathroom sessions remain separate from queue history, so unmet demand is never counted as bathroom use. A future synchronized implementation could carry these records through the same repository boundary without changing the kiosk screens.

The local teacher PIN is a classroom access deterrent. It is not a teacher identity, account, or authentication credential.

## Possible future architecture

```text
React UI
  ↓
Application services
  ↓
Local IndexedDB
  ↓
Synchronization layer
  ↓
Authenticated backend/API
  ↓
Central database
```

A future, separately approved system could add another repository implementation or synchronization adapter without rewriting queue, timer, roster, statistics, or Aeries parsing. That system could eventually support multiple teachers and classes, external-ID matching within an organization, cross-class student statistics, deidentified schoolwide aggregates, server backups, teacher authentication, and role-based access.

An outbox would belong beside the local repository implementations: application services would save locally and append a local operation record, while a separate synchronization process would deliver it. No outbox or synchronization process is required today because adding unused operational state would reduce simplicity.

## Privacy boundary

None of the possible cloud features are implemented. This project includes no remote repository, API server, Supabase, Firebase, PostgreSQL, Google login, WebSocket, remote backup, analytics, or network synchronization. It requires no teacher account, Chromebook administrator, or school IT configuration and continues to operate offline.

Student names and recent history remain identifiable local information. The lookup secret is stored with local data and is a privacy boundary against casual raw-ID inspection, not device security. User-requested permanent deletion and factory reset still erase local data. Optional `deletedAt` fields are reserved for a future tombstone policy, but privacy-directed deletion and retention must take priority over synchronization history.
