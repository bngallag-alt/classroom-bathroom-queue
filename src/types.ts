export type PassType='bathroom'|'water';
export type Student={id:string;name:string;externalIdHash:string;externalIdLast4:string;createdAt:string;updatedAt:string;deletedAt?:string;organizationId?:string;schoolId?:string;maxUses?:number|null;banned?:boolean};
export type LegacyStudent=Omit<Student,'externalIdHash'|'externalIdLast4'>&{studentId:string;externalIdHash?:string;externalIdLast4?:string};
export type ClassRecord={id:string;createdAt:string;updatedAt:string;deletedAt?:string;organizationId?:string;schoolId?:string;courseTitle?:string;period?:string;sectionNumber?:string;courseId?:string;teacherName?:string;calendar?:string;room?:string;schoolYear?:string};
export type Enrollment={id:string;studentId:string;classId:string;createdAt:string;updatedAt:string;deletedAt?:string};

export type ScheduleBlockKind='class'|'pcbl'|'passing'|'break'|'lunch'|'non-class';
export type ScheduleBlock={id:string;label:string;kind:ScheduleBlockKind;start:string;end:string;periodKey?:string;classId?:string};
export type BellSchedule={id:string;name:string;builtIn?:boolean;createdAt:string;updatedAt:string;days:Record<number,ScheduleBlock[]>};
export type ScheduleState={scheduleId:string;block?:ScheduleBlock;kind:ScheduleBlockKind;label:string;classId?:string;lineOpen:boolean;dateKey:string};

export type QueueEntry={id:string;studentId:string;classId?:string;queuedAt:string;status:'waiting'|'active';startedAt?:string;passType?:PassType;createdAt?:string;updatedAt?:string;deletedAt?:string};
export type QueueExitReason='bathroom-started'|'student-removed'|'teacher-removed'|'period-ended'|'manual-class-switch'|'teacher-quick-clear';
export type QueueHistory={id:string;queueEntryId:string;studentId:string;classId?:string;joinedAt:string;exitedAt:string;waitDurationSeconds:number;exitReason:QueueExitReason;createdAt:string;updatedAt:string};
export type Session={id:string;studentId:string;studentName:string;queuedAt:string;startedAt:string;endedAt:string;durationSeconds:number;durationFormatted:string;reachedWarning:boolean;overLimit:boolean;status:'completed'|'teacher-canceled';passType?:PassType;classId?:string;createdAt?:string;updatedAt?:string;deletedAt?:string};
export type Settings={id:'settings';warningSeconds:number;overLimitSeconds:number;pinHash:string;pinSalt:string;idDisplay:'masked'|'full'|'name';schemaVersion:number;setupComplete:boolean;globalUseLimit:number;countWaterAsBathroom:boolean;teacherHotkey:string;clearQueueHotkey:string;currentClassId?:string;activeScheduleId:string;todayScheduleId?:string;todayScheduleDate?:string;autoSchedulePausedDate?:string;manualOverrideBlockId?:string;lastScheduleStateId?:string;clockWarning?:string;lookupSecret:string;privacyVersion:number;privacyMigrationCompletedAt?:string;privacyNoticeAcknowledged:boolean;historyRetentionDays:number;lastSuccessfulPurgeAt?:string};

export type AppData={students:Student[];classes:ClassRecord[];enrollments:Enrollment[];queue:QueueEntry[];queueHistory:QueueHistory[];sessions:Session[];bellSchedules:BellSchedule[];settings:Settings};
export type LegacyBackup={format:'classroom-bathroom-queue';backupVersion:1|2|3;schemaVersion:1|2|3;exportedAt:string;students:LegacyStudent[];classes?:ClassRecord[];enrollments?:Enrollment[];queue:QueueEntry[];queueHistory?:QueueHistory[];sessions:Array<Session&{studentIdSnapshot?:string}>;bellSchedules?:BellSchedule[];settings:Record<string,unknown>&{id:'settings'}};
export type BackupPayloadV4={format:'classroom-bathroom-queue-payload';backupVersion:4;schemaVersion:4;exportedAt:string;data:AppData};
export type EncryptedBackupV4={format:'classroom-bathroom-queue-encrypted';backupVersion:4;schemaVersion:4;kdf:{name:'PBKDF2';hash:'SHA-256';iterations:number;salt:string};cipher:{name:'AES-GCM';iv:string};ciphertext:string};
export type Backup=LegacyBackup|EncryptedBackupV4;
