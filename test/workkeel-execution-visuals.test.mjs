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
import vm from 'node:vm';
import {workspaceClient} from '../src/workkeel-workspace-ui.mjs';
import {renderWorkspaceScene,renderWorkspaceMap} from '../src/workkeel-workspace-scene.mjs';
import {resolveToolIdentity,toolMark} from '../src/workkeel-tool-identity.mjs';
import {createHash} from 'node:crypto';
import {buildExecutionVisual,taskVisualRows,renderExecutionVisual,renderExecutionTimeline,dependencyLayout,renderDependencyDiagram,renderActivityComparison} from '../src/workkeel-execution-visuals.mjs';

const now=Date.parse('2026-01-01T00:02:00Z');
test('autonomy guidance follows usable standing authority without changing settings task gates',()=>{
  // Run the emitted client's real notice, goal selection and permission helpers.
  const block=(start,end)=>{const from=workspaceClient.indexOf(start),to=workspaceClient.indexOf(end,from);assert.ok(from>=0&&to>from);return workspaceClient.slice(from,to);};
  const code=block('const may=','const modelRules=')+block('function selectedImprovementGoal(','function autonomyJourney(')+'\n({html:operatorContext(),save:may("autonomy.policy"),start:may("autonomy.start-service"),settings:may("policy.update"),learning:may("learning.activate"),storage:may("retention.archive")});';
  const goal={id:'approved-goal',authority_current:true,grant:{enabled:true}};
  const actions=['autonomy.policy','autonomy.start-service','policy.update','learning.activate','retention.archive'];
  const base={snapshot:{projects:[{id:'project',read_status:'available'}],capabilities:{actions}},connected:true,writeToken:'operator',improvementGoal:'approved-goal',hookData:{operator:{ready:false,reason_code:'no-task',tasks:[],selected_task_id:null},available_goals:[goal]}};
  const render=({view='autonomy',lang='en',...overrides}={})=>vm.runInNewContext(code,{...base,...overrides,route:()=>({view,project:'project'}),t:(en,zh)=>lang==='zh-TW'?zh:en,escape:value=>String(value??'')});
  for(const lang of ['en','zh-TW']){
    const result=render({lang});
    assert.match(result.html,/approved goal|核准目標/);
    assert.doesNotMatch(result.html,/settings task|設定任務|operator-task/);
    assert.equal(result.save,true);assert.equal(result.start,true);
    assert.equal(result.settings,false);assert.equal(result.learning,false);assert.equal(result.storage,false);
    for(const view of ['settings','learning','storage'])assert.match(render({view,lang}).html,/settings task|設定任務/,'standing authority does not replace another settings page’s task');
    const readOnly=render({lang,writeToken:'',hookData:{...base.hookData,operator:{...base.hookData.operator,reason_code:'view-only'}}});
    assert.match(readOnly.html,/operator connection|操作連線/);assert.equal(readOnly.save,false);assert.equal(readOnly.start,false);
    for(const available_goals of [[],[{...goal,authority_current:false}],[{...goal,grant:{enabled:false}}]]){
      const missing=render({lang,hookData:{...base.hookData,available_goals}});
      assert.match(missing.html,/settings task|設定任務/);
      assert.doesNotMatch(missing.html,/approved goal|核准目標/);
      if(!available_goals[0]?.authority_current)assert.equal(missing.save,false,'missing standing authority still needs task authorization');
    }
  }
  for(const overrides of [{connected:false},{writeToken:''},{snapshot:{...base.snapshot,capabilities:{actions:[]}}},{snapshot:{...base.snapshot,projects:[{id:'project',read_status:'unavailable'}]}}]){
    const unavailable=render(overrides);assert.doesNotMatch(unavailable.html,/approved goal/);assert.equal(unavailable.save,false);assert.equal(unavailable.start,false);
  }
  const startOnly=render({snapshot:{...base.snapshot,capabilities:{actions:['autonomy.start-service']}}});
  assert.match(startOnly.html,/approved goal/);assert.equal(startOnly.save,false);assert.equal(startOnly.start,true);
  const policySelected=render({improvementGoal:'',hookData:{...base.hookData,policy:{admission:{goal_id:goal.id}}}});
  assert.match(policySelected.html,/approved goal/,'the recorded policy can select the standing goal');
  for(const reason_code of ['choose-task','task-unavailable','authority-unavailable']){
    const operator={...base.hookData.operator,reason_code};
    assert.match(render({hookData:{...base.hookData,operator}}).html,/approved goal/,'an unrelated settings task problem does not invalidate standing authority');
    const invalid=render({hookData:{...base.hookData,operator,available_goals:[{...goal,authority_current:false}]}});
    assert.doesNotMatch(invalid.html,/approved goal/);assert.match(invalid.html,/task|settings/);assert.equal(invalid.save,false);
  }
  const task={id:'settings-task',title:'Approved settings'};
  const selected=render({view:'settings',hookData:{...base.hookData,operator:{ready:true,tasks:[task],selected_task_id:task.id}}});
  assert.match(selected.html,/operator-task-disclosure/);assert.match(selected.html,/Approved settings/);
  assert.equal(selected.settings,true);assert.equal(selected.learning,true);assert.equal(selected.storage,true);
});
test('paused autonomy guidance follows Resume capability in both languages without hiding policy or history',()=>{
  // Render the actual emitted view, journey and permission helper without connecting or writing.
  const block=(start,end)=>{const from=workspaceClient.indexOf(start),to=workspaceClient.indexOf(end,from);assert.ok(from>=0&&to>from);return workspaceClient.slice(from,to);};
  const code=block('const t=','const states=')+block('const activityLabel=','const measuredTokens=')+block('const may=','function operatorContext(')+block('function selectedImprovementGoal(','function commandFeedback(')+'\nautonomyView("project");';
  const goal={id:'approved-goal',title:'Approved improvement',authority_current:true,grant:{enabled:true}};
  const accepted={id:'accepted-work',title:'Accepted work',root:'/fictional/accepted',project_id:'project',read_status:'available',state:'done',accepted:true,created_at:'2026-01-02T00:00:00Z'};
  const historical={id:'historical-work',title:'Historical work',root:'/fictional/historical',project_id:'project',read_status:'available',state:'review-required',historically_accepted:true,accepted:false,created_at:'2026-01-01T00:00:00Z'};
  const base={connected:true,writeToken:'operator',improvementGoal:goal.id,connectionError:null,
    snapshot:{projects:[{id:'project',name:'Example project',read_status:'available'}],goals:[accepted,historical],capabilities:{actions:['autonomy.policy','autonomy.resume']}},
    hookData:{enabled:true,paused:true,available_goals:[goal],policy:{admission:{enabled:true}},
      admissions:[accepted,historical].map(item=>({goal_id:item.id,root:item.root,kind:'execution',status:'created'})),
      jobs:[{id:'old-failure',reason:'Retained synthetic failure',status:'failed'}]}};
  const render=(lang,overrides={})=>vm.runInNewContext(code,{...base,...overrides,lang,document:{hidden:false},
    route:()=>({view:'autonomy',project:'project'}),escape:value=>String(value??''),
    link:(view,project,task)=>'?'+new URLSearchParams({view,project,...(task?{task}:{})}),renderWorkspaceScene,toolMark,resolveToolIdentity});
  for(const lang of ['en','zh-TW']){
    const zh=lang==='zh-TW',html=render(lang);
    const resumeLabel=zh?'恢復新的執行':'Resume new execution';
    const unavailable=zh?'此連線無法恢復執行。':'This connection cannot resume execution.';
    const checkConnection=zh?'請與 Agent 核對執行連線。':'Ask your Agent to check the execution connection.';
    const summary=html.match(/<div class="autonomy-now">[\s\S]*?<div class="journey-controls">/)[0];
    const next=html.match(/<div class="autonomy-next">[\s\S]*?<\/div>/)[0];
    assert.match(html,/data-autonomy-state="paused"/);
    assert.ok(summary.includes(resumeLabel));assert.ok(next.includes(resumeLabel));
    assert.equal((html.match(/data-control="autonomy.resume"/g)||[]).length,1);
    assert.ok(html.includes('data-control="autonomy.resume">'+resumeLabel+'</button>'));
    assert.ok(!html.includes(unavailable));assert.ok(!html.includes(checkConnection));
    const cases=[
      {actions:[],policy:false},
      {actions:['autonomy.policy'],policy:true},
      {actions:['autonomy.policy','autonomy.start-service'],policy:true},
      {actions:['autonomy.policy','autonomy.resume'],writeToken:'',policy:false},
      {actions:['autonomy.policy','autonomy.resume'],read_status:'unavailable',policy:false}
    ];
    for(const {actions,policy,writeToken=base.writeToken,read_status='available'} of cases){
      const result=render(lang,{writeToken,snapshot:{...base.snapshot,capabilities:{actions},projects:[{...base.snapshot.projects[0],read_status}]}});
      assert.match(result,/data-autonomy-state="paused"/);
      assert.ok(result.includes(unavailable));assert.ok(result.includes(checkConnection));
      assert.doesNotMatch(result,/data-control="autonomy\.(resume|start-service|pause)"/);
      assert.equal(result.includes('data-autonomy-end'),policy,'policy-only controls remain usable without execution capability');
      assert.ok(result.includes(zh?'既有工作仍保留在下方。':'Existing work remains visible below.'));
      assert.doesNotMatch(result,/Resume when|恢復後才會|再選擇恢復|adapter|expired approval|授權過期/);
      assert.match(result,/id="autonomy-history"/);assert.match(result,/id="autonomy-settings"/);
      assert.match(result,/view=work/);assert.match(result,/view=learning/);
      assert.ok(result.includes(zh?'先前已驗收・目前待重新確認':'Previously accepted · needs recheck'));
      assert.ok(result.includes(zh?'改善已驗收':'Improvement accepted'));
      assert.match(result,/Retained synthetic failure/);assert.ok(result.includes(zh?'已失敗':'Failed'));
      assert.match(result,/<strong>1<\/strong><span>(Currently accepted improvements|目前驗收有效的改善)/);
    }
    const blocked=render(lang,{hookData:{...base.hookData,service:{errors:['Recorded service problem']}}});
    assert.match(blocked,/data-autonomy-state="blocked"/);assert.match(blocked,/Recorded service problem/);
    assert.ok(!blocked.includes(unavailable));assert.ok(!blocked.includes(checkConnection));
    const disconnected=render(lang,{connected:false});
    assert.match(disconnected,/data-autonomy-state="unavailable"/);assert.doesNotMatch(disconnected,/data-control=/);
  }
});
test('task dependency navigation preserves project-local identity and leaves missing tasks unlinked',()=>{
  // Execute the emitted client's actual helpers and task renderer without booting its host connection.
  const block=(start,end)=>{const from=workspaceClient.indexOf(start),to=workspaceClient.indexOf(end,from);assert.ok(from>=0&&to>from);return workspaceClient.slice(from,to);};
  const code=block('const t=','const listViews=')+block('const taskName=','function heading(')+block('function taskDependencyComponents(','function projectPicker(')+'\ntaskView("alpha","WK-same");';
  const task=(project_id,dependencies=[])=>({key:project_id+':WK-same',id:'WK-same',project_id,dependencies,task_state:'build',read_status:'available'});
  const snapshot={tasks:[task('alpha')],projects:['alpha','beta'].map(id=>({id,task_root:'/'+id,repositories:[{id:id+'-repo',path:'/'+id,scope:'.'}]}))};
  const render=()=>vm.runInNewContext(code,{snapshot,renderWorkspaceMap,URLSearchParams,lang:'en',tab:'dependencies',escape:value=>String(value??''),heading:()=>'',taskNext:()=>''});
  const single=render();
  assert.match(single,/single-component/);
  assert.match(single,/href="\?view=task&amp;project=alpha&amp;task=WK-same"/);
  snapshot.tasks=[task('alpha',['beta:WK-same','missing:WK-lost']),task('beta')];
  const multi=render();
  assert.match(multi,/href="\?view=task&amp;project=alpha&amp;task=WK-same"/);
  assert.match(multi,/href="\?view=task&amp;project=beta&amp;task=WK-same"/);
  assert.match(multi,/missing:WK-lost/);
  assert.equal((multi.match(/<a href=/g)||[]).length,2,'only the two resolved tasks are navigation targets');
});
test('product landscape preserves invalid dependencies, safe links and component-only acceptance',()=>{
  assert.match(renderWorkspaceScene([]),/scene-empty/);assert.doesNotMatch(renderWorkspaceScene([]),/scene-composition/);
  const single=renderWorkspaceMap([{id:'one',repo_id:'repo',accepted:true}],{href:()=>'?view=task&task=one'});
  assert.match(single,/single-component/);assert.match(single,/Whole-goal acceptance is separate/);assert.match(single,/href="\?view=task/);
  for(const depends_on of [['one'],['missing']]){const invalid=renderWorkspaceMap([{id:'one',depends_on}]);assert.match(invalid,/Dependencies need reconciliation/);assert.doesNotMatch(invalid,/constellation-edge|single-component/);}
  const multi=renderWorkspaceMap([{id:'<source>',accepted:true},{id:'consumer',depends_on:['<source>']}],{href:()=> 'javascript:alert(1)'});
  assert.match(multi,/constellation-edge accepted/);assert.match(multi,/&lt;source&gt;/);assert.doesNotMatch(multi,/javascript:|<source>/);assert.match(multi,/1 \/ 2/);
  assert.match(renderWorkspaceMap([]),/No required components recorded/);
});
const row=(activity,extra={})=>({activity_kind:activity,state:'completed',actor:{agent_id:'builder',principal_id:'owner'},reported:{model:'actual-model'},start_at:'2026-01-01T00:00:00Z',end_at:'2026-01-01T00:00:10Z',tokens:0,tokens_complete:true,time_complete:true,...extra});
test('compact scenes keep empty evidence distinct from unknown and recorded zero tokens',()=>{
  for(const [language,message]of [['en','Waiting for execution evidence'],['zh-TW','等待執行證據']]){
    const empty=renderWorkspaceScene([],{language});
    assert.match(empty,/scene-empty/);assert.ok(empty.includes(message));
    assert.doesNotMatch(empty,/scene-composition|scene-current-metrics|data-flow-node|aria-current="step"/);
  }
  const unknown=renderWorkspaceScene([row('implementation',{tokens:null,tokens_complete:false})]);
  assert.match(unknown,/Tokens not reported/);
  assert.doesNotMatch(unknown,/aria-label="0 tokens"|aria-current="step"/);
  assert.match(renderWorkspaceScene([row('implementation')]),/0 tokens/);
  assert.match(renderWorkspaceScene([row('implementation',{tokens:3,tokens_complete:false})]),/≥ 3 tokens/);
});
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
test('a dispatched goal review awaits its report instead of returning to the queue',()=>{
  const rows=[row('review',{state:'running',actor:null,requested_actor:{agent_id:'reviewer<&'},reported:{model:null},end_at:null,last_observed_at:null,tokens:null,tokens_complete:false,time_complete:false})],options={now,pending_activities:['independent-review']};
  const visual=buildExecutionVisual(rows,options),node=visual.nodes[3];assert.equal(node.state,'stale');assert.equal(visual.current_activity,null);assert.deepEqual(node.actors,[]);assert.equal(node.assigned_actor,'reviewer<&');assert.equal(node.ms,null);assert.equal(node.tokens,null);
  const html=renderWorkspaceScene(rows,options);assert.match(html,/Awaiting a fresh report/);assert.match(html,/Assigned: reviewer&lt;&amp;/);assert.doesNotMatch(html,/CURRENT ACTIVITY|Agent not reported/);
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
test('official product marks follow observed tools, never model or Agent guesses',()=>{
  for(const [tool,digest]of [['codex','1ecca96720bcb54a6ddb2d4f0604731f9e1633ef9da4d0f8c535d508b207a34a'],['claude-code','7241633e5a39b44a947c7b9a821637f30d6e86716e7a8c847136d91f9c3f6ba1']]){
    const identity=resolveToolIdentity({tool});
    assert.equal(identity.known,true);
    assert.equal(createHash('sha256').update(Buffer.from(identity.asset.split(',')[1],'base64')).digest('hex'),digest);
    assert.match(toolMark(identity),/data-official-tool/);
  }
  for(const record of [{model:'claude-opus',actor:{agent_id:'claude-code'}},{provider:'openai',selected:{model:'codex'}},{tool:'a-new-tool'}]){
    assert.equal(resolveToolIdentity(record).asset,null);
  }
  assert.doesNotMatch(toolMark(resolveToolIdentity({tool:'<script>alert(1)</script>'})),/<script>/);
  const scene=renderWorkspaceScene([row('implementation',{tool:'codex'}),row('implementation',{tool:'claude-code'})]);
  assert.match(scene,/Multiple executors/);assert.doesNotMatch(scene,/data-official-tool/);
});
test('signal scene relates work to recorded activities without inventing handoffs or motion',()=>{
  const first=row('planning',{tool:'claude-code'}),last=row('repair',{tool:'codex',start_at:'2026-01-01T00:00:20Z',end_at:'2026-01-01T00:00:25Z'});
  const linked=renderWorkspaceScene([first,last]);assert.equal((linked.match(/class="signal-wire"/g)||[]).length,2);assert.match(linked,/No records:/);assert.doesNotMatch(linked,/class="signal-packet"/);assert.match(linked,/not handoffs between agents/);
  const overlapping=renderWorkspaceScene([first,{...last,start_at:'2026-01-01T00:00:05Z'}]);assert.doesNotMatch(overlapping,/class="scene-connector"/);
  const unknown=renderWorkspaceScene([{...first,start_at:null},last]);assert.doesNotMatch(unknown,/class="scene-connector"/);
  const queued=renderWorkspaceScene([first],{pending_activities:['independent-review']});assert.match(queued,/data-state="queued"/);assert.doesNotMatch(queued,/class="signal-packet"/);
});
test('signal packets require effective live status and stop at the observation boundary',()=>{
 const observed='2026-01-01T00:01:00.001Z',rows=['implementation','verification'].map(activity=>row(activity,{state:'running',end_at:null,last_observed_at:observed,tool:'codex'}));
 const count=options=>(renderWorkspaceScene(rows,{now,...options}).match(/class="signal-packet"/g)||[]).length;
 assert.equal(count({}),2);assert.equal(count({connected:false}),0);assert.equal(count({now:Date.parse(observed)+60000}),0);assert.equal(count({read_status:'stale'}),0);assert.equal(count({blocked_activities:['verification']}),1);
 assert.doesNotMatch(renderWorkspaceScene([row('review',{state:'running',last_observed_at:observed})],{now,review_judgment:'fail'}),/class="signal-packet"/);
 assert.doesNotMatch(renderWorkspaceScene(rows.map(r=>({...r,running_eligible:false})),{now}),/class="signal-packet"/);
 assert.doesNotMatch(renderWorkspaceScene(rows.map(r=>({...r,read_status:'stale'})),{now}),/class="signal-packet"/);
 const readOnly=renderWorkspaceScene(rows,{now,interactive:false,title:'<work>'});assert.match(readOnly,/&lt;work&gt;/);assert.doesNotMatch(readOnly,/data-flow-node|<button/);
});
test('task and goal scene options keep paused or recovery work static despite a fresh heartbeat',()=>{
 const code=workspaceClient.slice(workspaceClient.indexOf('function visualOptions('),workspaceClient.indexOf('function activityDetails('));
 const options=entity=>vm.runInNewContext(code+';visualOptions(entity)',{entity,lang:'en',connected:true,document:{hidden:false},activityOf:row=>row.activity_kind});
 const fresh=[row('implementation',{state:'running',last_observed_at:new Date(now).toISOString()})];
 for(const state of ['paused','blocked','done','cancelled','review-required'])for(const entity of [{task_state:state},{state,mandatory_components:[]}])assert.doesNotMatch(renderWorkspaceScene(fresh,{...options(entity),now}),/class="signal-packet"/);
 assert.doesNotMatch(renderWorkspaceScene(fresh,{...options({state:'running',requires_recovery:true}),now}),/class="signal-packet"/);
 assert.match(renderWorkspaceScene(fresh,{...options({state:'running'}),now}),/class="signal-packet"/);
});
