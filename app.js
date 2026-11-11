'use strict';
const C=DockCore, $=s=>document.querySelector(s), native=window.DockNative;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, screen='record', selected=null, editing=false, onlyChanged=false, settingsDraft, brokenRaw=null;
const t=(key,params)=>DockI18n.translate(key,state?.settings.language||'ko',params);
let toastTimer;
let readRange='all';
let undoGroup=null;
function updateUndoButtons(){
  const undo=$('[data-action="undo"]'),redo=$('[data-action="redo"]');
  if(undo)undo.disabled=!state.draft?.undoHistory?.length;
  if(redo)redo.disabled=!state.draft?.redoHistory?.length;
}
function remember(group=null){
  delete state.draft.automatic;
  const key=group?state.draft.id+':'+group:null;
  C.rememberEdit(state.draft,!!key&&key===undoGroup);undoGroup=key;updateUndoButtons();
}
function undoEdit(redo=false){
  if(!editing||screen!=='record'||!state.draft||$('#dialog').open)return;
  Object.keys(state.draft.pendingContainers||{}).forEach(n=>finishContainer(Number(n)));
  const before=C.clone(state.draft),scroll=window.scrollY,focused=document.activeElement;
  const focus=focused?.dataset.field?{dock:focused.dataset.dock,field:focused.dataset.field,index:focused.dataset.index}:null;
  if(!C.travelEdit(state.draft,redo))return;
  undoGroup=null;
  if(!persist()){state.draft=before;updateUndoButtons();return;}
  render();
  if(focus){const target=$(`[data-dock="${focus.dock}"][data-field="${focus.field}"]${focus.index===undefined?'':`[data-index="${focus.index}"]`}`);if(target&&!target.disabled)target.focus({preventScroll:true});}
  window.scrollTo(0,scroll);toast(redo?t("다시 실행했습니다."):t("한 단계 되돌렸습니다."));
}
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',3500);}
function persist(){
  try {
    const raw=JSON.stringify(state);
    if(native){if(!native.save(raw))throw new Error(t("저장 실패"));}
    else localStorage.setItem('dock-notes-v1',raw);
    const status=$('#save-status');if(status)status.textContent=t("기기에 임시 저장됨");
    return true;
  }catch(e){const status=$('#save-status');if(status)status.textContent=t("저장 실패 — 공간을 확인하고 다시 저장해 주세요");toast(t("저장하지 못했습니다. 앱을 닫지 말고 백업해 주세요."));return false;}
}
function current(){return editing?state.draft:(state.records.find(r=>r.id===selected)||state.records[state.records.length-1]);}
function change(r,row){return C.diff(row,r.baseline&&r.baseline[row.dock-1],r.corrections.includes(row.dock));}
function closeDialog(){$('#dialog').close();}
function modal(html){$('#dialog-body').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function confirmAction(title,body,label,action){modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="actions"><button data-action="close">${t("취소")}</button><button class="primary" id="confirm-action">${esc(label)}</button></div>`);$('#confirm-action').onclick=()=>{closeDialog();action();};}
function download(name,mime,content){
  if(native){native.exportFile(name,mime,content);return;}
  const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function copyRecord(){const text=C.text(current(),state.settings.language);if(native)native.copy(text);else navigator.clipboard.writeText(text).then(()=>toast(t("점검 기록을 복사했습니다"))).catch(()=>download('dock-check.txt','text/plain',text));}
function openNew(automatic=false){
  if(state.draft){editing=true;screen='record';onlyChanged=false;render();return;}
  try{
    const slot=C.suggest(new Date(),state.settings,state.records);
    state.draft=C.newRecord(state,slot.date,slot.time);
    if(automatic)state.draft.automatic=true;
    if(!persist()){state.draft=null;return;}
    editing=true;onlyChanged=false;screen='record';render();window.scrollTo(0,0);
  }catch(e){toast(t(e.message));}
}
function openScheduledPage(){
  if(screen!=='record'||$('#dialog').open)return;
  try{
    const slot=C.suggest(new Date(),state.settings,[]);
    const draft=state.draft;
    if(draft){
      const untouched=draft.automatic===true&&!draft.editOf&&!draft.undoHistory?.length&&!draft.redoHistory?.length&&!draft.corrections.length&&JSON.stringify(draft.rows)===JSON.stringify(draft.baseline||Array.from({length:20},(_,i)=>C.blankRow(i+1)));
      if(!untouched||(draft.date===slot.date&&draft.time===slot.time))return;
      state.draft=null;
      if(!persist()){state.draft=draft;return;}
    }
    const saved=state.records.find(r=>r.date===slot.date&&r.time===slot.time);
    if(saved){selected=saved.id;editing=false;onlyChanged=false;render();return;}
    openNew(true);
  }catch(e){toast(t(e.message));}
}
window.openScheduledPage=openScheduledPage;
function editSchedule(){
  if(state.draft.editOf){toast(t("저장된 점검은 원래 날짜·시간을 유지합니다. 잘못 만든 최신 점검은 삭제할 수 있습니다."));return;}
  const r=state.draft,times=[...new Set([...state.settings.times,r.time])].sort((a,b)=>C.minutes(a)-C.minutes(b));
  modal(`<h2>${t("날짜·점검 시간 수정")}</h2><p>${t("실제 입력 시각이 아닌 예정된 점검 시간을 선택하세요.")}</p><label>${t("업무 날짜")}<input id="new-date" type="date" value="${r.date}"></label><label>${t("점검 시간")}<select id="new-time">${times.map(t=>`<option ${t===r.time?'selected':''}>${t}</option>`).join('')}</select></label><p id="new-error" class="danger" role="alert"></p><div class="actions"><button data-action="close">${t("취소")}</button><button class="primary" id="create-check">${t("시간 적용")}</button></div>`);
  $('#create-check').onclick=()=>{
    try{
      const date=$('#new-date').value,time=$('#new-time').value;
      C.newRecord(state,date,time);
      const old={date:r.date,time:r.time};if(date!==r.date||time!==r.time)remember();r.date=date;r.time=time;
      if(!persist()){Object.assign(r,old);return;}
      closeDialog();render();
    }catch(e){$('#new-error').textContent=t(e.message);}
  };
}
function render(){
  document.documentElement.lang=state.settings.language||'ko';
  $('.brand small').textContent=t('현장 기록, 간단하게.');
  $('#menu').setAttribute('aria-label',t('설정 및 기록 메뉴'));
  if(native?.setLanguage)native.setLanguage(state.settings.language||'ko');
  $('#bottom').innerHTML='';
  if(screen==='settings'){renderSettingsHome();return;}
  if(screen==='language'||screen==='check-settings'){renderSettings();return;}
  if(screen==='history'){renderHistory();return;}
  if(screen==='broken'){renderBroken();return;}
  const r=current();
  if(!r){
    $('#app').innerHTML=`<div class="intro"><div class="eyebrow">YOUR DAILY DOCK CHECK</div><h1>${t("다음 점검도,")}<br>${t("가볍게 시작하세요.")}</h1><p class="muted">${t("이전 기록은 그대로.")}<br>${t("달라진 부분만 고치면 됩니다.")}</p></div><div class="hero"><div class="hero-icon" aria-hidden="true">▤</div><h2>${t("첫 점검을 시작해 볼까요?")}</h2><p class="muted">${t("Dock 1~20을 한 화면에서 기록하세요.")}<br>${t("구역 이름과 점검 시간은 설정에서 바꿀 수 있어요.")}</p><button class="primary wide" data-action="next">${t("첫 점검 만들기 →")}</button></div><p class="smallprint">${t("기록은 이 휴대전화에만 저장됩니다.")}<br>${t("처음에는 빈 기록으로 시작합니다. 백업 파일이 있다면 메뉴에서 복원하세요.")}</p>`;
    return;
  }
  document.body.classList.toggle('reading',!editing);
  const changed=r.rows.filter(row=>change(r,row).fields.length).length;
  const latest=state.records[state.records.length-1];
  const options=state.records.map(x=>`<option value="${esc(x.id)}" ${x.id===r.id?'selected':''}>${esc(x.date)} · ${esc(x.time)}</option>`).join('')+(state.draft&&!state.draft.editOf?`<option value="draft" ${editing?'selected':''}>${state.draft.date} · ${state.draft.time} ${t("작성 중")}</option>`:'');
  $('#app').innerHTML=`<section class="intro check-intro"><div class="row between"><h1>${esc(r.time)}</h1><span class="pill">${editing?(r.editOf?t("기록 수정 중"):t("작성 중")):r.id===latest?.id?t("최신 점검"):t("지난 점검")}</span><span class="pill yellow" id="change-count">${t('{count}곳 변경',{count:changed})}</span></div><label class="record-picker">${t("점검 선택")}<select id="record-switch" aria-label="${t("점검 선택")}">${options}</select></label>${editing?`<div class="edit-tools">${!r.editOf?`<button class="link" data-action="schedule">${t("날짜·점검 시간 수정")}</button>`:''}<button class="link danger" data-action="discard">${r.editOf?t("수정 취소"):t("다음 점검 취소")}</button><span id="save-status" class="autosave">${t("기기에 임시 저장됨")}</span></div>${r.editOf&&r.id!==latest?.id?`<p class="smallprint">${t("이 기록만 수정합니다. 이후 점검의 값과 당시 비교 기준은 유지됩니다.")}</p>`:''}`:`<div class="toolbar"><button data-action="filter" class="toggle ${onlyChanged?'active':''}">${onlyChanged?t("전체 변경"):t("변경만")}</button><button data-action="copy">${t("전체 복사")}</button><button data-action="text">${t("텍스트 저장")}</button>${r.id===latest?.id&&!state.draft?`<button class="danger" data-action="delete-check">${t("점검 삭제")}</button>`:''}</div><nav class="ranges" aria-label="${t("Dock 구간")}">${[['all',t("전체")],['1-8','1–8'],['9-13','9–13'],['14-20','14–20']].map(([value,label])=>`<button data-action="range" data-range="${value}" class="${readRange===value?'active':''}">${label}</button>`).join('')}</nav>`}</section>${editing?`<div class="jump-bottom"><button data-action="jump-bottom" aria-label="${t('맨 아래로')}" title="${t('맨 아래로')}">↓</button></div>`:''}<div id="dock-list">${r.groups.map(g=>groupHtml(r,g)).join('')}</div>${onlyChanged&&!changed?`<p class="notice">${t("변경된 내용이 없습니다.")}</p>`:''}`;
  $('#bottom').innerHTML=`<div class="footer"><div class="footer-inner">${editing?`<button class="undo-button" data-action="undo" aria-label="${t("되돌리기")}">↶ ${t("되돌리기")}</button><button class="undo-button" data-action="redo" aria-label="${t("다시 실행")}" title="${t("다시 실행")}">↷</button><button class="primary" data-action="save">${t("저장 · 점검 보기")}</button>`:`<button data-action="edit">${t("수정")}</button><button class="primary" data-action="next">${state.draft?t("작성 중인 점검 이어서 →"):t("다음 점검 →")}</button>`}</div></div>`;
  updateUndoButtons();

}
function groupHtml(r,g){
  const rows=r.rows.filter(row=>row.dock>=g.start&&row.dock<=g.end&&(editing||readRange==='all'||(row.dock>=Number(readRange.split('-')[0])&&row.dock<=Number(readRange.split('-')[1])))&&(!onlyChanged||editing||change(r,row).fields.length));
  if(!rows.length)return '';
  return `<section class="group"><div class="group-title"><h3>${esc(g.name)}</h3><small>Dock ${g.start}${g.end!==g.start?'–'+g.end:''}</small></div>${rows.map(row=>rowHtml(r,row)).join('')}</section>`;
}
function rowHtml(r,row){
  const d=change(r,row), marked=f=>d.fields.includes(f)?'changed':'', empty=row.status==='Ready to drop';
  const field=(key,title,placeholder)=>`<label class="${marked(key)} ${key==='note'?'span2':''}">${title}<input data-field="${key}" data-dock="${row.dock}" value="${esc(row[key])}" maxlength="${key==='note'?2000:200}" placeholder="${placeholder}" ${empty&&key==='contents'?'disabled':''}></label>`;
  if(!editing){
    const cells=[['container',row.container||'—'],['codes',row.codes.filter(Boolean).join(' / ')||'—'],['contents',row.contents],['status',row.status||'—'],['note',row.note]].filter(([key,value])=>value);
    return `<article class="dock compact ${d.whole?'whole':''}" id="dock-${row.dock}"><button class="dock-line" data-action="details" data-dock="${row.dock}" aria-label="${t('Dock {dock} 상세',{dock:row.dock})}"><b class="line-number">${row.dock}</b>${cells.map(([key,value])=>`<span class="line-value read-${key==='container'?'main':key} ${marked(key)}">${esc(value)}</span>`).join('')}</button></article>`;
  }
  return `<article class="dock ${d.whole?'whole':''}" id="dock-${row.dock}"><div class="dock-head"><div class="dock-number">DOCK <b>${row.dock}</b></div><span class="change-tag" ${d.fields.length?'':'hidden'}>${d.whole?t(d.label):t("항목 변경")}</span></div>${editing?`<div class="fields"><label class="span2 ${marked('container')}">${t("컨테이너 번호")}<input data-field="container" data-dock="${row.dock}" value="${esc(row.container)}" maxlength="200" placeholder="${t("컨테이너 번호")}" autocapitalize="characters" autocomplete="off"></label><div class="span2 container-tools" id="container-tools-${row.dock}">${containerTools(row.dock)}</div><label class="span2 ${marked('codes')}">${t("아이템 코드")} ${row.codes.length}/3${row.codes.map((code,i)=>`<span class="code-row"><input aria-label="${t('Dock {dock} 아이템 코드 {code}',{dock:row.dock,code:i+1})}" data-field="codes" data-index="${i}" data-dock="${row.dock}" value="${esc(code)}" maxlength="200" placeholder="${t("아이템 코드")}">${row.codes.length>1?`<button aria-label="${t('코드 {code} 삭제',{code:i+1})}" data-action="remove-code" data-dock="${row.dock}" data-index="${i}">−</button>`:''}</span>`).join('')}${row.codes.length<3?`<button class="link" data-action="add-code" data-dock="${row.dock}">${t("+ 아이템 코드 추가")}</button>`:''}</label>${field('contents',t("내용물"),t("자유롭게 입력"))}<label class="${marked('status')}">${t("상태")}<select data-field="status" data-dock="${row.dock}">${C.statuses.map(s=>`<option value="${s}" ${s===row.status?'selected':''}>${s||t("상태 선택")}</option>`).join('')}</select></label>${field('note',t("메모"),t("필요할 때만 입력"))}</div>`:`<div class="read-main value ${marked('container')}">${esc(row.container)||`<span class="empty">${empty?t("컨테이너 없음"):t("번호 미입력")}</span>`}</div>${row.codes.some(Boolean)?`<div class="read-meta value ${marked('codes')}">${row.codes.filter(Boolean).map(esc).join(' / ')}</div>`:''}${row.contents?`<div class="read-meta value ${marked('contents')}">${esc(row.contents)}</div>`:''}<div class="read-status ${marked('status')}">${esc(row.status)||t("상태 미입력")}</div>${row.note?`<div class="read-meta value ${marked('note')}">${esc(row.note)}</div>`:''}`}${r.baseline&&d.fields.length?`<details class="previous"><summary>${t("이전 점검 보기")}</summary><p>${esc(rowSummary(r.baseline[row.dock-1]))}</p></details>`:''}</article>`;
}
function rowSummary(row){return [row.container||t("번호 없음"),row.codes.filter(Boolean).join(' / '),row.contents,row.status||t("상태 미입력"),row.note].filter(Boolean).join(' · ');}
function refreshRow(n){const el=$('#dock-'+n);if(el)el.outerHTML=rowHtml(current(),current().rows[n-1]);refreshCount();}
function refreshCount(){const r=current();const el=$('#change-count');if(el)el.textContent=t('{count}곳 변경',{count:r.rows.filter(row=>change(r,row).fields.length).length});}
function refreshMark(n){
  const row=current().rows[n-1],d=change(current(),row),el=$('#dock-'+n);
  el.classList.toggle('whole',d.whole);const tag=el.querySelector('.change-tag');tag.hidden=!d.fields.length;tag.textContent=d.whole?t(d.label):t("항목 변경");
  el.querySelectorAll('[data-field]').forEach(input=>input.closest('label').classList.toggle('changed',d.fields.includes(input.dataset.field)));
  refreshCount();
}
function containerTools(n){
  const draft=state.draft,row=draft.rows[n-1],before=draft.baseline?.[n-1];
  const changed=before?.container.trim()&&row.container.trim()&&C.normalized(before.container)!==C.normalized(row.container);
  const correction=draft.corrections.includes(n);
  return `${changed?`<button class="link" data-action="number-correction" data-dock="${n}">${correction?t("새 컨테이너로 표시"):t("번호만 정정")}</button>`:''}${draft.containerUndo?.[n]?`<button class="link" data-action="restore-container" data-dock="${n}">${t("이전 버전에서 비운 내용 복원")}</button>`:''}<button class="link danger" data-action="clear-contents" data-dock="${n}">${t("내용 초기화")}</button>`;
}
function finishContainer(n){
  const draft=state.draft;if(!draft)return;
  const old=draft.pendingContainers?.[n],row=draft.rows[n-1];if(!old)return;
  C.finishContainerEdit(draft,n);persist();
  const card=$('#dock-'+n);if(card){
    card.querySelectorAll('[data-field]').forEach(input=>{input.value=input.dataset.field==='codes'?(row.codes[Number(input.dataset.index)]||''):row[input.dataset.field];if(input.dataset.field==='contents')input.disabled=row.status==='Ready to drop';});
    const tools=$('#container-tools-'+n);if(tools)tools.innerHTML=containerTools(n);refreshMark(n);
  }
}
function discardDraft(){
  confirmAction(t("작성 내용을 취소할까요?"),state.draft.editOf?t("수정 전 저장 기록으로 돌아갑니다."):t("현재 작성 중인 점검만 버리고 최근 저장 기록으로 돌아갑니다."),t("취소하고 돌아가기"),()=>{const old=state.draft;state.draft=null;if(!persist()){state.draft=old;return;}editing=false;selected=old.editOf||null;screen='record';render();});
}
function editSaved(){
  const source=current();if(!source)return;
  const begin=()=>{const prior=state.draft;state.draft={...C.clone(source),editOf:source.id};if(!persist()){state.draft=prior;return;}editing=true;onlyChanged=false;render();};
  if(state.draft && state.draft.editOf===source.id){editing=true;render();return;}
  if(state.draft){confirmAction(t("작성 중인 점검을 취소하고 수정할까요?"),t("현재 임시 작성 내용은 버립니다. 저장된 점검 기록은 유지됩니다."),t("취소 후 이 기록 수정"),begin);}else begin();
}
function showDetails(n){
  const r=current(),row=r.rows[n-1],d=change(r,row);
  modal(`<h2>Dock ${n}</h2><p>${esc(rowSummary(row))}</p>${d.fields.length?`<span class="change-tag">${esc(t(d.label))}</span>`:''}${r.baseline?`<h3>${t("이전 점검 당시 값")}</h3><p>${esc(rowSummary(r.baseline[n-1]))}</p>`:''}<button class="wide" data-action="close">${t("닫기")}</button>`);
}
function saveCheck(){
  Object.keys(state.draft.pendingContainers||{}).forEach(n=>finishContainer(Number(n)));
  const snapshot=C.clone(state),r=state.draft;r.savedAt=new Date().toISOString();
  const index=r.editOf?state.records.findIndex(x=>x.id===r.editOf):-1;
  delete r.editOf;delete r.pendingContainers;delete r.containerUndo;delete r.undoHistory;delete r.redoHistory;undoGroup=null;
  if(index>=0)state.records[index]=r;else state.records.push(r);state.draft=null;
  if(!persist()){state=snapshot;return;}
  selected=r.id;editing=false;onlyChanged=false;render();window.scrollTo(0,0);toast(t("저장했습니다."));
}
function menu(){
  modal(`<h2>Dock Notes</h2><div class="menu-list"><button data-action="latest">${t("최신 점검")}${state.draft?` / ${t("작성 중")}`:''}</button><button data-action="history">${t("지난 점검 기록")}</button><button data-action="settings">${t("설정")}</button><button data-action="backup">${t("전체 기록 백업 (JSON)")}</button><button data-action="restore">${t("백업 복원")}</button><button data-action="all-text">${t("모든 기록 텍스트 저장")}</button><button data-action="close">${t("닫기")}</button></div><p class="smallprint">v0.3.6 · ${t("오프라인 개인 기록장")}<br>${t("실제 기록은 GitHub에 전송하지 않습니다.")}<br>${t("앱 삭제 전에는 전체 백업을 저장해 주세요.")}</p>`);
}
function renderHistory(){
  $('#app').innerHTML=`<div class="eyebrow">HISTORY</div><h1>${t("지난 점검")}</h1><p class="muted">${t('{count}개 기록 · 이전 점검과의 변경 표시를 보존합니다.',{count:state.records.length})}</p><button data-action="latest">← ${t("최신 점검")}</button>${state.records.slice().reverse().map(r=>`<button class="history-item" data-action="record" data-id="${esc(r.id)}">${esc(r.date)} · ${esc(r.time)}<small>${t('{count}곳 변경 · 기록 보기',{count:r.rows.filter(row=>change(r,row).fields.length).length})}</small></button>`).join('')||`<p class="muted">${t("저장한 점검이 없습니다.")}</p>`}`;
}
function renderSettingsHome(){
  $('#app').innerHTML=`<h1>${t('설정')}</h1><div class="menu-list"><button data-action="language-settings">${t('언어 설정')}</button><button data-action="check-settings">${t('점검 시간 · 구역 설정')}</button></div>`;
  $('#bottom').innerHTML=`<div class="footer"><div class="footer-inner"><button class="wide" data-action="leave-settings">← ${t('점검으로 돌아가기')}</button></div></div>`;
}
function renderSettings(){
  if(!settingsDraft)settingsDraft=C.clone(state.settings);
  $('#app').innerHTML=`<div class="eyebrow">PREFERENCES</div><h1>${t("점검 시간 · 구역 설정")}</h1><p class="muted">${t("변경한 설정은 다음에 만드는 점검부터 적용됩니다.")}</p><section class="settings-box"><h2>${t("점검 시간")}</h2><label>${t("시간마다 줄을 나눠 입력")}<textarea id="settings-times" rows="6">${esc(settingsDraft.times.join('\n'))}</textarea></label><p class="smallprint">${t("예: 07:30 · 마감 점검은 24:00")}<br>${t("현재 시각부터 가장 가까운 다음 점검 시간을 제안합니다.")}</p><div class="section-label">${t("근무 요일")}</div><div class="days">${[t("일"),t("월"),t("화"),t("수"),t("목"),t("금"),t("토")].map((d,i)=>`<label class="day"><input type="checkbox" data-day="${i}" ${settingsDraft.days.includes(i)?'checked':''}>${d}</label>`).join('')}</div></section><section class="settings-box"><h2>${t("구역 제목과 Dock 범위")}</h2><p class="smallprint">${t("제목 / 시작 번호 / 끝 번호")}<br>${t("Dock 1~20을 빠짐없이 순서대로 포함해 주세요.")}</p><div id="group-editors">${settingsDraft.groups.map((g,i)=>`<div class="group-edit"><input aria-label="${t('구역 {group} 이름',{group:i+1})}" data-group="${i}" data-key="name" value="${esc(g.name)}" maxlength="80"><input aria-label="${t('구역 {group} 시작 Dock',{group:i+1})}" data-group="${i}" data-key="start" type="number" min="1" max="20" value="${g.start}"><input aria-label="${t('구역 {group} 끝 Dock',{group:i+1})}" data-group="${i}" data-key="end" type="number" min="1" max="20" value="${g.end}"><button aria-label="${t('구역 {group} 삭제',{group:i+1})}" data-action="remove-group" data-index="${i}">−</button></div>`).join('')}</div><button data-action="add-group">${t("+ 구역 추가")}</button></section><p id="settings-error" class="danger" role="alert"></p><div class="notice">${t("Dunnage도 다른 Dock과 동일하게 불러옵니다. 별도 입력 제한이나 엑셀 시간 규칙은 없습니다.")}</div>`;
  if(screen==='language')$('#app').innerHTML=`<h1>${t('언어 설정')}</h1><section class="settings-box"><label>${t('언어 / Language')}<select id="settings-language"><option value="ko" ${settingsDraft.language!=='en'?'selected':''}>한국어</option><option value="en" ${settingsDraft.language==='en'?'selected':''}>English</option></select></label><p class="smallprint">${t('화면 언어를 변경해도 직접 입력한 기록과 구역 제목은 유지됩니다.')}</p></section><p id="settings-error" class="danger" role="alert"></p>`;
  $('#bottom').innerHTML=`<div class="footer"><div class="footer-inner"><button data-action="cancel-settings">${t("취소")}</button><button class="primary" data-action="save-settings">${t("설정 저장")}</button></div></div>`;
}
function captureSettings(){
  if(screen==='language'){settingsDraft.language=$('#settings-language').value;return;}
  settingsDraft.times=$('#settings-times').value.split(/[\n,]+/).map(t=>t.trim()).filter(Boolean);
  settingsDraft.days=[...document.querySelectorAll('[data-day]:checked')].map(e=>Number(e.dataset.day));
  document.querySelectorAll('[data-group]').forEach(e=>settingsDraft.groups[Number(e.dataset.group)][e.dataset.key]=e.dataset.key==='name'?e.value:Number(e.value));
}
function renderBroken(){
  $('#app').innerHTML=`<h1>${t("저장 기록 확인이 필요합니다")}</h1><p>${t("저장된 내용을 읽지 못했습니다. 기존 데이터를 덮어쓰지 않았습니다.")}</p><div class="menu-list"><button data-action="raw-backup">${t("원본 파일 보관")}</button><button data-action="restore">${t("정상 백업 복원")}</button></div>`;$('#menu').disabled=true;
}
window.receiveBackup=raw=>{
  try{
    const recovered=C.parseBackup(raw);
    confirmAction(t("백업을 복원할까요?"),t(recovered.draft?'{count}개 기록과 작성 중인 점검으로 현재 기기의 데이터를 교체합니다. 현재 기록이 필요하면 취소 후 먼저 백업해 주세요.':'{count}개 기록으로 현재 기기의 데이터를 교체합니다. 현재 기록이 필요하면 취소 후 먼저 백업해 주세요.',{count:recovered.records.length}),t("복원"),()=>{
      const old=state;state=recovered;if(!persist()){state=old;return;}
      brokenRaw=null;$('#menu').disabled=false;editing=!!state.draft;selected=null;screen='record';onlyChanged=false;render();toast(t("백업을 복원했습니다"));
    });
  }catch(e){toast(t("복원하지 않았습니다: ")+t(e.message));}
};
window.handleBack=()=>{if($('#dialog').open){closeDialog();return;}if(screen==='language'||screen==='check-settings'){confirmAction(t("설정을 닫을까요?"),t("저장하지 않은 설정 변경은 취소됩니다."),t("닫기"),()=>{settingsDraft=null;screen='settings';render();});return;}if(screen==='settings'){screen='record';render();return;}if(screen!=='broken'){screen='record';selected=null;editing=!!state.draft;onlyChanged=false;render();toast(editing?t("작성 내용은 임시 저장되어 있습니다."):t("최신 점검입니다."));}};
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,n=Number(b.dataset.dock);
  if(action==='jump-bottom'){if(editing&&screen==='record')window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});return;}
  if(action==='close'){closeDialog();return;}
  if(action==='undo'){undoEdit();return;}
  if(action==='redo'){undoEdit(true);return;}
  if(action==='next'){openNew();return;}
  if(action==='schedule'){editSchedule();return;}
  if(action==='save'){saveCheck();return;}
  if(action==='details'){showDetails(n);return;}
  if(action==='range'){readRange=b.dataset.range;render();return;}
  if(action==='discard'){discardDraft();return;}
  if(action==='number-correction'){
    remember();
    const draft=state.draft;
    if(draft.corrections.includes(n))draft.corrections=draft.corrections.filter(x=>x!==n);else draft.corrections.push(n);
    persist();refreshRow(n);return;
  }
  if(action==='clear-contents'){
    confirmAction(t("Dock {dock} 내용을 초기화할까요?",{dock:n}),t("컨테이너 번호는 유지하고 아이템 코드·내용물·상태·메모를 비웁니다. 이전 점검 기록은 유지됩니다."),t("내용 초기화"),()=>{remember();C.clearContainerContents(state.draft,n);persist();refreshRow(n);});return;
  }
  if(action==='restore-container'){
    confirmAction(t("이전 버전에서 비운 내용을 복원할까요?"),t("번호는 유지하고 현재 코드·내용물·상태·메모를 자동으로 비우기 전 내용으로 바꿉니다. 번호는 정정으로 표시합니다."),t("복원"),()=>{
      remember();const draft=state.draft,old=draft.containerUndo[n],number=draft.rows[n-1].container;
      Object.assign(draft.rows[n-1],old,{container:number});delete draft.containerUndo[n];
      if(!draft.corrections.includes(n))draft.corrections.push(n);persist();refreshRow(n);
    });return;
  }
  if(action==='delete-check'){
    const r=current();if(state.draft||r.id!==state.records[state.records.length-1]?.id)return;
    confirmAction(t("이 점검을 삭제할까요?"),t('{date} {time} 기록만 삭제하고 이전 점검으로 돌아갑니다.',{date:r.date,time:r.time}),t("점검 삭제"),()=>{const removed=state.records.pop();if(!persist()){state.records.push(removed);return;}selected=null;onlyChanged=false;render();});return;
  }
  if(action==='filter'){onlyChanged=!onlyChanged;render();return;}
  if(action==='copy'){copyRecord();return;}
  if(action==='text'){download(`dock-${current().date}-${current().time.replace(':','')}.txt`,'text/plain',C.text(current(),state.settings.language));return;}
  if(action==='edit'){editSaved();return;}
  if(action==='add-code'||action==='remove-code'){const row=state.draft.rows[n-1];remember();if(action==='add-code'&&row.codes.length<3)row.codes.push('');else if(action==='remove-code'&&row.codes.length>1)row.codes.splice(Number(b.dataset.index),1);persist();refreshRow(n);return;}
  if(action==='latest'){closeDialog();screen='record';selected=null;editing=!!state.draft;onlyChanged=false;render();window.scrollTo(0,0);return;}
  if(action==='record'){selected=b.dataset.id;editing=false;screen='record';onlyChanged=false;render();window.scrollTo(0,0);return;}
  if(action==='history'){closeDialog();screen='history';render();window.scrollTo(0,0);return;}
  if(action==='settings'){closeDialog();screen='settings';settingsDraft=null;render();window.scrollTo(0,0);return;}
  if(action==='language-settings'||action==='check-settings'){screen=action==='language-settings'?'language':'check-settings';settingsDraft=null;render();window.scrollTo(0,0);return;}
  if(action==='leave-settings'){screen='record';render();return;}
  if(action==='cancel-settings'){settingsDraft=null;screen='settings';render();return;}
  if(action==='add-group'||action==='remove-group'){captureSettings();if(action==='add-group'&&settingsDraft.groups.length<20)settingsDraft.groups.push({name:t("새 구역"),start:20,end:20});else if(action==='remove-group')settingsDraft.groups.splice(Number(b.dataset.index),1);renderSettings();return;}
  if(action==='save-settings'){
    captureSettings();try{C.validateSettings(settingsDraft);settingsDraft.times.sort((a,b)=>C.minutes(a)-C.minutes(b));const old=state.settings;state.settings=C.clone(settingsDraft);if(!persist()){state.settings=old;return;}settingsDraft=null;screen='record';render();toast(t("설정을 저장했습니다"));}catch(err){$('#settings-error').textContent=t(err.message);}return;
  }
  if(action==='backup'){download(`dock-${C.dateKey(new Date())}.dock-backup.json`,'application/json',JSON.stringify(state,null,2));return;}
  if(action==='raw-backup'){download('dock-recovery.json','application/json',brokenRaw||'');return;}
  if(action==='all-text'){download('dock-history.txt','text/plain',state.records.map(r=>C.text(r,state.settings.language)).join('\n\n────────────────\n\n'));return;}
  if(action==='restore'){closeDialog();if(native)native.importFile();else $('#import-file').click();}
});
document.addEventListener('input',e=>{
  const el=e.target,key=el.dataset.field;if(!key||key==='status'||!editing)return;
  const n=Number(el.dataset.dock),row=state.draft.rows[n-1];
  remember(n+':'+key+':'+(el.dataset.index||''));
  if(key==='container'){
    state.draft.pendingContainers=state.draft.pendingContainers||{};
    if(!state.draft.pendingContainers[n])state.draft.pendingContainers[n]=C.clone(row);
    row.container=el.value;
  }else if(key==='codes')row.codes[Number(el.dataset.index)]=el.value;else row[key]=el.value;
  if(row.status==='Ready to drop'&&(key==='container'||key==='codes')){
    if(el.value.trim()){
      // The input and its default status share the snapshot taken above.
      row.status='Full';
      $('#dock-'+n+' [data-field="status"]').value='Full';
      $('#dock-'+n+' [data-field="contents"]').disabled=false;
    }else{
      // Whitespace alone is not an arrival and must remain a valid empty row.
      if(key==='container')row.container='';else row.codes[Number(el.dataset.index)]='';
    }
  }
  persist();refreshMark(n);
});
document.addEventListener('focusout',e=>{if(e.target.dataset.field==='container'&&editing)finishContainer(Number(e.target.dataset.dock));if(e.target.dataset.field)undoGroup=null;});
document.addEventListener('keydown',e=>{
  if(!editing||screen!=='record'||$('#dialog').open||!(e.ctrlKey||e.metaKey)||e.altKey||e.isComposing)return;
  const key=e.key.toLowerCase();if(key==='z'||key==='y'){e.preventDefault();undoEdit(key==='y'||e.shiftKey);}
});
document.addEventListener('change',e=>{
  if(e.target.id==='record-switch'){
    selected=e.target.value==='draft'?null:e.target.value;editing=e.target.value==='draft'||state.draft?.editOf===selected;onlyChanged=false;render();return;
  }
  const el=e.target;if(el.dataset.field!=='status'||!editing)return;
  const n=Number(el.dataset.dock),row=state.draft.rows[n-1],value=el.value;
  if(value==='Ready to drop'&&(row.container||row.contents||row.codes.some(Boolean)||row.note)){
    el.value=row.status;
    confirmAction(t("컨테이너가 나갔나요?"),t("현재 점검의 번호·아이템 코드·내용물·메모를 비웁니다. 이전 점검 기록은 유지됩니다."),t("컨테이너 없음"),()=>{remember();Object.assign(row,{container:'',codes:[''],contents:'',note:'',status:value});if(state.draft.containerUndo)delete state.draft.containerUndo[n];if(state.draft.pendingContainers)delete state.draft.pendingContainers[n];persist();refreshRow(n);});
  }else{if(row.status!==value)remember();row.status=value;persist();refreshRow(n);}
});
$('#menu').onclick=menu;
$('#import-file').onchange=async e=>{const file=e.target.files[0];if(file){if(file.size>20*1024*1024)toast(t("백업은 20MB 이하여야 합니다."));else window.receiveBackup(await file.text());}e.target.value='';};
try{const raw=native?native.load():localStorage.getItem('dock-notes-v1');brokenRaw=raw;state=raw?C.parseBackup(raw):C.initial();brokenRaw=null;editing=!!state.draft;}
catch(e){state=C.initial();screen='broken';}
if(state.draft)Object.keys(state.draft.pendingContainers||{}).forEach(n=>finishContainer(Number(n)));
render();
if(screen==='record')openScheduledPage();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)openScheduledPage();});
