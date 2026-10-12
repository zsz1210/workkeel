import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeUsageScope} from '../src/workkeel-host-usage.mjs';
import {operationRows,aggregateRows} from '../src/workkeel-monitor-analytics.mjs';
const fixture=()=>({source:{kind:'codex-rollout'},source_status:'observed',turn_started_at:'2026-01-01T00:00:00Z',turn_ended_at:'2026-01-01T00:01:00Z',turn_terminal:'completed',created_at:'2026-01-01T00:00:20Z',claim_at:'2026-01-01T00:00:10Z',capture_turn_from_start:false,unassigned_responses:1,usage:{input_tokens:40,output_tokens:10,cached_input_tokens:30},last_cumulative:{input_tokens:100,output_tokens:20,cached_input_tokens:70}});
test('turn reference keeps recorded usage separate, preserving excluded zero and missing fields',()=>{
 const b=fixture(),before=structuredClone(b),scope=nativeUsageScope(b);
 assert.equal(scope.basis,'after-attachment');assert.equal(scope.task_coverage_complete,false);
 assert.equal(scope.turn_reference.usage.total_tokens,120);assert.equal(scope.turn_reference.outside_operation_usage.total_tokens,70);
 assert.equal(scope.turn_reference.outside_operation_usage.cached_input_tokens,40);assert.equal(scope.turn_reference.outside_operation_usage.reasoning_output_tokens,null);
 assert.deepEqual(b,before);b.usage={...b.last_cumulative};assert.equal(nativeUsageScope(b).turn_reference.outside_operation_usage.total_tokens,0);
  b.last_cumulative.input_tokens=0;assert.equal(nativeUsageScope(b).turn_reference.outside_operation_usage.input_tokens,null);
  b.last_cumulative.output_tokens=1000;assert.equal(nativeUsageScope(b).turn_reference.outside_operation_usage.total_tokens,null);
});
test('source health, absent metadata, pending and closed remain distinct',()=>{
 for(const status of ['unavailable','partial-source']){const b=fixture();b.source_status=status;const r=nativeUsageScope(b).turn_reference;assert.equal(r.status,'unavailable');assert.equal(r.usage.total_tokens,null);assert.equal(r.outside_operation_usage.total_tokens,null)}
 const b=fixture();b.turn_terminal=null;assert.equal(nativeUsageScope(b).turn_reference.status,'pending');b.collection_closed=true;assert.equal(nativeUsageScope(b).turn_reference.status,'stopped');
 b.collection_closed=false;for(const status of ['stopped','cancelled']){b.status=status;assert.equal(nativeUsageScope(b).turn_reference.status,'stopped');}
 b.last_cumulative=null;assert.equal(nativeUsageScope(b).turn_reference.status,'unknown');
 b.source.kind='host-report';assert.equal(nativeUsageScope(b).turn_reference.status,'not-reported');
 const missing=fixture();delete missing.turn_started_at;assert.equal(nativeUsageScope(missing).turn_reference.usage.total_tokens,null);
});
test('unsafe totals and cache counts never produce misleading numeric references',()=>{
 const b=fixture();b.last_cumulative={input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:10,cached_input_tokens:Number.MAX_SAFE_INTEGER+1};const r=nativeUsageScope(b).turn_reference;
 assert.equal(r.usage.total_tokens,null);assert.equal(r.usage.cached_input_tokens,null);
});
test('turn references cannot enter task/model aggregates or multiply on shared references',()=>{
 const b=fixture(),scope=nativeUsageScope(b),operation={operation_id:'one',runtime_model:'model',usage:b.usage,usage_scope:scope};
 const rows=operationRows([{id:'WK-one',runs:[{run_id:'run',operations:[operation,{...operation,operation_id:'two'}]}]}]);
 assert.equal(rows[0].usage_scope.turn_reference.usage.total_tokens,120);
 const total=aggregateRows(rows,'model')[0];assert.equal(total.tokens,100);assert.equal(total.token_breakdown.total,100);assert.equal(total.turn_reference,undefined);
});
