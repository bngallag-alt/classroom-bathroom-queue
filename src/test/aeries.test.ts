import{describe,expect,it}from'vitest';import{aeriesImportStatus,convertAeriesName,displayAeriesName,parseAeriesRoster}from'../aeries';import type{Student}from'../types';

const oneClass=`Fictional High School,Attendance Class Roster
Period,Course Title,Term,Sec#,Crs ID,Teacher,Calendar,Room,Year
P3 10:40AM-11:30AM,Government,Y,75,302745,"TEACHER, SAMPLE",P3,L207,26-27
Student ID,Student Name,GR,8/7/2026
01,170000,,"Almond, Thomas L",10,,,,

02,170001,,"Jones, Jerry G",11,,,,`;
const secondClass=`Fictional High School,Attendance Class Roster
Period,Course Title,Term,Sec#,Crs ID,Teacher,Calendar,Room,Year
P6 1:00PM-1:50PM,Civics,Y,91,302700,"TEACHER, SAMPLE",P6,L208,26-27
Student ID,Student Name,GR,8/7/2026
01,170000,,"Almond, Thomas L",10,,,,
02,170002,,"Nets, Utah B",12,,,,`;
const existing:Student={id:'existing',name:'Thomas L Almond',studentId:'170000',createdAt:'2026-01-01',updatedAt:'2026-01-01'};

describe('Aeries roster parser',()=>{it('parses one class and ignores report metadata',()=>{const result=parseAeriesRoster(oneClass);expect(result.isAeries).toBe(true);expect(result.classes).toHaveLength(1);expect(result.classes[0]).toMatchObject({period:'P3 10:40AM-11:30AM',courseTitle:'Government',sectionNumber:'75',courseId:'302745',room:'L207',studentCount:2});expect(result.students).toHaveLength(2)});it('parses every concatenated class',()=>{const result=parseAeriesRoster(`${oneClass}\n\n${secondClass}`);expect(result.classes).toHaveLength(2);expect(result.students).toHaveLength(3)});it('uses column two as the real string student ID',()=>{const student=parseAeriesRoster(oneClass).students[0];expect(student.studentId).toBe('170000');expect(student.studentId).not.toBe('01');expect(typeof student.studentId).toBe('string')});it('parses quoted names containing commas exactly',()=>expect(parseAeriesRoster(oneClass).students[0].rawName).toBe('Almond, Thomas L'));it('converts Last, First Middle without dropping middle names',()=>{expect(convertAeriesName('Almond, Thomas L')).toBe('Thomas L Almond');expect(displayAeriesName('Almond, Thomas L','aeries')).toBe('Almond, Thomas L')});it('tolerates blank lines between students',()=>expect(parseAeriesRoster(oneClass).students).toHaveLength(2));it('deduplicates students across classes and retains all class memberships',()=>{const student=parseAeriesRoster(`${oneClass}\n${secondClass}`).students.find(s=>s.studentId==='170000');expect(student?.classKeys).toHaveLength(2)});it('detects an existing matching roster student',()=>{const student=parseAeriesRoster(oneClass).students[0];expect(aeriesImportStatus(student,[existing],convertAeriesName(student.rawName))).toBe('Already in roster')});it('detects a different existing name',()=>{const student=parseAeriesRoster(oneClass).students[0];expect(aeriesImportStatus(student,[{...existing,name:'Different Name'}],convertAeriesName(student.rawName))).toBe('Name differs from existing record')});it('rejects unrelated text',()=>expect(parseAeriesRoster('ordinary notes\nnot a roster').isAeries).toBe(false));it('reports a malformed empty class section',()=>{const result=parseAeriesRoster('Fictional High School,Attendance Class Roster\nPeriod,Course Title\nP1,Course');expect(result.classes[0].malformed).toMatch(/No valid/);expect(result.warnings.length).toBeGreaterThan(0)});it('detects duplicate IDs with conflicting names',()=>{const result=parseAeriesRoster(`${oneClass}\n${secondClass.replace('Almond, Thomas L','Almond, Tommy')}`);expect(result.students.find(s=>s.studentId==='170000')?.conflictingNames).toEqual(['Almond, Tommy'])})});

export{oneClass,secondClass};
