import type {GameDate} from './types';
import {calendarDate,advanceCalendar,defaultCalendar} from '../scenario/calendar';
import type {CalendarDefinition} from '../scenario/schema';
export function gameDate(year:number,month:number,day:number,minuteOfDay=0,c:CalendarDefinition=defaultCalendar){return calendarDate(c,year,month,day,minuteOfDay);}
export function advanceDate(d:GameDate,minutes:number,c:CalendarDefinition=defaultCalendar){return advanceCalendar(d,minutes,c);}
export function dateLabel(d:GameDate){return d.display||d.year+'年 · '+d.month+'月'+d.day+'日 · '+d.period;}
export function dayKey(value:string,c:CalendarDefinition=defaultCalendar):number|undefined{if(!value)return undefined;const match=/^(\d+)-(\d{1,2})-(\d{1,6})$/.exec(value);if(!match)throw new Error('游戏日期格式为 年-月-日');return calendarDate(c,Number(match[1]),Number(match[2]),Number(match[3])).absoluteDay;}
