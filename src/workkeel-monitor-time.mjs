const formatters=new Map();
export function validTimeZone(zone) {
  if(typeof zone!=='string'||zone.length>100)return false;
  try{new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}
}
export function resolveTimeZone(preference='system') {
  return preference!=='system'&&validTimeZone(preference)?preference:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
}
export function calendarDate(value,timeZone='UTC') {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
  if(!formatters.has(timeZone)){
    if(formatters.size>=64)formatters.clear();
    formatters.set(timeZone,new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}));
  }
  const parts=Object.fromEntries(formatters.get(timeZone).formatToParts(date).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
export function calendarOffset(day,offset) {
  const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}
export function zoneLabel(timeZone,at=new Date()) {
  const offset=new Intl.DateTimeFormat('en',{timeZone,timeZoneName:'longOffset'}).formatToParts(at).find(p=>p.type==='timeZoneName').value.replace('GMT','UTC');
  return timeZone+' · '+offset;
}
