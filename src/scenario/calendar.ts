import type { CalendarDefinition } from './schema';
import type { GameDate } from '../domain/types';
export const defaultCalendar:CalendarDefinition={id:'simple',type:'fictional',era:'',firstYearLabel:'',months:Array(12).fill(30),periods:[],start:{year:1,month:1,day:1,minuteOfDay:0},allowAdvance:true};
const utc=(y:number,m:number,d:number)=>{const x=new Date(0);x.setUTCFullYear(y,m-1,d);x.setUTCHours(0,0,0,0);return x;};
export function calendarDate(c:CalendarDefinition,year:number,month:number,day:number,minuteOfDay=0):GameDate{
  if(![year,month,day,minuteOfDay].every(Number.isInteger)||year<1||year>9999||day<1||minuteOfDay<0||minuteOfDay>=1440)throw new Error('日期无效');
  let absoluteDay:number;
  if(c.type==='gregorian'){const x=utc(year,month,day);if(x.getUTCMonth()!==month-1||x.getUTCDate()!==day||x.getUTCFullYear()!==year)throw new Error('现代日期无效');absoluteDay=Math.floor((x.getTime()-utc(1,1,1).getTime())/86400000);}
  else if(c.type==='relative'||c.type==='none'){if(year!==1||month!==1)throw new Error('相对日期使用天数');absoluteDay=day-1;}
  else{if(month<1||month>c.months.length||day>c.months[month-1])throw new Error('日期超出剧本日历');absoluteDay=(year-1)*c.months.reduce((a,b)=>a+b,0)+c.months.slice(0,month-1).reduce((a,b)=>a+b,0)+day-1;}
  const time=String(Math.floor(minuteOfDay/60)).padStart(2,'0')+':'+String(minuteOfDay%60).padStart(2,'0');
  const period=c.periods.length?c.periods[Math.floor(((minuteOfDay+60)%1440)/1440*c.periods.length)]:time;
  const display=c.type==='none'?'无明确时间':c.type==='relative'?'第'+day+'天 · '+period:c.type==='gregorian'?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')} · ${period}`:c.era+(year===1&&c.firstYearLabel?c.firstYearLabel:year)+'年 · '+month+'月'+day+'日 · '+period;
  return {year,month,day,minuteOfDay,absoluteDay,period,calendarVersion:c.id,display};
}
export function advanceCalendar(date:GameDate,minutes:number,c:CalendarDefinition){
  if(!Number.isInteger(minutes)||minutes<0||minutes>43200)throw new Error('时间推进无效');if(c.type==='none'||!c.allowAdvance){if(minutes)throw new Error('此剧本不允许推进时间');return date;}
  const total=date.absoluteDay*1440+date.minuteOfDay+minutes,absolute=Math.floor(total/1440),minute=total%1440;
  if(c.type==='gregorian'){const x=new Date(utc(1,1,1).getTime()+absolute*86400000);return calendarDate(c,x.getUTCFullYear(),x.getUTCMonth()+1,x.getUTCDate(),minute);}
  if(c.type==='relative')return calendarDate(c,1,1,absolute+1,minute);
  const length=c.months.reduce((a,b)=>a+b,0);let remain=absolute%length,month=1;while(remain>=c.months[month-1])remain-=c.months[month++-1];return calendarDate(c,Math.floor(absolute/length)+1,month,remain+1,minute);
}
