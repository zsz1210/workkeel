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

export const phaseLabels = {waiting:'等待接手',implementation:'實作階段',review:'審查階段',rework:'修正階段',acceptance:'等待驗收'};
const labels = {ready:'待開始',working:'實作中',review:'待審查',acceptance:'待驗收',done:'已驗收',cancelled:'已取消',unavailable:'無法讀取',intake:'待開始',spec:'規格確認',design:'設計中',eval:'評估中',independent_qa:'獨立審查',concluded:'已結束',build:'實作中',test:'待審查',release_gate:'待驗收',pass:'通過',fail:'未通過',unknown:'未知',verified:'雜湊吻合',changed:'已變更',authority:'授權',delivery:'交付',closeout:'結案',unobserved:'尚無觀測',unbound:'未綁定候選版本',stale:'舊版本觀測','candidate-matched':'候選版本吻合','real-task':'真實任務','paired-experiment':'配對實驗',fixture:'測試資料',unspecified:'未分類',completed:'執行完成',interrupted:'執行中斷',running:'紀錄為執行中',rejected:'遭拒絕',paused:'已暫停',blocked:'受阻','awaiting-approval':'等待核准',unresolved:'待釐清',unconfirmed:'未確認',create:'建立',claim:'接手任務',release:'交出任務',handoff:'交付',rework:'修正',close:'驗收',cancel:'取消'};
const additionalLabels = {review:'審查',created:'已建立',failed:'執行失敗','not-started':'尚未啟動'};
export const label = value => Object.hasOwn(additionalLabels,value)?additionalLabels[value]:Object.hasOwn(labels,value)?labels[value]:value??'未知';
export const durationZh = ms => formatDuration(ms).replace('Unknown','未知').replace(' min ',' 分 ').replace(/ s$/, ' 秒');
export const countZh = metric => formatCount(metric).replace('Unknown','未知').replace('(partial)','（部分紀錄）');
export const costZh = metric => formatCost(metric).replace('Unknown','未知').replace('(partial)','（部分紀錄）');
const actions = {
  'timing-unavailable':'無法確認完整耗時，請檢查事件時間或重新讀取。部分紀錄不能代表總耗時。',
  'approval-expired':'授權已過期：請透過新任務取得有效核准，再繼續執行。',
  'policy-changed':'專案政策已變更：核對變更並重新確認任務授權。',
  'evidence-unavailable':'必要證據變更或無法讀取：先恢復紀錄所指的原始證據。',
  'observation-unavailable':'觀測紀錄無法驗證：檢查觀測檔案及其引用的證據。',
  'review-failed':'審查未通過：處理具體意見，取得同範圍修正核准。',
  'awaiting-review':'等待獨立審查：請另一位 Agent 核對交付的候選版本與證據。',
  'awaiting-acceptance':'等待驗收：確認審查通過的候選版本，記錄驗收與回復方式。',
  'workflow-incomplete':'執行紀錄不完整或需處理：先檢查中斷、未確定的嘗試及恢復紀錄，勿直接重跑。'
};
export function taskActions(task) {
  if(task.read_status==='unavailable')return ['任務紀錄無法驗證：檢查此任務檔案；目前狀態未知。'];
  if(task.record_mode==='work-items')return ['紀錄中的階段：'+label(task.task_state),...(task.unresolved??[])];
  const continuation=task.continuation;
  const detail=continuation?.status==='confirmed-interruption'?'已核對中斷、清理與部分成果：準備本輪接手材料，派送前重新核對接續計畫。此快照不授予執行權限。':
    continuation?.status==='successor-recorded'?'已有接續紀錄：查看既有接續工作，勿重複建立。':
    continuation?.status==='unavailable'?({
      'authority-or-claim-changed':'接手授權或認領不再吻合：先確認目前的任務授權與負責者。',
      'cleanup-unconfirmed':'尚未確認原程序已清理：先確認負責者與原程序狀態，避免重複執行。',
      'source-changed':'部分成果或版本已變更：核對差異，更新接手資料。',
      cancelled:'工作已明確取消，保留既有紀錄，不自動接續。',
      'operation-unconfirmed':'尚未確認上次操作是否完成：請先查明結果，再決定是否重試。',
      'evidence-unavailable':'接手證據不足或無法驗證：查看原紀錄，不自動接續。'
    }[continuation.reason]??'接手狀態無法驗證：查看原紀錄，不自動接續。'):null;
  const reasons=(task.attention_reasons??[]).map(code=>code==='workflow-incomplete'&&detail?detail:actions[code]??'有未識別的待處理紀錄，請檢查任務。');
  if(reasons.length)return reasons;
  return [{intake:'接手已核准的任務後開始工作。',build:'檢查最新執行紀錄，依目前授權與負責範圍繼續工作。',test:actions['awaiting-review'],release_gate:actions['awaiting-acceptance'],done:'已完成。',cancelled:'任務已取消，保留既有證據。'}[task.task_state]??'檢查任務紀錄。'];
}
/** Explicitly selected public projection fields only. Never copy raw run output or access links. */
export function handoffText(task, readAt) {
  if(!task || task.read_status!=='available')return null;
  // Keep project-authored text inside a single quoted field. Escape Unicode line
  // separators and directional controls as well as JSON's CR/LF/control escaping.
  const quote=value=>JSON.stringify(String(value??'')).replace(/[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const list=values=>Array.isArray(values)?values.length?values.map(quote).join('；'):'無':'未記錄';
  return [
    'WORKKEEL 接手摘要（唯讀觀測，不授予執行權限）',
    '任務：'+task.id, '目標：'+quote(task.goal??task.title),
    '範圍：'+list(task.scope?.include), '排除：'+list(task.scope?.exclude),
    '可讀路徑：'+list(task.execution_scope?.read_paths), '可寫路徑：'+list(task.execution_scope?.write_paths),
    '工具：'+list(task.execution_scope?.tools), '網路：'+(task.execution_scope?.network?.mode??'未知')+' / '+list(task.execution_scope?.network?.hosts),
    '驗收條件：'+list(task.acceptance_criteria),
    '快照時間：'+readAt, '最近任務事件：'+task.updated_at,
    '候選版本：'+(task.candidate_revision??'尚未交付'),
    '任務狀態：'+label(task.task_state),
    '執行紀錄：'+(task.runs?.length?task.runs.map(r=>r.run_id+' / '+label(r.runner_state)).join('；'):'尚無可讀紀錄'),
    '候選審查：'+(task.review?label(task.review.judgment):'尚未審查'),
    '本機驗收：'+(task.quality?.locally_accepted==null?'未記錄':task.quality.locally_accepted?'已記錄':'尚未完成'),
    '證據：'+(task.evidence?.length?task.evidence.map(e=>label(e.stage)+' / '+label(e.status)+' / '+quote(e.path)+' / '+e.sha256).join('\n'):'尚無紀錄'),
    '觀測狀態：'+label(task.observation?.status)+'；觀測不代替驗收。',
    '檢查觀測：'+(task.observation?.value?.checks?.length?task.observation.value.checks.map(check=>quote(check.name)+' / '+label(check.status)+' / '+quote(check.evidence_ref)).join('\n'):'尚無紀錄'),
    '待處理：'+taskActions(task).join('\n'),
    '任務總經過時間：'+durationZh(task.lifecycle?.elapsed_ms)+(task.lifecycle?.ongoing?'（持續中）':''),
    ...Object.entries(phaseLabels).map(([key,name])=>name+'：'+durationZh(task.lifecycle?.phases?.[key])),
    '已記錄 adapter 呼叫：'+durationZh(task.timing?.adapter_work_ms),
    '輸入 / 輸出 tokens：'+countZh(task.usage?.input_tokens)+' / '+countZh(task.usage?.output_tokens),
    '限制：階段時間包含等待與停機；adapter 呼叫可能重疊，不能相加。人工工時、未觀測使用量及相對一般流程的節省比例未知。紀錄不證明程序仍存活。'
  ].join('\n');
}
