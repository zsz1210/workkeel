function formatInteger(value) {
  return value.toLocaleString('en-US', { useGrouping: true, maximumFractionDigits: 0 });
}

export function formatCount(metric) {
  if (metric == null) return 'Unknown';
  if (metric.complete === true && Number.isSafeInteger(metric.total) && metric.total >= 0) {
    return formatInteger(metric.total);
  }
  if (Number.isSafeInteger(metric.known_subtotal) && metric.known_subtotal >= 0) {
    return `>= ${formatInteger(metric.known_subtotal)} (partial)`;
  }
  return 'Unknown';
}

function isValidCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e12;
}

function formatDollar(value) {
  return `$${value.toFixed(4)}`;
}

export function formatCost(metric) {
  if (metric == null) return 'Unknown';
  if (metric.complete === true && isValidCost(metric.total)) return formatDollar(metric.total);
  if (isValidCost(metric.known_subtotal)) return `>= ${formatDollar(metric.known_subtotal)} (partial)`;
  return 'Unknown';
}

export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > Number.MAX_SAFE_INTEGER) {
    return 'Unknown';
  }
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms - minutes * 60000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export const phaseLabels = {waiting:'等待認領',implementation:'實作階段',review:'審查階段（含等待）',rework:'返工階段',acceptance:'等待驗收'};
const labels = {ready:'待認領',working:'實作中',review:'待審查',acceptance:'待驗收',done:'已驗收',cancelled:'已取消',unavailable:'無法讀取',intake:'待認領',build:'實作中',test:'待審查',release_gate:'待驗收',pass:'通過',fail:'未通過',unknown:'未知',verified:'雜湊吻合',changed:'已變更',authority:'授權',delivery:'交付',closeout:'結案',unobserved:'尚無觀測',unbound:'未綁定候選版本',stale:'舊版本觀測','candidate-matched':'候選版本吻合','real-task':'真實任務','paired-experiment':'配對實驗',fixture:'測試資料',unspecified:'未分類',completed:'執行完成',interrupted:'執行中斷',running:'紀錄為執行中',rejected:'遭拒絕',paused:'已暫停',blocked:'受阻','awaiting-approval':'等待批准',unresolved:'待釐清',unconfirmed:'未確認',create:'建立',claim:'認領',release:'釋放認領',handoff:'交付',rework:'返工',close:'驗收',cancel:'取消'};
export const label = value => value==='review'?'審查':labels[value] ?? value ?? '未知';
export const durationZh = ms => formatDuration(ms).replace('Unknown','未知').replace(' min ',' 分 ').replace(/ s$/, ' 秒');
export const countZh = metric => formatCount(metric).replace('Unknown','未知').replace('(partial)','（部分紀錄）');
export const costZh = metric => formatCost(metric).replace('Unknown','未知').replace('(partial)','（部分紀錄）');
const actions = {
  'timing-unavailable':'歷程時間無法驗證：檢查事件時間或重新讀取；不以部分數字代替總量。',
  'approval-expired':'授權已過期：請透過新任務取得有效批准，再繼續執行。',
  'policy-changed':'專案政策已變更：核對變更並重新確認任務授權。',
  'evidence-unavailable':'必要證據變更或無法讀取：先恢復紀錄所指的原始證據。',
  'observation-unavailable':'觀測紀錄無法驗證：檢查觀測檔案及其引用的證據。',
  'review-failed':'審查未通過：處理具體意見，取得同範圍返工批准。',
  'awaiting-review':'等待獨立審查：請另一位 Agent 核對交付的候選版本與證據。',
  'awaiting-acceptance':'等待驗收：確認審查通過的候選版本，記錄驗收與回復方式。',
  'workflow-incomplete':'執行紀錄不完整或需處理：先檢查中斷、未確定的嘗試及恢復紀錄，勿直接重跑。'
};
export function taskActions(task) {
  if(task.read_status==='unavailable')return ['任務紀錄無法驗證：檢查此任務檔案；目前狀態未知。'];
  const reasons=(task.attention_reasons??[]).map(code=>actions[code]??'有未識別的待處理紀錄，請檢查任務。');
  if(reasons.length)return reasons;
  return [{intake:'認領已批准的任務，開始工作。',build:'檢查最新執行紀錄，於有效認領範圍內繼續工作。',test:actions['awaiting-review'],release_gate:actions['awaiting-acceptance'],done:'已完成本機驗收；合併與發布仍需各自的證據。',cancelled:'任務已取消，保留既有證據。'}[task.task_state]??'檢查任務紀錄。'];
}
/** Explicitly selected public projection fields only. Never copy raw run output or access links. */
export function handoffText(task, readAt) {
  if(!task || task.read_status!=='available')return null;
  const list=values=>Array.isArray(values)?values.length?values.join('；'):'無':'未記錄';
  return [
    'WORKKEEL 接手摘要（唯讀觀測，不授予執行權限）',
    '任務：'+task.id, '目標：'+(task.goal??task.title),
    '範圍：'+list(task.scope?.include), '排除：'+list(task.scope?.exclude),
    '可讀路徑：'+list(task.execution_scope?.read_paths), '可寫路徑：'+list(task.execution_scope?.write_paths),
    '工具：'+list(task.execution_scope?.tools), '網路：'+(task.execution_scope?.network?.mode??'未知')+' / '+list(task.execution_scope?.network?.hosts),
    '驗收條件：'+list(task.acceptance_criteria),
    '快照時間：'+readAt, '最近任務事件：'+task.updated_at,
    '候選版本：'+(task.candidate_revision??'尚未交付'),
    '任務狀態：'+label(task.task_state),
    '執行紀錄：'+(task.runs?.length?task.runs.map(r=>r.run_id+' / '+label(r.runner_state)).join('；'):'尚無可讀紀錄'),
    '候選審查：'+(task.review?label(task.review.judgment):'尚未審查'),
    '本機驗收：'+(task.quality?.locally_accepted?'已記錄':'尚未完成'),
    '證據：'+(task.evidence?.length?task.evidence.map(e=>label(e.stage)+' / '+label(e.status)+' / '+e.path+' / '+e.sha256).join('\n'):'尚無紀錄'),
    '觀測狀態：'+label(task.observation?.status)+'；觀測不代替驗收。',
    '檢查觀測：'+(task.observation?.value?.checks?.length?task.observation.value.checks.map(check=>check.name+' / '+label(check.status)+' / '+check.evidence_ref).join('\n'):'尚無紀錄'),
    '待處理：'+taskActions(task).join('\n'),
    '任務總經過時間：'+durationZh(task.lifecycle?.elapsed_ms)+(task.lifecycle?.ongoing?'（持續中）':''),
    ...Object.entries(phaseLabels).map(([key,name])=>name+'：'+durationZh(task.lifecycle?.phases?.[key])),
    '已記錄 adapter 呼叫：'+durationZh(task.timing?.adapter_work_ms),
    '輸入 / 輸出 tokens：'+countZh(task.usage?.input_tokens)+' / '+countZh(task.usage?.output_tokens),
    '限制：階段時間包含等待與停機；adapter 呼叫可能重疊，不能相加。人工工時、未觀測使用量及相對一般流程的節省比例未知。紀錄不證明程序仍存活。'
  ].join('\n');
}
