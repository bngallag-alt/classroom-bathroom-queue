export type PassType='bathroom'|'water';
export type Student={id:string;name:string;studentId:string;createdAt:string;updatedAt:string;deletedAt?:string;organizationId?:string;schoolId?:string;maxUses?:number|null;banned?:boolean};
export type ClassRecord={id:string;createdAt:string;updatedAt:string;deletedAt?:string;organizationId?:string;schoolId?:string;courseTitle?:string;period?:string;sectionNumber?:string;courseId?:string;teacherName?:string;calendar?:string;room?:string;schoolYear?:string};
export type Enrollment={id:string;studentId:string;classId:string;createdAt:string;updatedAt:string;deletedAt?:string};

export type ScheduleBlockKind='class'|'pcbl'|'passing'|'break'|'lunch'|'non-class';
export type ScheduleBlock={id:string;label:string;kind:ScheduleBlockKind;start:string;end:string;periodKey?:string;classId?:string};
export type BellSchedule={id:string;name:string;builtIn?:boolean;createdAt:string;updatedAt:string;days:Record<number,ScheduleBlock[]>};
export type ScheduleState={scheduleId:string;block?:ScheduleBlock;kind:ScheduleBlockKind;label:string;classId?:string;lineOpen:boolean;dateKey:string};

export type QueueEntry={id:string;studentId:string;classId?:string;queuedAt:string;status:'waiting'|'active';startedAt?:string;passType?:PassType;createdAt?:string;updatedAt?:string;deletedAt?:string};
export type QueueExitReason='bathroom-started'|'student-removed'|'teacher-removed'|'period-ended'|'manual-class-switch'|'teacher-quick-clear';
export type QueueHistory={id:string;queueEntryId:string;studentId:string;classId?:string;joinedAt:string;exitedAt:string;waitDurationSeconds:number;exitReason:QueueExitReason;createdAt:string;updatedAt:string};
export type Session={id:string;studentId:string;studentName:string;studentIdSnapshot:string;queuedAt:string;startedAt:string;endedAt:string;durationSeconds:number;durationFormatted:string;reachedWarning:boolean;overLimit:boolean;status:'completed'|'teacher-canceled';passType?:PassType;classId?:string;createdAt?:string;updatedAt?:string;deletedAt?:string};
export type Settings={id:'settings';warningSeconds:number;overLimitSeconds:number;pinHash:string;pinSalt:string;idDisplay:'masked'|'full'|'name';schemaVersion:number;setupComplete:boolean;globalUseLimit:number;countWaterAsBathroom:boolean;teacherHotkey:string;clearQueueHotkey:string;currentClassId?:string;activeScheduleId:string;todayScheduleId?:string;todayScheduleDate?:string;autoSchedulePausedDate?:string;manualOverrideBlockId?:string;lastScheduleStateId?:string;clockWarning?:string};
export type Backup={format:'classroom-bathroom-queue';backupVersion:3;schemaVersion:3;exportedAt:string;students:Student[];classes:ClassRecord[];enrollments:Enrollment[];queue:QueueEntry[];queueHistory:QueueHistory[];sessions:Session[];bellSchedules:BellSchedule[];settings:Omit<Settings,'pinHash'|'pinSalt'> & {pinProtected:true}};
