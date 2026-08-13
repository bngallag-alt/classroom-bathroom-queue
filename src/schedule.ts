import type{BellSchedule,ScheduleBlock,ScheduleState}from'./types';

export const DEFAULT_SCHEDULE_ID='default-school-bell-schedule';
export const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const block=(id:string,label:string,kind:ScheduleBlock['kind'],start:string,end:string,periodKey?:string):ScheduleBlock=>({id,label,kind,start,end,periodKey});
const passing=(id:string,start:string,end:string)=>block(id,'Passing Period','passing',start,end);
const day=(...blocks:ScheduleBlock[])=>blocks;

export function builtInDefaultSchedule(at=new Date()):BellSchedule{return{id:DEFAULT_SCHEDULE_ID,name:'Default School Bell Schedule',builtIn:true,createdAt:at.toISOString(),updatedAt:at.toISOString(),days:{
  0:[],
  1:day(block('mon-p1','Period 1','class','08:45','10:15','P1'),passing('mon-pass-1','10:15','10:25'),block('mon-p3','Period 3','class','10:25','12:00','P3'),block('mon-lunch','Lunch','lunch','12:00','12:35'),passing('mon-pass-2','12:35','12:40'),block('mon-p5','Period 5','class','12:40','14:10','P5'),passing('mon-pass-3','14:10','14:20'),block('mon-p7','Period 7','class','14:20','15:50','P7')),
  2:day(block('tue-p2','Period 2','class','08:45','10:15','P2'),passing('tue-pass-1','10:15','10:25'),block('tue-p4','Period 4','class','10:25','12:00','P4'),block('tue-lunch','Lunch','lunch','12:00','12:35'),passing('tue-pass-2','12:35','12:40'),block('tue-pcbl','PCBL','pcbl','12:40','13:25','PCBL'),passing('tue-pass-3','13:25','13:35'),block('tue-p6','Period 6','class','13:35','15:05','P6')),
  3:day(block('wed-p1','Period 1','class','08:45','09:35','P1'),passing('wed-pass-1','09:35','09:40'),block('wed-p2','Period 2','class','09:40','10:30','P2'),block('wed-break','Break','break','10:30','10:40'),block('wed-p3','Period 3','class','10:40','11:30','P3'),passing('wed-pass-2','11:30','11:35'),block('wed-p4','Period 4','class','11:35','12:30','P4'),block('wed-lunch','Lunch','lunch','12:30','13:05'),passing('wed-pass-3','13:05','13:10'),block('wed-p5','Period 5','class','13:10','14:00','P5'),passing('wed-pass-4','14:00','14:05'),block('wed-p6','Period 6','class','14:05','14:55','P6'),passing('wed-pass-5','14:55','15:05'),block('wed-p7','Period 7','class','15:05','15:55','P7')),
  4:day(block('thu-p1','Period 1','class','08:45','10:15','P1'),passing('thu-pass-1','10:15','10:25'),block('thu-p3','Period 3','class','10:25','12:00','P3'),block('thu-lunch','Lunch','lunch','12:00','12:35'),passing('thu-pass-2','12:35','12:40'),block('thu-p5','Period 5','class','12:40','14:10','P5'),passing('thu-pass-3','14:10','14:20'),block('thu-p7','Period 7','class','14:20','15:50','P7')),
  5:day(block('fri-p2','Period 2','class','08:45','10:15','P2'),passing('fri-pass-1','10:15','10:25'),block('fri-p4','Period 4','class','10:25','12:00','P4'),block('fri-lunch','Lunch','lunch','12:00','12:35'),passing('fri-pass-2','12:35','12:40'),block('fri-pcbl','PCBL','pcbl','12:40','13:25','PCBL'),passing('fri-pass-3','13:25','13:35'),block('fri-p6','Period 6','class','13:35','15:05','P6')),
  6:[]
}}}

const minutes=(value:string)=>{const[h,m]=value.split(':').map(Number);return h*60+m};
export function resolveSchedule(schedule:BellSchedule,date:Date):ScheduleState{const current=date.getHours()*60+date.getMinutes(),candidate=(schedule.days[date.getDay()]??[]).find(x=>current>=minutes(x.start)&&current<minutes(x.end));if(!candidate)return{scheduleId:schedule.id,kind:'non-class',label:'Non-class',lineOpen:true,dateKey:dateKey(date)};return{scheduleId:schedule.id,block:candidate,kind:candidate.kind,label:candidate.label,classId:candidate.classId,lineOpen:true,dateKey:dateKey(date)}}
export function recognizablePeriod(value?:string){const match=value?.trim().toUpperCase().match(/^P([1-7])$/);return match?`P${match[1]}`:undefined}
export function applySuggestedMappings(schedule:BellSchedule,classes:{id:string;period?:string;calendar?:string}[]){const suggestions=new Map<string,string>();for(const c of classes){const key=recognizablePeriod(c.period)||recognizablePeriod(c.calendar);if(key&&!suggestions.has(key))suggestions.set(key,c.id)}return{...schedule,days:Object.fromEntries(Object.entries(schedule.days).map(([key,blocks])=>[key,blocks.map(b=>b.classId||!b.periodKey?b:{...b,classId:suggestions.get(b.periodKey)})])),updatedAt:new Date().toISOString()}}
