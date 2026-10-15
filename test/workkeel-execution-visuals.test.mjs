import test from 'node:test';

test('reviews retain component-specific verdicts without promoting one pass to whole-goal success',()=>{
  const review=(component,judgment,at)=>({component_id:component,activity_kind:'review',state:'completed',review_judgment:judgment,start_at:at});
  let rows=[review('first','fail','2026-01-01T00:00:00Z'),review('second','pass','2026-01-01T00:01:00Z')];
  assert.equal(buildExecutionVisual(rows,{review_judgments:['fail','pass']}).nodes[3].state,'failed');
  rows.push(review('first','pass','2026-01-01T00:02:00Z'));
  assert.equal(buildExecutionVisual(rows,{review_judgments:['pass','pass']}).nodes[3].state,'review-passed');
  assert.equal(buildExecutionVisual(rows,{review_judgments:['pass',null]}).nodes[3].state,'completed');
  assert.equal(buildExecutionVisual([{...rows[0],activity_kind:'implementation'}]).nodes[1].state,'completed','only actual review verdicts affect the review node');
});
import assert from 'node:assert/strict';
import {buildExecutionVisual,taskVisualRows,renderExecutionVisual,renderExecutionTimeline,dependencyLayout,renderDependencyDiagram,renderActivityComparison} from '../src/workkeel-execution-visuals.mjs';

const now=Date.parse('2026-01-01T00:02:00Z');
const row=(activity,extra={})=>({activity_kind:activity,state:'completed',actor:{agent_id:'builder',principal_id:'owner'},reported:{model:'actual-model'},start_at:'2026-01-01T00:00:00Z',end_at:'2026-01-01T00:00:10Z',tokens:0,tokens_complete:true,time_complete:true,...extra});
test('missing work, explicit zero and selected-only models remain distinct',()=>{
  const rows=[row('implementation',{reported:{model:null},selected:{model:'selected-only'},model:'unreported'}),row('verification',{tokens:null,tokens_complete:false,start_at:null,end_at:null,time_complete:false})];
  const result=buildExecutionVisual(rows),build=result.nodes[1],verify=result.nodes[2];
  assert.equal(build.ms,10000);assert.equal(build.tokens,0);assert.equal(build.tokens_complete,true);assert.deepEqual(build.models,[]);assert.equal(build.selected_model,'selected-only');
  assert.equal(verify.ms,null);assert.equal(verify.tokens,null);assert.equal(result.nodes[0].state,'unreported');assert.equal(result.nodes[3].state,'unreported');
  const html=renderExecutionVisual(rows);assert.match(html,/Selected: selected-only/);assert.match(html,/0 tokens/);assert.match(html,/Tokens unknown/);assert.doesNotMatch(html,/aria-current="step"/);
});
test('running indication requires an available fresh host observation and expires exactly',()=>{
  const rows=[row('review',{state:'running',last_observed_at:'2026-01-01T00:01:00.001Z',end_at:null,tokens_complete:false})];
  assert.equal(buildExecutionVisual(rows,{now}).current_activity,'independent-review');
  assert.equal(buildExecutionVisual(rows,{now:now+1}).current_activity,null);
  assert.equal(buildExecutionVisual(rows,{now,connected:false}).current_activity,null);
  assert.equal(buildExecutionVisual(rows,{now,read_status:'stale'}).current_activity,null);
  assert.equal(buildExecutionVisual([row('planning',{state:'running',last_observed_at:null})],{now}).nodes[0].state,'stale');
  for(const extra of [{collection_closed:true},{runner_state:'paused'},{observations:{error_code:'host-disconnected'}}]){const recorded=taskVisualRows({runs:[{run_id:'interrupted',runner_state:'running',last_observed_at:'2026-01-01T00:01:10Z',operations:[{operation_id:'live',activity_kind:'repair',state:'running',result_recorded:false}],...extra}]});assert.equal(buildExecutionVisual(recorded,{now}).current_activity,null,'closed, paused and failed observations cannot mark work live');}
});
test('parallel intervals count once while executor lanes retain overlap and repeated repairs',()=>{
  const rows=[row('implementation'),row('implementation',{actor:{agent_id:'second',principal_id:'owner'},start_at:'2026-01-01T00:00:05Z',end_at:'2026-01-01T00:00:15Z'}),row('repair',{start_at:'2026-01-01T00:00:20Z',end_at:'2026-01-01T00:00:25Z'}),row('repair',{start_at:'2026-01-01T00:00:30Z',end_at:'2026-01-01T00:00:35Z'})];
  const result=buildExecutionVisual(rows);assert.equal(result.nodes[1].ms,15000);assert.equal(result.ms,25000);assert.equal(result.nodes[4].attempts,2);assert.deepEqual(result.nodes[1].actors,['builder','second']);
  const html=renderExecutionTimeline(rows);assert.match(html,/builder/);assert.match(html,/second/);assert.equal((html.match(/class="ev-interval"/g)||[]).length,4);assert.equal((html.match(/class="ev-bar"/g)||[]).length,4);
});
test('canonical review and pending component phases inform status without inventing execution or usage',()=>{
  let result=buildExecutionVisual([],{review_judgment:'fail',pending_activities:['repair']});
  assert.equal(result.nodes[3].state,'failed');assert.equal(result.nodes[4].state,'queued');assert.equal(result.nodes[3].ms,null);assert.equal(result.nodes[3].tokens,null);assert.deepEqual(result.nodes[3].actors,[]);
  result=buildExecutionVisual([],{review_judgment:'pass',blocked_activities:['verification']});assert.equal(result.nodes[3].state,'review-passed');assert.equal(result.nodes[2].state,'blocked');
  assert.equal(buildExecutionVisual([],{review_judgment:'invented'}).nodes[3].state,'unreported');
});
test('unrelated undated rows cannot invert known chronology and conflicting undated outcomes remain ambiguous',()=>{
  const newer=row('implementation',{start_at:'2026-01-01T00:00:10Z',state:'completed'}),older=row('implementation',{start_at:'2026-01-01T00:00:05Z',state:'failed'}),undated=row('planning',{start_at:null,end_at:null});
  for(const rows of [[newer,undated,older],[undated,older,newer],[older,newer,undated],[newer,older,undated]]){const visual=buildExecutionVisual(rows);assert.equal(visual.nodes[1].state,'completed');assert.deepEqual(visual.nodes[1].items.map(item=>item.state),['failed','completed']);assert.equal(visual.chronology_complete,false);assert.equal(visual.recent_activity,null);}
  const mixed=[newer,row('implementation',{start_at:null,end_at:null,state:'failed'})],ambiguous=buildExecutionVisual(mixed);assert.equal(ambiguous.nodes[1].state,'unconfirmed');assert.equal(ambiguous.nodes[1].ordering_ambiguous,true);assert.match(renderExecutionVisual(mixed),/Activity order partly unknown/);
});
test('task rows preserve provenance, operation identity and unknown timing without charging cached input twice',()=>{
  const op={operation_id:'op',activity_kind:'implementation',selected_model:'chosen',runtime_model:'observed',result_recorded:true,adapter_elapsed_ms:0,usage:{input_tokens:10,output_tokens:5,cached_input_tokens:8}};
  const rows=taskVisualRows({runs:[{run_id:'run',actor:{agent_id:'one',principal_id:'owner'},operations:[op,op]}]});
  assert.equal(rows.length,1);assert.equal(rows[0].reported.model,'observed');assert.equal(rows[0].selected.model,'chosen');assert.equal(rows[0].tokens,15);assert.equal(rows[0].ms,0);assert.equal(rows[0].time_complete,true);
  const unknown=taskVisualRows({runs:[{run_id:'unknown',operations:[{operation_id:'unknown',activity_kind:'planning',result_recorded:false,usage:{input_tokens:0}}]}]})[0];assert.equal(unknown.tokens,0);assert.equal(unknown.tokens_complete,false);assert.equal(unknown.ms,null);assert.equal(unknown.actor,null);
});
test('full component set keeps equal root-local task names distinct and records invalid relationships',()=>{
  const components=[{id:'api',repo_id:'api-repo',task_id:'WK-same',accepted:true,depends_on:[]},{id:'library',repo_id:'library-repo',task_id:'WK-same',accepted:false,state:'blocked',depends_on:[]},{id:'integration',repo_id:'integration-repo',accepted:false,state:'waiting',depends_on:['api','library']}];
  const layout=dependencyLayout(components);assert.equal(layout.nodes.length,3);assert.equal(layout.edges.length,2);assert.deepEqual(layout.problems,[]);assert.ok(layout.nodes[2].x>layout.nodes[0].x);
  const html=renderDependencyDiagram(components);assert.match(html,/3 mandatory components/);assert.match(html,/api-repo/);assert.match(html,/library-repo/);assert.match(html,/integration-repo/);assert.match(html,/blocking|blocked/);assert.match(html,/integration evidence/);
  assert.ok(dependencyLayout([{id:'a',depends_on:['b']},{id:'b',depends_on:['a']}]).problems.includes('cyclic-dependency'));
  assert.ok(dependencyLayout([{id:'a',depends_on:['missing']}]).problems.includes('missing-component'));
  assert.ok(dependencyLayout([{id:'a'},{id:'a'}]).problems.includes('duplicate-component-id'));
});
test('untrusted model, Agent and component text cannot introduce HTML or SVG execution',()=>{
  const attack='</text><script>alert(1)</script><img src=x onerror=alert(1)>';
  for(const html of [renderExecutionVisual([row('implementation',{reported:{model:attack}})]),renderExecutionTimeline([row('implementation',{actor:{agent_id:attack}})]),renderDependencyDiagram([{id:attack,repo_id:attack,depends_on:[]}])]){assert.doesNotMatch(html,/<script|<img/);assert.match(html,/&lt;/);}
});
test('comparison charts preserve zero and unknown, escape prototype names and disclose incomplete totals',()=>{
  const groups=[{id:'constructor',ms:null,tokens:null},{id:'implementation',ms:0,tokens:0,time_complete:true,tokens_complete:true},{id:'review',ms:1000,tokens:3,time_complete:false,tokens_complete:false}];
  const time=renderActivityComparison(groups),tokens=renderActivityComparison(groups,{metric:'tokens'});
  assert.match(time,/constructor/);assert.doesNotMatch(time,/function Object|\[object/);assert.match(time,/0 ms/);assert.match(tokens,/0 tokens/);assert.match(tokens,/≥ 3 tokens/);
  assert.doesNotMatch(renderExecutionTimeline([row('implementation',{start_at:null,end_at:null})]),/>0 s<\/text>/);
  assert.throws(()=>buildExecutionVisual(Array(1)),/explicit operation/);
  assert.doesNotMatch(renderDependencyDiagram([{id:'truthy',accepted:'false',state:'blocked'}]),/>Accepted<\/text>/);
});
