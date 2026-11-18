// 페이지 안 대화상자 (confirm/alert 대신: 일부 환경에서 브라우저 팝업이 막혀 있음)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function open(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  return wrap;
}

export function ask(message, { ok = '확인', danger = false } = {}) {
  return new Promise(resolve => {
    const m = open(`
      <p class="msg">${esc(message)}</p>
      <div class="actions two">
        <button type="button" class="btn" data-r="0">취소</button>
        <button type="button" class="btn ${danger ? 'wrong' : 'primary'}" data-r="1">${esc(ok)}</button>
      </div>`);
    const done = v => { m.remove(); resolve(v); };
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (b) done(b.dataset.r === '1');
      else if (e.target === m) done(false);
    });
    m.querySelector('[data-r="1"]').focus();
  });
}

export function notice(message) { return ask(message, { ok: '닫기' }).then(() => {}); }

// JSON 내보내기: 복사 버튼 + (가능한 환경에서) 파일 저장
export function showExport(filename, obj) {
  const text = JSON.stringify(obj, null, 1);
  const m = open(`
    <h2 style="margin:0 0 8px;font-size:16px">${esc(filename)}</h2>
    <p class="muted small" style="margin:0 0 8px">복사해서 메모 앱 등에 보관하거나, 파일로 저장하세요. 나중에 '불러오기'에서 붙여넣거나 파일을 고르면 복원됩니다.</p>
    <textarea class="inp" id="exp-text" readonly style="min-height:160px;font-size:12px;font-family:ui-monospace,monospace">${esc(text)}</textarea>
    <div class="row" style="margin-top:10px">
      <button type="button" class="btn primary grow" id="exp-copy">복사</button>
      <button type="button" class="btn grow" id="exp-file">파일로 저장</button>
      <button type="button" class="btn" id="exp-close">닫기</button>
    </div>
    <p class="muted small" id="exp-msg" style="margin:8px 0 0"></p>`);
  const ta = m.querySelector('#exp-text'), msg = m.querySelector('#exp-msg');
  m.querySelector('#exp-close').onclick = () => m.remove();
  m.querySelector('#exp-copy').onclick = () => {
    navigator.clipboard.writeText(text).then(
      () => (msg.textContent = '복사했어요.'),
      () => { ta.focus(); ta.select(); msg.textContent = '자동 복사가 안 돼요. 선택된 글을 길게 눌러 복사하세요.'; });
  };
  m.querySelector('#exp-file').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    msg.textContent = '저장이 안 되면 "복사"를 쓰세요. (미리보기 화면에서는 파일 저장이 막혀 있어요)';
  };
}

// JSON 불러오기: 파일 선택 또는 붙여넣기
export function showImport(onText) {
  const m = open(`
    <h2 style="margin:0 0 8px;font-size:16px">JSON 불러오기</h2>
    <label class="btn" style="display:block;text-align:center">파일 고르기<input type="file" id="imp-file" accept=".json,application/json" hidden></label>
    <p class="muted small" style="margin:10px 0 4px">또는 JSON 내용을 붙여넣기</p>
    <textarea class="inp" id="imp-text" style="min-height:120px;font-size:12px;font-family:ui-monospace,monospace"></textarea>
    <div class="row" style="margin-top:10px">
      <button type="button" class="btn primary grow" id="imp-go">불러오기</button>
      <button type="button" class="btn" id="imp-close">닫기</button>
    </div>`);
  const close = () => m.remove();
  m.querySelector('#imp-close').onclick = close;
  m.querySelector('#imp-go').onclick = () => { const t = m.querySelector('#imp-text').value.trim(); if (t) { close(); onText(t); } };
  m.querySelector('#imp-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { close(); onText(r.result); };
    r.readAsText(f);
  };
}
