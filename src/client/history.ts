// Match the calendar day shown by the browser, while storing timestamps in UTC.
export function localDateKey(iso:string){
  const date=new Date(iso);
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}
