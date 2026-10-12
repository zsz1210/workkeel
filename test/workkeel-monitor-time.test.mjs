import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDate,resolveTimeZone,validTimeZone,zoneLabel} from '../src/workkeel-monitor-time.mjs';
import {trendRows,filterRows} from '../src/workkeel-monitor-analytics.mjs';
const row=(date,tokens=10)=>({date,tokens,ms:500,time_complete:true,tokens_complete:true,journal_complete:true});
test('timezone changes calendar grouping but never duration or token totals',()=>{
  const rows=[row('2026-09-27T23:30:00Z'),row('2026-09-28T01:00:00Z')];
  assert.deepEqual(trendRows(rows,'day','UTC').map(x=>x.id),['2026-09-27','2026-09-28']);
  const tokyo=trendRows(rows,'day','Asia/Tokyo');assert.equal(tokyo.length,1);assert.equal(tokyo[0].id,'2026-09-28');assert.equal(tokyo[0].tokens,20);assert.equal(tokyo[0].ms,1000);
  assert.deepEqual(trendRows(rows,'week','America/Los_Angeles').map(x=>x.id),['2026-09-21']);
  assert.deepEqual(trendRows(rows,'week','Asia/Tokyo').map(x=>x.id),['2026-09-28']);
});
test('calendar filters handle DST transitions and include today, not rolling hours',()=>{
  const rows=[row('2026-03-08T04:59:59Z'),row('2026-03-08T05:00:00Z'),row('2026-03-09T03:30:00Z'),row('2026-03-09T04:00:00Z')];
  const filtered=filterRows(rows,{days:1,timeZone:'America/New_York',now:Date.parse('2026-03-09T03:59:59Z')});
  assert.deepEqual(filtered.map(x=>x.date),[rows[1].date,rows[2].date]);
  assert.equal(calendarDate('2026-11-01T05:30:00Z','America/New_York'),calendarDate('2026-11-01T06:30:00Z','America/New_York'));
  assert.match(zoneLabel('America/New_York',new Date('2026-03-08T06:30:00Z')),/UTC-05:00/);
  assert.match(zoneLabel('America/New_York',new Date('2026-03-08T07:30:00Z')),/UTC-04:00/);
  assert.equal(validTimeZone('bad/zone'),false);assert.equal(resolveTimeZone('bad/zone'),resolveTimeZone());assert.equal(calendarDate('bad','UTC'),null);
});
