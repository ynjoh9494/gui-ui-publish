/** Google Sheets > 확장 프로그램 > Apps Script에 전체 붙여넣기. */
const EDIT_SHEET = '문구 편집';
const SOURCE_SHEET = 'SOURCE';
const GROUPS = ['ESTIMATE_LABEL','UI_ESTIMATE_LABEL','STATUS_LABEL','WORK_LABEL','INDICATOR_LABEL','COPY'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('COPY 도구')
    .addItem('copy.ts 가져오기 (내 컴퓨터)', 'showImportDialog')
    .addItem('copy.ts 가져오기 (Google Drive)', 'importFromDrivePrompt')
    .addSeparator()
    .addItem('변경 여부 수식 복구', 'repairStatusFormulas')
    .addItem('copy.ts 내보내기', 'exportCopyTs')
    .addToUi();
}

function showImportDialog() {
  const html = HtmlService.createHtmlOutput(`<!doctype html><html><head><base target="_top"><style>
    body{font:14px Arial,sans-serif;padding:18px;color:#243247} p{line-height:1.5} button{padding:10px 16px;cursor:pointer}
    input{width:100%;margin:12px 0} #msg{white-space:pre-wrap;margin-top:12px}
    </style></head><body><h3>copy.ts 가져오기</h3>
    <p>로컬의 <b>copy.ts</b> 파일을 선택하세요. 시트에서 편집 중인 문구는 유지하며, 원본이 달라진 경우 충돌을 표시합니다.</p>
    <input type="file" id="file" accept=".ts,.txt,text/plain" />
    <button id="start" onclick="upload()">가져오기</button><div id="msg"></div>
    <script>function upload(){let f=document.getElementById('file').files[0];if(!f){alert('파일을 선택하세요.');return;}
      let btn=document.getElementById('start');btn.disabled=true;document.getElementById('msg').textContent='읽는 중…';
      let reader=new FileReader();reader.onload=()=>google.script.run.withSuccessHandler(r=>{document.getElementById('msg').textContent=r;btn.disabled=false;})
        .withFailureHandler(e=>{document.getElementById('msg').textContent='오류: '+e.message;btn.disabled=false;})
        .importCopyTsText(reader.result,f.name);
      reader.onerror=()=>{document.getElementById('msg').textContent='파일을 읽지 못했습니다.';btn.disabled=false;};
      reader.readAsText(f,'UTF-8');}</script></body></html>`).setWidth(480).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, 'copy.ts 불러오기');
}

function importFromDrivePrompt() {
  const ui=SpreadsheetApp.getUi();
  const response=ui.prompt('Drive에서 가져오기','Google Drive의 copy.ts 파일 링크 또는 파일 ID를 입력하세요.',ui.ButtonSet.OK_CANCEL);
  if(response.getSelectedButton()!==ui.Button.OK) return;
  const input=response.getResponseText().trim();
  const match=input.match(/\/d\/([\w-]+)/) || input.match(/[?&]id=([\w-]+)/);
  const id=match?match[1]:input;
  const file=DriveApp.getFileById(id);
  ui.alert(importCopyTsText(file.getBlob().getDataAsString('UTF-8'), file.getName()));
}

/** 현재 시트의 수정사항은 보존. 같은 항목 원본이 외부에서 수정됐으면 충돌 표시. */
function importCopyTsText(text, filename) {
  if(!/\.ts$|\.txt$/i.test(filename||'')) throw Error('TypeScript 또는 텍스트 파일을 선택하세요.');
  const incomingLines=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  if(incomingLines[incomingLines.length-1]==='') incomingLines.pop();
  const incoming=parseCopyEntries(incomingLines);
  if(incoming.length<1) throw Error('인식 가능한 문구가 없습니다. copy.ts를 확인하세요.');
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const edit=ss.getSheetByName(EDIT_SHEET) || ss.insertSheet(EDIT_SHEET);
  const source=ss.getSheetByName(SOURCE_SHEET) || ss.insertSheet(SOURCE_SHEET);
  const oldRows=edit.getLastRow()>1 ? edit.getRange(2,1,edit.getLastRow()-1,8).getValues():[];
  const lookup=new Map();
  oldRows.forEach(r=>{if(r[0] && r[1])lookup.set(r[0]+'\u0000'+r[1],r);});
  let kept=0,conflicts=0,added=0;
  const out=incoming.map(e=>{
    const old=lookup.get(e.group+'\u0000'+e.key);
    let update=e.value, syncState='';
    if(old){
      const oldBase=String(old[2]??'');const oldEdit=String(old[3]??'');
      const edited=oldEdit!==oldBase;
      if(edited){update=oldEdit; kept++;syncState=(oldBase!==e.value || old[7]==='충돌 확인')?'충돌 확인':'';if(syncState==='충돌 확인')conflicts++;}
    } else added++;
    return [e.group,e.key,e.value,update,'',e.line,e.note,syncState];
  });
  // 중요: 원본과 맞지 않는 변경을 조용히 삭제하지 않도록 별도로 보관.
  const incomingKeys=new Set(incoming.map(e=>e.group+'\u0000'+e.key));
  const orphaned=oldRows.filter(r=>r[0]&&r[1]&&!incomingKeys.has(r[0]+'\u0000'+r[1]) && String(r[2]??'')!==String(r[3]??''));
  orphaned.forEach(r=>out.push([r[0],r[1],r[2],r[3],'',r[5],r[6],'원본에서 삭제됨']));
  const oldN=Math.max(edit.getLastRow(),1);
  if(oldN>1)edit.getRange(2,1,oldN-1,8).clearContent();
  edit.getRange(1,1,1,8).setValues([['구분','항목 ID','원본 문구','수정 문구','변경 여부','원본 행','참고 · 위치','동기화 확인']]);
  if(out.length) {
    edit.getRange(2,1,out.length,8).setValues(out);
    // E열은 편집 여부 계산식. 가져오기가 텍스트 값으로 덮어쓰지 않도록 매번 복원한다.
    const formulas=out.map((_,i)=>{const row=i+2;return ['=IF(H'+row+'="충돌 확인","충돌 확인",IF(H'+row+'="원본에서 삭제됨","원본에서 삭제됨",IF(C'+row+'=D'+row+',"원본 유지","수정됨")))'];});
    edit.getRange(2,5,out.length,1).setFormulas(formulas);
  }
  edit.setFrozenRows(1);edit.getRange(1,1,1,7).setFontWeight('bold').setBackground('#24384d').setFontColor('#ffffff');
  const previousFilter=edit.getFilter(); if(previousFilter) previousFilter.remove();
  edit.getRange(1,1,out.length+1,8).createFilter();
  edit.setColumnWidth(1,175);edit.setColumnWidth(2,180);edit.setColumnWidth(3,400);edit.setColumnWidth(4,400);
  edit.setColumnWidth(5,140);edit.setColumnWidth(6,90);edit.setColumnWidth(7,290);edit.setColumnWidth(8,145);
  if(out.length) edit.getRange(2,3,out.length,2).setWrap(true);
  source.clearContents();
  source.getRange(1,1,1,2).setValues([['원본 행','copy.ts 원본 코드']]);
  source.getRange(2,1,incomingLines.length,2).setValues(incomingLines.map((s,i)=>[i+1,s]));
  return '가져오기 완료: '+incoming.length+'개 문구 / 새 항목 '+added+'개 / 기존 수정 보존 '+kept+'개 / 충돌 '+conflicts+'개 / 삭제 항목의 수정 보존 '+orphaned.length+'개.\n충돌 확인 항목은 수정 문구를 검토하세요.';
}

function parseCopyEntries(lines) {
  const result=[];let group='';
  lines.forEach((line,i)=>{
    const g=line.match(/^export const\s+(ESTIMATE_LABEL|UI_ESTIMATE_LABEL|STATUS_LABEL|WORK_LABEL|INDICATOR_LABEL|COPY)\b/);
    if(g)group=g[1];
    if(!GROUPS.includes(group) || /^\s*\/\//.test(line)) return;
    const rx=/(?:^|[,{\s])([\w$-]+|'[^']+'|"[^"]+")\s*:\s*(['"])/g;
    let m;
    while((m=rx.exec(line))!==null){
      const key=m[1].replace(/^['"]|['"]$/g,'');const quote=m[2];
      let p=rx.lastIndex,raw='';let found=false;
      for(;p<line.length;p++){
        const ch=line[p];
        if(ch==='\\'&&p+1<line.length){raw+=ch+line[++p];continue;}
        if(ch===quote){found=true;break;}
        raw+=ch;
      }
      if(!found)continue;
      rx.lastIndex=p+1;
      result.push({group,key,value:unescapeJsString(raw),line:i+1,note:''});
    }
  });
  return result;
}
function unescapeJsString(s){return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[nrt\\'"0])/g,(_,x)=>{
  if(x[0]==='u'||x[0]==='x')return String.fromCharCode(parseInt(x.slice(1),16));
  return {n:'\n',r:'\r',t:'\t','\\':'\\',"'":"'",'"':'"','0':'\0'}[x];
});}
function exportCopyTs() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();const edit=ss.getSheetByName(EDIT_SHEET),source=ss.getSheetByName(SOURCE_SHEET);
  if(!edit||!source||source.getLastRow()<2)throw Error('먼저 copy.ts를 가져오세요.');
  const rows=edit.getLastRow()>1?edit.getRange(2,1,edit.getLastRow()-1,8).getValues():[];
  const lines=source.getRange(2,2,source.getLastRow()-1,1).getValues().map(r=>String(r[0]??''));
  let changed=0;
  for(const [group,key,original,updated,status,n] of rows){
    if(!key||String(original)===String(updated))continue;
    if(status==='충돌 확인'||status==='원본에서 삭제됨')throw Error('충돌 또는 삭제된 원본 항목을 먼저 처리하세요: '+group+' / '+key);
    const idx=Number(n)-1;if(!Number.isInteger(idx)||idx<0||idx>=lines.length)throw Error('원본 행 오류: '+key);
    lines[idx]=replaceValue(lines[idx],key,String(original),String(updated),idx+1);changed++;
  }
  const file=DriveApp.createFile(Utilities.newBlob(lines.join('\n')+'\n','text/plain','copy.ts'));
  SpreadsheetApp.getUi().alert('내보내기 완료: '+changed+'개 수정 반영\n'+file.getUrl());
}
function replaceValue(line,key,oldValue,nextValue,n){
  const esc=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rx=new RegExp('(?:^|[,{\\s])(?:'+esc+'|["\\\']'+esc+'["\\\'])\\s*:\\s*(["\\\'])','g');
  let m,found=[];
  while((m=rx.exec(line))!==null){
    const quote=m[1];const start=rx.lastIndex;let end=start;
    while(end<line.length){if(line[end]==='\\'){end+=2;continue;}if(line[end]===quote)break;end++;}
    if(unescapeJsString(line.slice(start,end))===oldValue)found.push({start,end,quote});
  }
  if(found.length!==1)throw Error('일치하지 않는 항목: '+key+' (행 '+n+')');
  const f=found[0];const escaped=nextValue.replace(/\\/g,'\\\\').replace(/\r/g,'\\r').replace(/\n/g,'\\n')
    .replace(new RegExp(f.quote==='"'?'"':"'",'g'),'\\'+f.quote);
  return line.slice(0,f.start)+escaped+line.slice(f.end);
}

/** 기존 불러오기에서 텍스트로 바뀐 E열을 재가져오기 없이 복구한다. */
function repairStatusFormulas() {
  const edit=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EDIT_SHEET);
  if(!edit) throw Error('문구 편집 시트를 찾지 못했습니다.');
  const n=edit.getLastRow()-1;
  if(n<1) return;
  edit.getRange(1,8).setValue('동기화 확인');
  const current=edit.getRange(2,1,n,8).getValues();
  // 구버전에서 E열에 적힌 충돌/삭제 경고를 H열로 이관한다.
  const flags=current.map(r=>[r[7]||(['충돌 확인','원본에서 삭제됨'].includes(r[4])?r[4]:'')]);
  edit.getRange(2,8,n,1).setValues(flags);
  edit.getRange(2,5,n,1).setFormulas(current.map((_,i)=>{const r=i+2;return ['=IF(H'+r+'="충돌 확인","충돌 확인",IF(H'+r+'="원본에서 삭제됨","원본에서 삭제됨",IF(C'+r+'=D'+r+',"원본 유지","수정됨")))'];}));
  SpreadsheetApp.getUi().alert('변경 여부 E열의 수식 '+n+'개를 복구했습니다.');
}
