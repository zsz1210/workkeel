import {resolvePolicySettings, policyDimensions} from './workkeel-model-policy-resolution.mjs';

export const ruleActivities = [
  ['planning', 'Planning', '規劃', 'Clarify the outcome and approach', '釐清目標與執行方式', '◎'],
  ['implementation', 'Implementation', '實作', 'Build the agreed change', '依計畫完成實作', '⌘'],
  ['verification', 'Verification', '驗證', 'Run checks and collect evidence', '執行測試，確認結果', '✓'],
  ['independent-review', 'Independent review', '獨立審查', 'Review with a separate identity', '由獨立身分檢查交付', '◇'],
  ['repair', 'Repair', '修正', 'Resolve findings and verify again', '修正問題並重新驗證', '↻']
];
const dimensions = [['model', 'Model', '模型'], ['reasoning', 'Reasoning', '推理強度'], ['service', 'Service mode', '服務模式']];
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const matches = (rule, selector) => selector.id ? rule.id === selector.id :
  rule.layer === selector.layer && rule.match === selector.match && (rule.task ?? '') === (selector.task ?? '');

/** Only operation timestamps establish chronology; task updates do not. */
export function latestRecordedExecution(entries) {
  if (entries.length < 2) return entries[0] ?? null;
  if (entries.some(entry => !Number.isFinite(entry.row.order_at))) return null;
  const ordered = [...entries].sort((a,b) => b.row.order_at - a.row.order_at);
  return ordered[0].row.order_at === ordered[1].row.order_at ? null : ordered[0];
}

/** Immutable edits preserve opaque catalog metadata and every unrelated rule. */
export function editPolicy(document, selector, settings, allowed, nextVersion) {
  const candidate = structuredClone(document);
  candidate.version = nextVersion;
  candidate.models = candidate.models.filter(model => allowed.includes(model.id));
  if (!candidate.models.length) throw Error('Keep at least one allowed model.');
  for (const setting of Object.values(settings)) {
    if (!['auto', 'inherit', 'fixed'].includes(setting.mode) || setting.mode === 'fixed' && !idPattern.test(setting.value ?? ''))
      throw Error('Choose a supported value for every fixed setting.');
  }
  if (selector.layer === 'project') candidate.project = settings;
  else {
    if (!idPattern.test(selector.match ?? '') || selector.task && !idPattern.test(selector.task)) throw Error('Choose a valid rule context.');
    const existing = candidate.rules.filter(rule => matches(rule, selector));
    if (existing.length > 1) throw Error('Multiple rules use this context. Edit the exact rule under Advanced rules.');
    if (existing.length) existing[0].settings = settings;
    else {
      let index = 1;
      while (candidate.rules.some(rule => rule.id === 'ui-rule-' + index)) index++;
      candidate.rules.push({id:'ui-rule-' + index, layer:selector.layer, match:selector.match,
        ...(selector.task ? {task:selector.task} : {}), settings});
    }
  }
  const ids = new Set(candidate.models.map(model => model.id));
  for (const values of [candidate.project, ...candidate.rules.map(rule => rule.settings)])
    if (values.model?.mode === 'fixed' && !ids.has(values.model.value)) throw Error('A fixed rule uses a disabled model. Change that rule or keep the model enabled.');
  // Test affected inheritance as well as the edited tuple. This catches a parent
  // change that would invalidate a task's independently fixed effort or service.
  const contexts = [{}];
  const activities = [...new Set([...ruleActivities.map(a => a[0]), ...candidate.rules.filter(r => r.layer === 'activity').map(r => r.match)])];
  const tasks = [...new Set(candidate.rules.flatMap(r => r.task ? [r.task] : r.layer === 'task' ? [r.match] : []))];
  for (const activity of activities) {
    contexts.push({activity});
    for (const task of tasks) contexts.push({activity, task});
  }
  for (const rule of candidate.rules) if (['role','node'].includes(rule.layer)) contexts.push({[rule.layer]:rule.match});
  for (const context of contexts) {
    const {requested} = resolvePolicySettings(candidate, context);
    const models = candidate.models.filter(model => requested.model.mode !== 'fixed' || model.id === requested.model.value);
    const compatible = models.some(model =>
      (requested.reasoning.mode !== 'fixed' || !model.reasoning_efforts || model.reasoning_efforts.includes(requested.reasoning.value)) &&
      (requested.service.mode !== 'fixed' || !model.service_tiers || model.service_tiers.includes(requested.service.value)));
    if (!compatible) throw Error('The model, reasoning and service choices are incompatible in ' + (Object.values(context).join(' / ') || 'project defaults') + '. No setting was substituted.');
  }
  return candidate;
}

export function createModelRulesUI(host) {
  const {escape:esc, t, may, send, reload, notice, link, preview, executionRows} = host;
  let current = null, editor = null, taskScope = '', picker = null, saving = false, epoch = 0;
  const el = id => document.getElementById(id);
  const valueLabel = value => value?.mode === 'fixed' ? value.value : value?.mode === 'auto' ? 'Auto' : t('Inherit', '沿用上層');
  const label = layer => ({project:t('Project defaults','專案預設'),activity:t('Activity','活動'),role:t('Role','角色'),task:t('Task','任務'),node:t('Node','節點')}[layer] || layer);
  const button = (text, action, attrs = '') => '<button type="button" data-rule-action="'+action+'" '+attrs+'>'+text+'</button>';
  const editable = () => current?.data?.available && !current.data.setup_reason && may(current.document ? 'policy.draft' : 'policy.save');
  const scopeTasks = () => (current.tasks || []).filter(task => task.project_id === current.project.id && (!task.task_root || task.task_root === current.project.task_root));
  const doc = () => current.document;
  function dismiss() {
    if (el('model-rule-dialog')) { el('model-rule-dialog').close(); el('model-rule-dialog').remove(); }
    const restore = editor?.returnTo; editor = null; epoch++; saving = false;
    document.querySelector(restore || '[data-rule-action="defaults"]')?.focus({preventScroll:true});
  }
  function leave() { dismiss(); picker?.remove(); picker = null; taskScope = ''; current = null; }
  function report(activity) {
    const rows = scopeTasks().filter(task => !taskScope || task.id === taskScope).flatMap(task =>
      executionRows(task).filter(row => row.activity === activity).map(row => ({task, row})));
    const latest = latestRecordedExecution(rows);
    if (rows.length && !latest) return '<p class="small">'+t('Execution reports exist, but their order cannot be confirmed. Open a task for the recorded evidence.','已有執行回報，但無法確認先後順序。請開啟任務查看原始紀錄。')+'</p>';
    return latest ? '<a href="'+link('task',current.project.id,latest.task.id)+'">'+esc(latest.task.id)+'</a><p>'+esc(latest.row.actual_model || t('Model not reported','模型未回報'))+'</p><p class="small">'+t('Execution report; not inferred from this policy.','執行回報，不由目前政策推定。')+'</p>' : '<p class="small">'+t('No execution report for this activity.','此活動尚無執行回報。')+'</p>';
  }
  function ruleRow(activity) {
    const [key,en,zh,descEN,descZH,glyph] = activity;
    let effective, error;
    try { effective = resolvePolicySettings(doc(), {activity:key,...(taskScope ? {task:taskScope} : {})}); } catch(e) { error=e.message; }
    const setting = effective?.requested || {};
    const model = doc().models.find(m => m.id === setting.model?.value);
    return '<article class="mr-activity"><div class="mr-row"><div class="mr-activity-name"><span class="mr-symbol" aria-hidden="true">'+glyph+'</span><div><h3>'+t(en,zh)+'</h3><p>'+t(descEN,descZH)+'</p></div></div><div class="mr-model"><strong>'+esc(error ? t('Needs attention','需要處理') : model?.model || valueLabel(setting.model))+'</strong><span>'+t(setting.model?.mode === 'fixed' ? 'Uses the specified model' : 'Select from qualified models',setting.model?.mode === 'fixed' ? '使用指定模型' : '依任務選擇合格模型')+'</span></div><div class="mr-behavior"><span>'+esc(valueLabel(setting.reasoning))+'</span><i>·</i><span>'+esc(valueLabel(setting.service))+'</span></div>'+button(t('Adjust','調整'),'edit:'+key,'aria-label="'+t('Adjust '+en,'調整'+zh)+'" '+(editable()?'':'disabled'))+'</div>'+(error?'<p class="mr-error">'+esc(error)+'</p>':'')+'<details class="mr-detail"><summary>'+t('Sources & execution report','來源與執行回報')+'</summary><div class="mr-detail-grid"><section><h3>'+t('Rule sources','設定來源')+'</h3><dl>'+dimensions.map(([dim,en,zh])=>'<div><dt>'+t(en,zh)+'</dt><dd>'+esc(valueLabel(setting[dim]))+'<small>'+esc(effective?.sources[dim] || t('Unresolved','尚未解析'))+'</small></dd></div>').join('')+'</dl></section><section><h3>'+t('Latest recorded execution','最近執行回報')+'</h3>'+report(key)+'</section></div></details></article>';
  }
  function render(state) {
    if (current?.project?.id !== state.project?.id) { dismiss(); taskScope = new URLSearchParams(location.search).get('policy_task') || ''; }
    current = {...state, document:state.data?.policy_document};
    const {data,project} = current;
    if (!project) return '<div class="mr-workspace"><h2>'+t('Choose where these rules apply','選擇要設定的專案')+'</h2><p class="muted">'+t('Projects keep separate approved policies. Select a project from the sidebar to view its five work activities.','每個專案保留獨立核准政策。從左側選擇專案，查看五項工作活動。')+'</p><p class="small">'+t('Workspace → project → repositories and tasks','工作空間 → 專案 → Repo 與任務')+'</p></div>';
    if (!data) return '<div class="empty">'+t('Reading model rules…','正在讀取模型規則…')+'</div>';
    if (!data.available) return '<div class="empty">'+esc(data.reason || t('The policy service is unavailable.','模型政策服務無法讀取。'))+'</div>';
    if (!doc()) return '<div class="empty">'+esc(data.setup_reason || t('This host exposes legacy policy controls.','此主機提供舊版政策控制。'))+'</div><p class="small">'+t('Store version ','儲存版本 ')+esc(data.version)+'</p>'+button(t('Open policy controls','開啟政策控制'),'defaults',editable()?'':'disabled');
    const latest=data.entries?.at(-1), active=data.entries?.find(e=>e.policy.version===data.active_version);
    const pending=latest && latest.policy.version !== data.active_version;
    const selectedTask=scopeTasks().find(task=>task.id===taskScope);
    if(taskScope&&!selectedTask)return '<div class="empty">'+t('This task is not available in this policy scope. Choose the project explicitly before editing.','此任務不在目前可讀取的政策範圍。請明確切回專案後再編輯。')+'</div>'+button(t('Return to project rules','回到專案規則'),'project-scope');
    // Keep exact rules reachable even when a supported activity is split across
    // several dimensions or scoped to a different task than the current page.
    const contextual=doc().rules;
    return '<div class="mr-page"><div class="mr-scopebar"><button type="button" data-rule-action="project-scope" aria-pressed="'+(!taskScope)+'">'+t('Project','專案')+'</button>'+button(taskScope?esc(taskScope):t('Task exception','任務例外'),'task-picker','aria-haspopup="dialog" aria-pressed="'+!!taskScope+'"')+'<span class="mr-version">'+t('Viewing ','顯示 ')+(pending?t('draft v','草稿 v'):active?t('approved v','已核准 v'):t('unsaved defaults · v','尚未儲存預設 · v'))+esc(doc().version)+'</span></div><div class="mr-context"><div><h2 title="'+esc(selectedTask?.title||project.name)+'">'+esc(taskScope?selectedTask?.title:project.name)+'</h2><p>'+t(taskScope?'Only this task; unset dimensions inherit its project rules.':'Defaults for new authorized dispatches in this project.',taskScope?'僅此任務；未指定的項目沿用專案規則。':'此專案後續核准派工使用的預設設定。')+'</p></div>'+button(t('Project defaults','專案預設'),'defaults',editable()?'':'disabled')+'</div>'+(data.setup_reason?'<p class="mr-error">'+esc(data.setup_reason)+'</p>':'')+'<section class="mr-list" aria-label="'+t('Model rules by activity','各活動的模型規則')+'"><div class="mr-columns" aria-hidden="true"><span>'+t('Work activity','工作活動')+'</span><span>'+t('Model choice','模型選擇')+'</span><span>'+t('Reasoning · service','推理 · 服務模式')+'</span><span></span></div>'+ruleActivities.map(ruleRow).join('')+'</section><div class="mr-principle"><span aria-hidden="true">◇</span><p><strong>'+t('Quality and risk come first.','品質與風險優先。')+'</strong> '+t('Auto chooses only qualified models. Fixed choices never silently downgrade.','Auto 只在符合要求的模型中選擇；指定值不會自行降級。')+'</p></div><section class="mr-approval"><div><h3>'+t(pending?'Draft awaiting approval':active?'Approved policy':'No approved policy',pending?'草稿等待核准':active?'政策已核准':'尚無核准政策')+'</h3><p>'+t('Approved version: ','已核准版本：')+esc(data.active_version??'—')+' · '+t('Running tasks retain their pinned policy.','執行中的任務保留已鎖定政策。')+'</p></div>'+(latest?button(t('Approve this exact draft','核准此精確草稿'),'approve','id="approve-policy-v2" '+(may('policy.approve')&&!latest.approval?'':'disabled')):'')+'</section><div id="command-result" role="status"></div><div id="policy-preview"></div><details class="mr-help"><summary>'+t('Advanced rules & exact versions','進階規則與精確版本')+'</summary><p>'+t('Role and node rules can affect actual selection. The five activities are not five agent identities.','角色與節點規則也會影響實際選擇。五項工作活動不代表五個 Agent 身分。')+'</p>'+contextual.map(rule=>'<div class="mr-advanced-row"><span>'+esc(label(rule.layer)+' · '+rule.match+(rule.task?' / '+rule.task:'')+' · '+rule.id)+'</span>'+button(t('Edit','編輯'),'rule:'+rule.id,editable()?'':'disabled')+'</div>').join('')+button(t('Add contextual rule','新增情境規則'),'advanced',editable()?'':'disabled')+'<details><summary>'+t('Stored policy document','已保存政策文件')+'</summary><pre>'+esc(JSON.stringify(doc(),null,2))+'</pre></details>'+(latest?'<p class="mono">SHA-256 '+esc(latest.sha256)+'</p>':'')+'<p class="small">'+t('Saving a draft does not approve it or start work. Adoption requires an authorized policy bridge.','儲存草稿不會核准或啟動工作；任務需循授權政策橋接採用。')+'</p></details><details class="mr-help"><summary>'+t('Understand inheritance and Auto','了解繼承與 Auto')+'</summary><p>'+t('Each dimension is independent. Inherit keeps its ancestor choice; Auto explicitly asks the system to choose. Project → activity / role → task → task activity → node.','每個維度獨立設定。繼承沿用上層選擇；Auto 則明確交由系統選擇。專案 → 活動／角色 → 任務 → 任務活動 → 節點。')+'</p></details></div>';
  }
  function open(selector, trigger) {
    if(!editable()||editor)return;
    const document=doc()||{project:current.data.policy,rules:[],models:[]};
    const own=selector.layer==='project'?document.project:document.rules.find(rule=>matches(rule,selector))?.settings||{};
    editor={selector, document:structuredClone(document), version:current.data.version, project:current.project.id,
      returnTo:'[data-rule-action="'+trigger+'"]', epoch:++epoch};
    const activity=ruleActivities.find(a=>a[0]===selector.match), title=activity?t(activity[1],activity[2]):label(selector.layer);
    const catalog=current.data.capabilities?.catalog||document.models;
    editor.document.models=catalog.map(model=>structuredClone(document.models.find(existing=>existing.id===model.id)??model));
    const fields=dimensions.map(([dim,en,zh])=>{
      const setting=own[dim]||{mode:'inherit'}, choices=dim==='model'?catalog.map(m=>m.id):[...new Set(catalog.flatMap(m=>m[dim==='reasoning'?'reasoning_efforts':'service_tiers']||current.data.capabilities?.[dim]||[]))];
      return '<fieldset class="mr-field"><legend>'+t(en,zh)+'</legend><label class="sr-only" for="rule-'+dim+'-mode">'+t(en,zh)+' '+t('mode','模式')+'</label><select id="rule-'+dim+'-mode" name="'+dim+'-mode">'+['inherit','auto','fixed'].map(mode=>'<option value="'+mode+'" '+(setting.mode===mode?'selected':'')+' '+(selector.layer==='project'&&mode==='inherit'&&doc()?'disabled':'')+'>'+({inherit:t('Inherit','沿用上層'),auto:'Auto',fixed:t('Fixed','指定')}[mode])+'</option>').join('')+'</select><label class="sr-only" for="rule-'+dim+'-value">'+t(en,zh)+' '+t('fixed value','指定值')+'</label><input id="rule-'+dim+'-value" name="'+dim+'-value" aria-label="'+dim+' fixed value" value="'+esc(setting.value||'')+'" list="rule-'+dim+'-choices" '+(setting.mode==='fixed'?'':'hidden disabled')+' autocomplete="off"><datalist id="rule-'+dim+'-choices">'+choices.map(value=>'<option value="'+esc(value)+'">').join('')+'</datalist><p class="form-help">'+t(dim==='model'?'Use an approved model alias; Auto keeps the quality gate.':dim==='reasoning'?'Provider labels are kept exactly as reported.':'Only service modes reported by this host are eligible.',dim==='model'?'使用核准模型別名；Auto 仍須符合品質門檻。':dim==='reasoning'?'保留供應方回報的原始推理強度名稱。':'只有此主機回報支援的服務模式可選。')+'</p></fieldset>';
    }).join('');
    const dialog=documentNode('<dialog id="model-rule-dialog" class="mr-dialog" aria-labelledby="rule-editor-title"><form id="model-rule-form"><div class="mr-dialog-head"><div><span class="eyebrow">'+t('MODEL RULE','模型規則')+'</span><h2 id="rule-editor-title">'+esc(title)+'</h2><p>'+esc(current.project.name)+(selector.task?' / '+esc(selector.task):taskScope&&!selector.advanced&&selector.layer!=='project'?' / '+esc(taskScope):'')+'</p></div>'+button('×','cancel','aria-label="'+t('Close editor','關閉編輯器')+'"')+'</div><div class="mr-dialog-body">'+(selector.advanced?'<div class="fields"><label>'+t('Rule layer','規則層級')+'<select name="context-layer" id="policy-context" '+(selector.id?'disabled':'')+'>'+['activity','role','task','node'].map(v=>'<option value="'+v+'" '+(selector.layer===v?'selected':'')+'>'+label(v)+'</option>').join('')+'</select></label><label>'+t('Context identifier','情境識別')+'<input name="context-match" id="policy-match" '+(selector.id?'readonly':'')+' value="'+esc(selector.match||'')+'" required></label></div>':'')+fields+(catalog.length?'<details><summary>'+t('Allowed models','可用模型')+'</summary><div class="model-catalog">'+catalog.map(model=>'<label><input type="checkbox" name="allowed-model" value="'+esc(model.id)+'" '+(document.models.some(m=>m.id===model.id)?'checked':'')+'><span><strong>'+esc(model.id)+'</strong><small>'+esc(model.provider+' / '+model.model)+'</small></span></label>').join('')+'</div></details>':'')+'<div class="mr-draft-preview" aria-live="polite" id="rule-live-preview"></div><p id="rule-editor-error" class="mr-error" role="alert"></p><div id="rule-selection-preview"></div></div><div class="mr-dialog-foot"><p>'+t('Save a draft first. Approval is a separate action.','先儲存草稿，再單獨核准。')+'</p><div>'+button(t('Cancel','取消'),'cancel')+button(t('Preview choices','預覽選擇'),'preview','id="preview-policy-v2" '+(may('policy.preview')&&doc()?'':'disabled'))+'<button class="primary" type="submit" id="save-rule">'+t(doc()?'Save draft':'Save policy',doc()?'儲存草稿':'儲存政策')+'</button></div></div></form></dialog>');
    documentBody().append(dialog); dialog.addEventListener('cancel',event=>{event.preventDefault();if(!saving)dismiss();});dialog.showModal();validate();
  }
  function capture() {
    const data=new FormData(el('model-rule-form')), settings={};
    for(const name of policyDimensions){const mode=data.get(name+'-mode'),value=String(data.get(name+'-value')||'').trim();settings[name]={mode,...(mode==='fixed'?{value}:{})};}
    const selector={...editor.selector};
    if(selector.advanced&&!selector.id){selector.layer=data.get('context-layer');selector.match=String(data.get('context-match')).trim();}
    if(!doc())return {policy:settings,selectors:{}};
    const policy=editPolicy(editor.document,selector,settings,data.getAll('allowed-model'),(current.data.entries?.length??0)+1);
    const selectors=selector.layer==='project'?{}:{[selector.layer]:selector.match,...(selector.task?{task:selector.task}:{})};
    return {policy,selectors};
  }
  function validate() {
    if(!editor)return;
    try {
      const {policy,selectors}=capture(),resolved=doc()?resolvePolicySettings(policy,selectors).requested:policy;
      el('rule-live-preview').innerHTML='<strong>'+t('With this change','變更後')+'</strong><p>'+dimensions.map(([key,en,zh])=>esc(t(en,zh))+': '+esc(valueLabel(resolved[key]))).join(' · ')+'</p>';
      if(!editor.unconfirmed)el('rule-editor-error').textContent='';el('save-rule').disabled=saving||editor.unconfirmed||!editable();
      el('preview-policy-v2').disabled=saving||editor.unconfirmed||!may('policy.preview')||!doc();
    }catch(error){el('rule-editor-error').textContent=error.message;el('save-rule').disabled=true;el('preview-policy-v2').disabled=true;}
  }
  function chooseTask() {
    picker=documentNode('<dialog class="project-dialog" aria-labelledby="rule-task-title"><div class="picker-head"><h2 id="rule-task-title">'+t('Task exceptions','任務例外')+'</h2><button data-rule-action="close-picker" aria-label="'+t('Close','關閉')+'">×</button></div><input type="search" id="rule-task-search" placeholder="'+t('Search title or task ID','搜尋任務名稱或識別')+'" aria-label="'+t('Search tasks','搜尋任務')+'"><div id="rule-task-results"></div><div id="rule-task-pages"></div></dialog>');
    documentBody().append(picker);picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();picker.close();}});let offset=0;
    const results=()=>{const query=el('rule-task-search').value.toLocaleLowerCase(),tasks=scopeTasks().filter(task=>(task.id+' '+task.title).toLocaleLowerCase().includes(query));el('rule-task-results').innerHTML=tasks.slice(offset,offset+20).map(task=>button('<b>'+esc(task.title||task.id)+'</b><small>'+esc(task.id)+'</small>','task:'+task.id,'class="picker-item"')).join('')||'<p class="empty">'+t('No matching tasks','沒有符合的任務')+'</p>';el('rule-task-pages').innerHTML='<span>'+tasks.length+' '+t('tasks','個任務')+'</span>'+button('←','picker-back',offset?'':'disabled')+button('→','picker-next',offset+20<tasks.length?'':'disabled');};
    picker.addEventListener('input',()=>{offset=0;results();});picker.addEventListener('click',event=>{const action=event.target.closest('[data-rule-action]')?.dataset.ruleAction;if(action==='picker-back'||action==='picker-next'){offset+=action==='picker-back'?-20:20;results();}});picker.addEventListener('close',()=>{picker?.remove();picker=null;document.querySelector('[data-rule-action="task-picker"]')?.focus();});results();picker.showModal();
  }
  document.addEventListener('input',event=>{if(event.target.closest('#model-rule-form'))validate();});
  document.addEventListener('change',event=>{if(!event.target.closest('#model-rule-form'))return;if(event.target.name.endsWith('-mode')){const input=event.target.form.elements[event.target.name.replace('-mode','-value')];if(input)input.hidden=input.disabled=event.target.value!=='fixed';}validate();});
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='model-rule-form')return;event.preventDefault();if(saving||editor?.unconfirmed||!editable())return;
    const active=editor;
    try{const payload=capture();saving=true;validate();const result=await send('policy',doc()?'policy.draft':'policy.save',{policy:payload.policy},active.version);
      if(editor!==active)return;
      if(result?.status==='confirmed'){const legacy=!doc();dismiss();await reload();notice(t(legacy?'Host confirmed the request.':'Draft saved. Review its exact version before approval.',legacy?'主機已確認要求。':'已儲存草稿。請在核准前檢查精確版本。'));}
      else {editor.unconfirmed=true;el('rule-editor-error').textContent=t('The save was not confirmed. Close the editor and refresh to inspect the recorded request before retrying.','未確認儲存結果。請先關閉編輯器並重新整理，核對已記錄要求後再重試。');}
    }catch(error){if(editor===active)el('rule-editor-error').textContent=error.message;}finally{saving=false;if(editor===active)el('save-rule').disabled=true;}
  });
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-rule-action]');if(!target)return;const action=target.dataset.ruleAction;
    if(action==='cancel'){if(!saving)dismiss();return;}
    if(action==='defaults')open({layer:'project'},action);
    if(action.startsWith('edit:'))open({layer:'activity',match:action.slice(5),...(taskScope?{task:taskScope}:{})},action);
    if(action.startsWith('rule:')){const rule=doc()?.rules.find(r=>r.id===action.slice(5));if(rule)open({...rule,advanced:true},action);}
    if(action==='advanced')open({layer:'role',match:'',advanced:true},action);
    if(action==='task-picker')chooseTask();
    if(action==='close-picker')picker?.close();
    if(action.startsWith('task:')){taskScope=action.slice(5);const url=new URL(location.href);url.searchParams.set('policy_task',taskScope);history.replaceState(null,'',url);picker?.close();host.render();}
    if(action==='project-scope'){taskScope='';const url=new URL(location.href);url.searchParams.delete('policy_task');history.replaceState(null,'',url);host.render();}
    if(action==='preview'&&editor&&!saving){const active=editor;try{const payload=capture();saving=true;validate();const result=await send('policy','policy.preview',payload,active.version);if(editor===active&&result?.status==='confirmed')el('rule-selection-preview').innerHTML=preview(result.result);else if(editor===active)el('rule-editor-error').textContent=t('Preview could not be confirmed.','無法確認預覽結果。');}catch(error){if(editor===active)el('rule-editor-error').textContent=error.message;}finally{saving=false;if(editor===active)validate();}}
    if(action==='approve'&&may('policy.approve')){const latest=current.data.entries?.at(-1),project=current.project.id;if(!latest||latest.approval)return;target.disabled=true;const result=await send('policy','policy.approve',{policy_id:latest.policy.id,policy_version:latest.policy.version,policy_sha256:latest.sha256},current.data.version);if(current?.project.id!==project)return;if(result?.status==='confirmed'){await reload();notice(t('Exact draft approved. Existing task snapshots remain unchanged.','已核准精確草稿。既有任務快照維持原版本。'));}}
  });
  return {render,leave,validate,isOpen:()=>!!editor};
}
function documentNode(html){const template=document.createElement('template');template.innerHTML=html;return template.content.firstElementChild;}
function documentBody(){return document.body;}
