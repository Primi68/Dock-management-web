(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./i18n.js') : root.DockI18n);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DockCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(I18n) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(new Date(s+'T12:00:00')) === s;
  const validTime = s => typeof s === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s);
  const minutes = s => Number(s.slice(0,2))*60 + Number(s.slice(3));
  const statuses = ['', 'Full', 'In process', 'Empty', 'Ready to drop'];
  const blankRow = n => ({dock:n, container:'', codes:[''], contents:'', status:'', note:''});
  const defaults = () => ({
    language:'ko', times:['07:30','09:30','11:30','13:30','15:30'], days:[1,2,3,4,5],
    groups:[{name:'Tires',start:1,end:8},{name:'Dunnage',start:9,end:12},{name:'쓰레기',start:13,end:13},{name:'Wheels',start:14,end:20}]
  });
  const initial = () => ({schema:1, settings:defaults(), records:[], draft:null});
  const normalized = s => s.trim().replace(/\s+/g,' ').toUpperCase();
  const editSnapshot = r => clone({date:r.date,time:r.time,rows:r.rows,corrections:r.corrections,pendingContainers:r.pendingContainers||{},containerUndo:r.containerUndo||{}});
  function rememberEdit(r, coalesce=false){
    r.undoHistory=r.undoHistory||[];r.redoHistory=[];
    if(!coalesce || !r.undoHistory.length){r.undoHistory.push(editSnapshot(r));if(r.undoHistory.length>50)r.undoHistory.shift();}
  }
  function travelEdit(r, redo=false){
    const from=redo?'redoHistory':'undoHistory',to=redo?'undoHistory':'redoHistory';
    if(!r[from]?.length)return false;
    r[to]=r[to]||[];r[to].push(editSnapshot(r));if(r[to].length>50)r[to].shift();
    Object.assign(r,clone(r[from].pop()));return true;
  }
  function finishContainerEdit(r,n){
    const old=r.pendingContainers?.[n],row=r.rows[n-1];
    if(!old)return;
    // A number identifies the observation; entering it must never erase it.
    if(normalized(old.container)!==normalized(row.container))r.corrections=r.corrections.filter(x=>x!==n);
    delete r.pendingContainers[n];
  }
  function clearContainerContents(r,n){
    Object.assign(r.rows[n-1],{codes:[''],contents:'',status:'',note:''});
    if(r.pendingContainers)delete r.pendingContainers[n];
    if(r.containerUndo)delete r.containerUndo[n];
  }
  function diff(row, before, correction) {
    if (!before) before = blankRow(row.dock);
    const containerChanged = normalized(row.container) !== normalized(before.container);
    const arrival = containerChanged && !!row.container.trim() && !correction;
    const departure = before.status !== 'Ready to drop' && row.status === 'Ready to drop' && (!!before.container || !!before.status);
    const fields = ['container','contents','status','note'].filter(k => row[k].trim() !== before[k].trim());
    if (row.codes.map(normalized).filter(Boolean).join('|') !== before.codes.map(normalized).filter(Boolean).join('|')) fields.push('codes');
    return {whole:arrival || departure, label:arrival?'새 컨테이너':departure?'컨테이너 없음':'항목 변경', fields};
  }
  // Suggest the first scheduled check that has not passed or been recorded.
  // 24:00 keeps its business date, but expires at midnight like any other slot.
  function suggest(now, settings, records) {
    const slots=[];
    const latest=records[records.length-1];
    const anchor=latest && latest.date>dateKey(now)?new Date(latest.date+'T12:00:00'):now;
    const latestAt=latest?new Date(latest.date+'T00:00:00').getTime()+minutes(latest.time)*60000:-Infinity;
    for (let offset=-1; offset<=15; offset++) {
      const day=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()+offset,12);
      if (!settings.days.includes(day.getDay())) continue;
      for (const time of settings.times) {
        const at=new Date(day.getFullYear(),day.getMonth(),day.getDate(),0,0);
        at.setMinutes(minutes(time));
        slots.push({date:dateKey(day),time,at:at.getTime()});
      }
    }
    slots.sort((a,b)=>a.at-b.at);
    const exists=s=>records.some(r=>r.date===s.date && r.time===s.time);
    const selected=slots.find(s=>s.at>=now.getTime() && s.at>latestAt && !exists(s));
    if (!selected) throw new Error('점검 시간표를 확인해 주세요.');
    return {date:selected.date,time:selected.time};
  }
  function newRecord(state, date, time) {
    if (!validDate(date) || !validTime(time)) throw new Error('날짜와 점검 시간을 확인해 주세요.');
    if (state.records.some(r=>r.date===date && r.time===time)) throw new Error('같은 날짜와 시간의 기록이 이미 있습니다.');
    const latest=state.records[state.records.length-1];
    if (latest && `${date} ${time}` <= `${latest.date} ${latest.time}`) throw new Error('최근 점검 이후의 시간을 선택해 주세요.');
    return {
      id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9),date,time,
      createdAt:new Date().toISOString(),savedAt:null,
      groups:clone(state.settings.groups), rows:latest?clone(latest.rows):Array.from({length:20},(_,i)=>blankRow(i+1)),
      baseline:latest?clone(latest.rows):null, corrections:[]
    };
  }
  function text(record, language='ko') {
    const t=key=>I18n.translate(key,language);
    let lines=[`${record.date} · ${record.time}${record.time==='24:00'?' (close)':''}`,''];
    for (const group of record.groups) {
      lines.push(`${group.name} · Dock ${group.start}${group.start!==group.end?'~'+group.end:''}`);
      for (const row of record.rows.filter(r=>r.dock>=group.start && r.dock<=group.end)) {
        const change=diff(row,record.baseline && record.baseline[row.dock-1],record.corrections.includes(row.dock));
        const marker=change.fields.length?` [${change.whole?t(change.label):t('변경: ')+change.fields.map(f=>t({container:'번호',codes:'코드',contents:'내용물',status:'상태',note:'메모'}[f])).join(', ')}]`:'';
        lines.push([row.dock,row.container,row.codes.filter(Boolean).join(' / '),row.contents,row.status,row.note].filter(v=>v!=='').join(' ')+marker);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
  function validateSettings(s) {
    if (s && s.language!==undefined && !['ko','en'].includes(s.language)) throw new Error('지원하지 않는 언어입니다.');
    if (!s || !Array.isArray(s.times) || !s.times.length || s.times.length>24 || s.times.some(t=>!validTime(t)) || new Set(s.times).size!==s.times.length) throw new Error('중복 없는 점검 시간을 1~24개 입력해 주세요.');
    if (!Array.isArray(s.days) || !s.days.length || s.days.some(d=>!Number.isInteger(d)||d<0||d>6) || new Set(s.days).size!==s.days.length) throw new Error('근무 요일을 선택해 주세요.');
    if (!Array.isArray(s.groups) || !s.groups.length || s.groups.length>20) throw new Error('구역을 확인해 주세요.');
    let next=1;
    for (const g of s.groups) {
      if (typeof g.name!=='string' || !g.name.trim() || g.name.length>80 || g.start!==next || !Number.isInteger(g.end) || g.end<g.start || g.end>20) throw new Error('구역 범위는 중복·누락 없이 Dock 1~20 순서여야 합니다.');
      next=g.end+1;
    }
    if (next!==21) throw new Error('모든 Dock 1~20을 구역에 포함해 주세요.');
  }
  function validateRows(rows) {
    if (!Array.isArray(rows) || rows.length!==20) throw new Error('Dock 데이터가 올바르지 않습니다.');
    rows.forEach((r,i)=>{
      if (!r || r.dock!==i+1 || ['container','contents','status','note'].some(k=>typeof r[k]!=='string'||r[k].length>2000) || !statuses.includes(r.status) || !Array.isArray(r.codes) || r.codes.length<1 || r.codes.length>3 || r.codes.some(c=>typeof c!=='string'||c.length>200) || (r.status==='Ready to drop' && (r.container || r.contents || r.codes.some(Boolean)))) throw new Error('Dock 항목이 올바르지 않습니다.');
    });
  }
  function parseBackup(raw) {
    if (raw.length>20*1024*1024) throw new Error('백업 파일이 너무 큽니다.');
    let s;
    try { s=JSON.parse(raw); } catch(e) { throw new Error('백업 파일의 JSON 형식이 올바르지 않습니다.'); }
    if (!s || s.schema!==1 || !Array.isArray(s.records) || s.records.length>10000 || !(s.draft===null || typeof s.draft==='object')) throw new Error('지원하지 않는 백업 형식입니다.');
    validateSettings(s.settings);
    if(s.settings.language===undefined)s.settings.language='ko';
    // Older versions removed the original record while editing the latest one.
    // Preserve the recoverable snapshot before introducing cancellable edits.
    if(s.draft && s.draft.savedAt && !s.draft.editOf && !s.records.some(r=>r.id===s.draft.id)){
      s.records.push(clone(s.draft));s.draft.editOf=s.draft.id;
    }
    const ids=new Set(), slots=new Set(); let prior='';
    const editingOriginal=s.draft && s.draft.editOf;
    if(editingOriginal && (s.draft.id!==editingOriginal || !s.records.some(r=>r.id===editingOriginal))) throw new Error('수정 중인 원본 기록을 찾을 수 없습니다.');
    for (const r of [...s.records,...(s.draft && !editingOriginal?[s.draft]:[])]) {
      if (!r || typeof r.id!=='string' || !r.id || ids.has(r.id) || !validDate(r.date) || !validTime(r.time) || !Array.isArray(r.corrections) || r.corrections.some(n=>!Number.isInteger(n)||n<1||n>20)) throw new Error('점검 기록이 올바르지 않습니다.');
      const slot=`${r.date} ${r.time}`;
      if (slots.has(slot) || (prior && slot<=prior)) throw new Error('점검 날짜 순서 또는 중복을 확인해 주세요.');
      prior=slot; ids.add(r.id); slots.add(slot);
      validateRows(r.rows); if(r.baseline!==null) validateRows(r.baseline);
      validateSettings({...s.settings,groups:r.groups});
    }
    if(editingOriginal){
      const original=s.records.find(r=>r.id===editingOriginal);
      if(s.draft.date!==original.date || s.draft.time!==original.time)throw new Error('기존 점검의 날짜와 시간은 유지해야 합니다.');
      validateRows(s.draft.rows);if(s.draft.baseline!==null)validateRows(s.draft.baseline);
      validateSettings({...s.settings,groups:s.draft.groups});
      if(!Array.isArray(s.draft.corrections)||s.draft.corrections.some(n=>!Number.isInteger(n)||n<1||n>20))throw new Error('변경 표시가 올바르지 않습니다.');
    }
    const recoveryStates=s.draft?[s.draft]:[];
    if(s.draft)for(const key of ['undoHistory','redoHistory']){
      const history=s.draft[key];if(history===undefined)continue;
      if(!Array.isArray(history)||history.length>50)throw new Error('되돌리기 기록이 올바르지 않습니다.');
      for(const snapshot of history){
        if(!snapshot||!validDate(snapshot.date)||!validTime(snapshot.time)||!Array.isArray(snapshot.corrections)||snapshot.corrections.some(n=>!Number.isInteger(n)||n<1||n>20))throw new Error('되돌리기 항목이 올바르지 않습니다.');
        validateRows(snapshot.rows);
        if(editingOriginal&&(snapshot.date!==s.draft.date||snapshot.time!==s.draft.time))throw new Error('되돌리기 날짜가 올바르지 않습니다.');
        if(!editingOriginal&&s.records.length){const last=s.records[s.records.length-1];if(`${snapshot.date} ${snapshot.time}`<=`${last.date} ${last.time}`)throw new Error('되돌리기 시간 순서가 올바르지 않습니다.');}
        recoveryStates.push(snapshot);
      }
    }
    for(const recovery of recoveryStates)for(const key of ['pendingContainers','containerUndo']){
      const map=recovery[key];if(map===undefined)continue;
      if(!map || typeof map!=='object' || Array.isArray(map))throw new Error('번호 수정 복구 정보가 올바르지 않습니다.');
      for(const [dock,row] of Object.entries(map)){
        const n=Number(dock);if(!Number.isInteger(n)||n<1||n>20||String(n)!==dock)throw new Error('복구할 Dock 번호가 올바르지 않습니다.');
        const rows=Array.from({length:20},(_,i)=>blankRow(i+1));rows[n-1]=row;validateRows(rows);
      }
    }
    return s;
  }
  return {clone,dateKey,validDate,validTime,minutes,statuses,blankRow,defaults,initial,normalized,editSnapshot,rememberEdit,travelEdit,finishContainerEdit,clearContainerContents,diff,suggest,newRecord,text,validateSettings,parseBackup};
});
