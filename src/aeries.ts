import Papa from 'papaparse';
import type {Student} from './types';

export type AeriesClass={key:string;period:string;courseTitle:string;sectionNumber:string;courseId:string;teacher:string;calendar:string;room:string;schoolYear:string;studentCount:number;malformed?:string};
export type AeriesStudent={studentId:string;rawName:string;grade:string;classKeys:string[];conflictingNames:string[];valid:boolean};
export type AeriesParseResult={isAeries:boolean;classes:AeriesClass[];students:AeriesStudent[];warnings:string[]};

const clean=(value:unknown)=>String(value??'').trim();
export function convertAeriesName(name:string){const comma=name.indexOf(',');if(comma<0)return name.trim();const last=name.slice(0,comma).trim(),rest=name.slice(comma+1).trim();return `${rest} ${last}`.trim()}
export function displayAeriesName(name:string,format:'aeries'|'first-last'){return format==='first-last'?convertAeriesName(name):name}

export function parseAeriesRoster(text:string):AeriesParseResult{
 const parsed=Papa.parse<string[]>(text,{skipEmptyLines:false});const rows=parsed.data??[],classes:AeriesClass[]=[],warnings:string[]=[],students=new Map<string,AeriesStudent>();let current:AeriesClass|undefined,inStudents=false,metadataHeader:string[]|undefined,sectionSawStudent=false;
 const finish=()=>{if(current&&!sectionSawStudent){current.malformed='No valid student records were found in this class section.';warnings.push(`${current.period||current.key}: ${current.malformed}`)}};
 for(const raw of rows){const row=raw.map(clean);if(row.some(x=>x==='Attendance Class Roster')){finish();current={key:`class-${classes.length+1}`,period:'Unknown period',courseTitle:'Unknown course',sectionNumber:'',courseId:'',teacher:'',calendar:'',room:'',schoolYear:'',studentCount:0};classes.push(current);inStudents=false;metadataHeader=undefined;sectionSawStudent=false;continue}if(!current||row.every(x=>!x))continue;
  if(row[0]==='Period'&&row.includes('Course Title')){metadataHeader=row;inStudents=false;continue}
  if(metadataHeader&&row[0]&&row[0]!=='Student ID'){const value=(name:string)=>row[metadataHeader!.indexOf(name)]??'';current.period=value('Period')||current.period;current.courseTitle=value('Course Title')||current.courseTitle;current.sectionNumber=value('Sec#');current.courseId=value('Crs ID');current.teacher=value('Teacher');current.calendar=value('Calendar');current.room=value('Room');current.schoolYear=value('Year');metadataHeader=undefined;continue}
  if(row[0]==='Student ID'&&row.includes('Student Name')){inStudents=true;continue}if(!inStudents)continue;
  const studentId=row[1],name=row[3],grade=row[4];if(!/^\d+$/.test(studentId)||!name){if(row.some(Boolean)&&row[0]&&!['Student ID','Period'].includes(row[0]))warnings.push(`${current.period}: ignored malformed student row.`);continue}
  sectionSawStudent=true;current.studentCount++;const existing=students.get(studentId);if(existing){if(!existing.classKeys.includes(current.key))existing.classKeys.push(current.key);if(existing.rawName!==name&&!existing.conflictingNames.includes(name))existing.conflictingNames.push(name)}else students.set(studentId,{studentId,rawName:name,grade,classKeys:[current.key],conflictingNames:[],valid:true});
 }
 finish();return{isAeries:classes.length>0,classes,students:[...students.values()],warnings:[...new Set(warnings)]}
}

export function aeriesImportStatus(student:AeriesStudent,existing:Student[],displayName:string){const match=existing.find(x=>x.studentId===student.studentId);if(student.conflictingNames.length)return'Duplicate ID has conflicting names';if(match)return match.name===displayName?'Already in roster':'Name differs from existing record';if(student.classKeys.length>1)return'Appears in multiple imported classes';return'New student'}
