import { store } from './store.js';
import { Pad } from './pad.js';
import { buildQueue, countDue, nextProgress, INTERVAL_LABEL, BOXES } from './leitner.js';
import { graders, getGrader } from './grader.js';
import { ask, notice, showExport, showImport } from './ui.js';
import { streakInfo, dateKey, addDays, parseKey } from './streak.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

let pad, freePad;
let view = 'study';
let sess = null;      // 진행 중인 학습 { queue, i, results, retried:Set, label }
let peekTimer = null;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------------- 공통: 모드 스위치 / 탭 ---------------- */
function renderMode() {
  $$('.seg button').forEach(b => {
    const on = b.dataset.mode === store.settings.mode;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  });
}
$$('.seg button').forEach(b => b.addEventListener('click', () => {
  if (store.settings.mode === b.dataset.mode) return;
  store.setSetting('mode', b.dataset.mode);
  renderMode();
  if (sess && !sess.revealed) showQuestion(); // 현재 문제를 새 방식으로 다시
  else if (view === 'study' && !sess) renderSetup();
}));

function go(v) {
  view = v;
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(el => (el.hidden = el.id !== 'view-' + v));
  if (v === 'study') { if (!sess) renderSetup(); }
  if (v === 'words') renderWords();
  if (v === 'stats') renderStats();
  if (v === 'settings') renderSettings();
  if (v === 'practice') renderPractice();
  $('main').scrollTop = 0;
}
$$('.tabbar button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));

/* ---------------- 학습: 시작 화면 ---------------- */
function selectedWords() {
  const sel = store.settings.selected;
  const all = store.allWords();
  return sel.length ? all.filter(w => sel.includes(w.sessionId)) : all;
}

function renderSetup() {
  $('#study-card').hidden = true; $('#study-summary').hidden = true;
  const el = $('#study-setup'); el.hidden = false;
  const sel = store.settings.selected;
  const words = selectedWords();
  const due = countDue(words, id => store.prog(id));
  const s = store.settings;
  const modeText = s.mode === 'meaning' ? '한국어 뜻을 보고 러시아어로 씁니다.' : `러시아어를 ${s.showSeconds}초 보여준 뒤 가리면, 기억해서 씁니다.`;

  el.innerHTML = `
    ${streakBanner()}
    <div class="panel">
      <h2>회차 선택</h2>
      <div class="chips" id="chips">
        <button type="button" class="chip ${sel.length ? '' : 'on'}" data-id="">전체<small>${store.allWords().length}</small></button>
        ${store.sessions.map(x => `<button type="button" class="chip ${sel.includes(x.id) ? 'on' : ''}" data-id="${esc(x.id)}">${esc(x.title)}<small>${x.words.length}</small></button>`).join('')}
      </div>
    </div>
    <div class="panel">
      <h2>${s.mode === 'meaning' ? '뜻 모드' : '글자 모드'}</h2>
      <p class="muted small" style="margin:0 0 10px">${modeText}</p>
      ${s.mode === 'letters' ? `
        <label class="field">보여주는 시간: <b id="sec-v">${s.showSeconds}초</b>
          <input type="range" id="sec" min="1" max="5" step="0.5" value="${s.showSeconds}">
        </label>` : ''}
      <div class="big-stats" style="margin:12px 0">
        <div><b>${due}</b><span>복습할 단어</span></div>
        <div><b>${words.length}</b><span>선택한 단어</span></div>
        <div><b>${s.sessionSize || '전체'}</b><span>한 번에</span></div>
      </div>
      <div class="stack">
        <button type="button" class="btn primary big" id="start-due" ${due ? '' : 'disabled'}>복습 시작${due ? ` (${Math.min(due, s.sessionSize || due)}개)` : ''}</button>
        <button type="button" class="btn big" id="start-all" ${words.length ? '' : 'disabled'}>전체에서 섞어 연습</button>
      </div>
      ${!due && words.length ? '<p class="muted small" style="margin:10px 0 0">지금 복습할 단어가 없어요. 틀린 단어는 다음에 더 자주 나옵니다.</p>' : ''}
      ${!words.length ? '<p class="muted small">단어 탭에서 단어를 추가하세요.</p>' : ''}
    </div>`;

  $$('#chips .chip').forEach(c => c.addEventListener('click', () => {
    const id = c.dataset.id;
    let next = [...store.settings.selected];
    if (!id) next = [];
    else next = next.includes(id) ? next.filter(x => x !== id) : [...next, id];
    store.setSetting('selected', next);
    renderSetup();
  }));
  const sec = $('#sec');
  if (sec) sec.addEventListener('input', () => { store.setSetting('showSeconds', +sec.value); $('#sec-v').textContent = sec.value + '초'; });
  $('#start-due').addEventListener('click', () => startSession(buildQueue(words, id => store.prog(id), { size: s.sessionSize, onlyDue: true }), '복습'));
  $('#start-all').addEventListener('click', () => startSession(buildQueue(words, id => store.prog(id), { size: s.sessionSize, onlyDue: false }), '연습'));
}

/* ---------------- 학습: 문제 진행 ---------------- */
function startSession(queue, label) {
  if (!queue.length) return toast('출제할 단어가 없어요.');
  sess = { queue: queue.map(w => ({ w, retry: false })), i: 0, results: [], retried: new Set(), label, revealed: false };
  if (view !== 'study') go('study');
  $('#study-setup').hidden = true; $('#study-summary').hidden = true; $('#study-card').hidden = false;
  pad.resize();
  showQuestion();
}

function cur() { return sess.queue[sess.i]; }

function showQuestion() {
  clearTimeout(peekTimer);
  const { w, retry } = cur();
  const s = store.settings, p = store.prog(w.id);
  sess.revealed = false;
  $('#study-card').classList.remove('revealed');
  pad.setFit(false); pad.clear(); pad.cleared = null; pad.setEnabled(true);
  $('#pad-overlay').hidden = true;
  $('#actions-ask').hidden = false; $('#actions-grade').hidden = true;
  $('#tools').hidden = false;

  const total = sess.queue.length;
  $('#q-progress').style.width = pct(sess.i, total) + '%';
  $('#q-count').textContent = `${sess.i + 1} / ${total}`;
  const sname = store.session(w.sessionId)?.title || '';
  $('#q-info').textContent = `${sname} · ${p.box ? '박스 ' + p.box : '새 단어'}${retry ? ' · 다시 한 번' : ''}`;

  const pr = $('#prompt');
  pr.classList.remove('answer');
  if (s.mode === 'meaning') {
    $('#btn-peek').hidden = true;
    pr.innerHTML = `
      <div class="label">뜻을 보고 러시아어로 쓰세요</div>
      <div class="q">${esc(w.ko)}</div>
      <button type="button" class="link small" id="btn-hint">힌트 보기</button>
      <div class="hint" id="hint" hidden>첫 글자: <b class="ru">${esc(stripStress(w.ru)[0])}</b> · ${stripStress(w.ru).replace(/[^\p{L}]/gu, '').length}글자${w.pron ? ` · 발음 ${esc(w.pron)}` : ''}</div>`;
    $('#btn-hint').addEventListener('click', e => { $('#hint').hidden = false; e.target.hidden = true; });
  } else {
    $('#btn-peek').hidden = false;
    peek();
  }
}

// 글자 모드: 단어를 N초 보여준 뒤 가리기
function peek() {
  const { w } = cur();
  const sec = store.settings.showSeconds;
  const pr = $('#prompt');
  clearTimeout(peekTimer);
  pad.setEnabled(false);
  $('#pad-overlay').hidden = false;
  $('#btn-peek').disabled = true;
  pr.innerHTML = `
    <div class="label">잘 보고 기억하세요</div>
    <div class="q ru">${esc(w.ru)}</div>
    <div class="timer"><i id="timer-i"></i></div>`;
  const bar = $('#timer-i');
  bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: sec * 1000, easing: 'linear', fill: 'forwards' });
  if (cur().peeks === undefined) cur().peeks = 0;
  peekTimer = setTimeout(() => {
    if (!sess || sess.revealed) return;
    cur().peeks++;
    pr.innerHTML = `
      <div class="label">기억해서 쓰세요</div>
      <div class="q hidden-word">${'•'.repeat(Math.min(12, Math.max(3, stripStress(w.ru).length)))}</div>
      <div class="sub small">${cur().peeks > 1 ? `다시 보기 ${cur().peeks - 1}회` : '&nbsp;'}</div>`;
    pad.setEnabled(true);
    $('#pad-overlay').hidden = true;
    $('#btn-peek').disabled = false;
  }, sec * 1000);
}

async function reveal() {
  if (!sess || sess.revealed) return;
  clearTimeout(peekTimer);
  sess.revealed = true;
  const { w } = cur();
  pad.setEnabled(false);
  $('#pad-overlay').hidden = true;
  $('#study-card').classList.add('revealed');
  $('#tools').hidden = true;
  $('#actions-ask').hidden = true; $('#actions-grade').hidden = false;
  const pr = $('#prompt');
  pr.classList.add('answer');
  pr.innerHTML = `
    <div class="label">정답</div>
    <div class="q ru">${esc(w.ru)}</div>
    <div class="sub">${esc(w.ko)}${w.pron ? ` · <span class="small">[${esc(w.pron)}]</span>` : ''}</div>
    ${w.ex ? `<div class="ex"><span class="ru">${esc(w.ex)}</span>${w.exKo ? `<div class="muted small">${esc(w.exKo)}</div>` : ''}</div>` : ''}
    <div class="ai" id="ai" hidden></div>`;
  pad.setFit(true); // 정답 칸 때문에 필기 영역이 줄어도 전체가 보이도록 축소·가운데 정렬
  requestAnimationFrame(() => pad.resize());

  // 자동 채점(나중에): 결과는 제안으로만 표시, 최종 판단은 사용자
  const g = getGrader(store.settings.grader);
  if (g.id !== 'manual' && !pad.isEmpty()) {
    const ai = $('#ai'); ai.hidden = false; ai.textContent = 'AI 채점 중…';
    try {
      const r = await g.grade({ image: pad.toDataURL(), word: w }, store.settings);
      if (r) ai.innerHTML = `AI 판단: <b>${r.correct ? '맞음' : '틀림'}</b>${r.read ? ` · 읽은 글자 "${esc(r.read)}"` : ''}`;
    } catch (e) { ai.textContent = 'AI 채점 실패: ' + e.message; }
  }
}

function grade(ok) {
  if (!sess || !sess.revealed) return;
  const item = cur();
  const { w } = item;
  if (!item.retry) {
    store.record(w.id, ok, store.settings.mode, nextProgress(store.prog(w.id), ok));
    checkIn();
    sess.results.push({ w, ok });
  }
  // 틀린 단어는 이번 학습 안에서도 몇 문제 뒤에 한 번 더
  if (!ok && !sess.retried.has(w.id)) {
    sess.retried.add(w.id);
    const pos = Math.min(sess.queue.length, sess.i + 4);
    sess.queue.splice(pos, 0, { w, retry: true });
  }
  sess.i++;
  if (sess.i >= sess.queue.length) return finish();
  showQuestion();
}

function finish() {
  clearTimeout(peekTimer);
  const r = sess.results;
  const right = r.filter(x => x.ok).length;
  const wrong = r.filter(x => !x.ok);
  const label = sess.label;
  sess = null;
  $('#study-card').hidden = true;
  const el = $('#study-summary'); el.hidden = false;
  el.innerHTML = `
    <div class="panel">
      <h2>${esc(label)} 완료</h2>
      <div class="summary-score">${pct(right, r.length)}%</div>
      <p class="muted" style="text-align:center;margin:0 0 12px">${r.length}개 중 ${right}개 맞음</p>
      ${wrong.length ? `<h3>틀린 단어</h3><ul class="list">${wrong.map(x => `<li><div class="w"><b>${esc(x.w.ru)}</b><div>${esc(x.w.ko)}</div></div></li>`).join('')}</ul>` : '<p style="text-align:center">모두 맞았어요! 🎉</p>'}
      <div class="stack" style="margin-top:12px">
        ${wrong.length ? '<button type="button" class="btn primary big" id="again-wrong">틀린 단어 다시 풀기</button>' : ''}
        <button type="button" class="btn big" id="back-setup">처음으로</button>
      </div>
    </div>`;
  $('#back-setup').addEventListener('click', renderSetup);
  const aw = $('#again-wrong');
  if (aw) aw.addEventListener('click', () => startSession(wrong.map(x => x.w), '틀린 단어 연습'));
}

$('#btn-undo').addEventListener('click', () => pad.undo());
$('#btn-clear').addEventListener('click', () => pad.clear());
$('#btn-peek').addEventListener('click', peek);
$('#btn-reveal').addEventListener('click', reveal);
$('#btn-right').addEventListener('click', () => grade(true));
$('#btn-wrong').addEventListener('click', () => grade(false));
$('#btn-quit').addEventListener('click', () => {
  if (sess.results.length) finish();
  else { clearTimeout(peekTimer); sess = null; renderSetup(); }
});

function stripStress(s) { return s.normalize('NFD').replace(/́/g, '').normalize('NFC'); }

/* ---------------- 단어 관리 ---------------- */
let openSession = null;

function renderWords() {
  const el = $('#view-words');
  const nextNo = store.sessions.length + 1;
  el.innerHTML = `
    <div class="panel">
      <h2>새 회차 추가</h2>
      <div class="row">
        <input class="inp grow" id="ns-title" placeholder="회차 이름" value="Day ${nextNo}">
        <input class="inp" id="ns-date" type="date" value="${today()}" style="width:auto">
      </div>
      <input class="inp" id="ns-sub" placeholder="주제 (선택)" style="margin-top:8px">
      <button type="button" class="btn primary" id="ns-add" style="margin-top:8px;width:100%">회차 만들기</button>
    </div>
    ${store.sessions.map(s => sessionBlock(s)).join('') || '<p class="muted">회차가 없어요.</p>'}
    <div class="panel">
      <h2>JSON 파일</h2>
      <p class="muted small" style="margin-top:0">단어 데이터를 JSON으로 내보내거나 불러옵니다. (학습 기록까지 백업하려면 설정 탭)</p>
      <div class="row">
        <button type="button" class="btn" id="w-export">단어 JSON 내보내기</button>
        <button type="button" class="btn" id="w-import">JSON 불러오기</button>
      </div>
    </div>`;

  $('#ns-add').addEventListener('click', () => {
    const title = $('#ns-title').value.trim();
    if (!title) return toast('회차 이름을 입력하세요.');
    const s = store.addSession({ title, date: $('#ns-date').value, subtitle: $('#ns-sub').value.trim() });
    openSession = s.id;
    renderWords();
    toast('회차를 만들었어요. 단어를 추가하세요.');
  });
  $$('details.sess').forEach(d => d.addEventListener('toggle', () => { if (d.open) openSession = d.dataset.id; }));
  $$('[data-act]', el).forEach(b => b.addEventListener('click', onWordAction));
  $('#w-export').addEventListener('click', () => showExport(`russian-words-${today()}.json`, store.data));
  $('#w-import').addEventListener('click', () => showImport(t => importText(t, renderWords)));
}

function sessionBlock(s) {
  const words = s.words;
  const stats = words.reduce((a, w) => { const p = store.prog(w.id); a.c += p.correct; a.t += p.correct + p.wrong; return a; }, { c: 0, t: 0 });
  return `
  <details class="sess" data-id="${esc(s.id)}" ${openSession === s.id ? 'open' : ''}>
    <summary>
      <div class="sess-title"><b>${esc(s.title)}</b><span>${[s.date, s.subtitle, words.length + '단어'].filter(Boolean).map(esc).join(' · ')}</span></div>
      ${stats.t ? `<span class="badge">${pct(stats.c, stats.t)}%</span>` : ''}
    </summary>
    <div class="body">
      <div class="row">
        <input class="inp grow" data-f="title" value="${esc(s.title)}" aria-label="회차 이름">
        <input class="inp" data-f="date" type="date" value="${esc(s.date)}" style="width:auto" aria-label="날짜">
      </div>
      <input class="inp" data-f="subtitle" value="${esc(s.subtitle || '')}" placeholder="주제 (선택)" style="margin-top:8px">
      <div class="row" style="margin-top:8px">
        <button type="button" class="btn sm" data-act="save-sess" data-s="${esc(s.id)}">회차 정보 저장</button>
        <button type="button" class="btn sm" data-act="study-sess" data-s="${esc(s.id)}" ${words.length ? '' : 'disabled'}>이 회차 연습</button>
        <button type="button" class="btn sm danger" data-act="del-sess" data-s="${esc(s.id)}">회차 삭제</button>
      </div>

      <h3>단어 추가</h3>
      <div class="stack">
        <input class="inp" data-n="ru" placeholder="러시아어 (필수)" lang="ru" autocapitalize="off" autocomplete="off" spellcheck="false">
        <input class="inp" data-n="ko" placeholder="한국어 뜻 (필수)">
        <input class="inp" data-n="ex" placeholder="예문 (선택)" lang="ru">
        <input class="inp" data-n="exKo" placeholder="예문 뜻 (선택)">
        <input class="inp" data-n="pron" placeholder="발음 (선택)">
        <button type="button" class="btn primary" data-act="add-word" data-s="${esc(s.id)}">단어 추가</button>
      </div>
      <details style="margin-top:10px">
        <summary class="muted small" style="cursor:pointer">여러 개 한 번에 붙여넣기</summary>
        <p class="muted small">한 줄에 한 단어: <code>러시아어 | 뜻 | 예문 | 예문 뜻 | 발음</code><br>엑셀에서 복사한 표(탭 구분)도 그대로 붙여넣을 수 있어요.</p>
        <textarea class="inp" data-n="bulk" placeholder="привет | 안녕&#10;спасибо | 감사합니다"></textarea>
        <button type="button" class="btn" data-act="bulk-add" data-s="${esc(s.id)}" style="margin-top:8px;width:100%">붙여넣은 단어 추가</button>
      </details>

      <h3>단어 목록 (${words.length})</h3>
      <ul class="list">
        ${words.map(w => {
          const p = store.prog(w.id);
          return `<li>
            <div class="w"><b>${esc(w.ru)}</b><div>${esc(w.ko)}${w.ex ? ` · <i>${esc(w.ex)}</i>` : ''}</div></div>
            <span class="badge">${p.box ? '박스 ' + p.box : '새'}</span>
            <button type="button" class="iconbtn" data-act="del-word" data-s="${esc(s.id)}" data-w="${esc(w.id)}" aria-label="삭제">🗑</button>
          </li>`;
        }).join('') || '<li class="muted">아직 단어가 없어요.</li>'}
      </ul>
    </div>
  </details>`;
}

async function onWordAction(e) {
  const b = e.currentTarget;
  const sid = b.dataset.s;
  const box = b.closest('details.sess');
  openSession = sid;
  switch (b.dataset.act) {
    case 'save-sess': {
      const v = f => $(`[data-f="${f}"]`, box).value.trim();
      if (!v('title')) return toast('회차 이름을 입력하세요.');
      store.updateSession(sid, { title: v('title'), date: v('date'), subtitle: v('subtitle') });
      toast('저장했어요.'); renderWords(); break;
    }
    case 'del-sess': {
      const s = store.session(sid);
      if (!(await ask(`'${s.title}' 회차와 단어 ${s.words.length}개, 학습 기록을 삭제할까요?`, { ok: '삭제', danger: true }))) return;
      store.deleteSession(sid); openSession = null; renderWords(); break;
    }
    case 'study-sess':
      startSession(buildQueue(store.session(sid).words.map(w => ({ ...w, sessionId: sid })), id => store.prog(id), { size: 0, onlyDue: false }), store.session(sid).title + ' 연습');
      break;
    case 'add-word': {
      const g = n => $(`[data-n="${n}"]`, box).value;
      if (!g('ru').trim() || !g('ko').trim()) return toast('러시아어와 뜻은 꼭 입력하세요.');
      store.addWord(sid, { ru: g('ru'), ko: g('ko'), ex: g('ex'), exKo: g('exKo'), pron: g('pron') });
      renderWords();
      toast('추가했어요.');
      const nb = $(`details.sess[data-id="${CSS.escape(sid)}"] [data-n="ru"]`);
      if (nb) nb.focus();
      break;
    }
    case 'bulk-add': {
      const lines = $('[data-n="bulk"]', box).value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let n = 0;
      for (const l of lines) {
        const c = l.split(l.includes('\t') ? '\t' : '|').map(x => x.trim());
        if (c[0] && c[1]) { store.addWord(sid, { ru: c[0], ko: c[1], ex: c[2], exKo: c[3], pron: c[4] }); n++; }
      }
      renderWords(); toast(n ? `${n}개 추가했어요.` : '추가할 줄이 없어요. "러시아어 | 뜻" 형식으로 써 주세요.');
      break;
    }
    case 'del-word': {
      const w = store.word(b.dataset.w);
      if (!(await ask(`'${w.ru}' 단어를 삭제할까요?`, { ok: '삭제', danger: true }))) return;
      store.deleteWord(sid, b.dataset.w); renderWords(); break;
    }
  }
}

/* ---------------- 통계 ---------------- */
function renderStats() {
  const el = $('#view-stats');
  const all = store.allWords();
  const progs = all.map(w => ({ w, p: store.prog(w.id) }));
  const tot = progs.reduce((a, x) => { a.c += x.p.correct; a.t += x.p.correct + x.p.wrong; return a; }, { c: 0, t: 0 });
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const todayLog = store.log.filter(l => l.t >= startOfDay.getTime());
  const boxes = Array.from({ length: BOXES + 1 }, (_, b) => progs.filter(x => x.p.box === b).length);
  const maxBox = Math.max(1, ...boxes);
  const wrongList = progs.filter(x => x.p.wrong > 0)
    .sort((a, b) => b.p.wrong - a.p.wrong || pct(a.p.correct, a.p.correct + a.p.wrong) - pct(b.p.correct, b.p.correct + b.p.wrong))
    .slice(0, 30);

  el.innerHTML = `
    ${calendarPanel()}
    <div class="panel">
      <h2>전체</h2>
      <div class="big-stats">
        <div><b>${pct(tot.c, tot.t)}%</b><span>정답률</span></div>
        <div><b>${progs.filter(x => x.p.box > 0).length}<small class="muted">/${all.length}</small></b><span>학습한 단어</span></div>
        <div><b>${todayLog.length}</b><span>오늘 푼 문제</span></div>
      </div>
      <h3>Leitner 박스</h3>
      <div class="boxes">
        ${boxes.map((n, b) => `<div class="col"><b>${n}</b><i style="height:${(n / maxBox) * 70}%;${b === 0 ? 'background:var(--line)' : ''}"></i>${b ? '박스 ' + b : '새 단어'}<span>${b ? INTERVAL_LABEL[b] : ''}</span></div>`).join('')}
      </div>
      <p class="muted small" style="margin-bottom:0">맞히면 다음 박스로, 틀리면 박스 1로 돌아가요. 박스 1은 매번, 박스 5는 8일마다 나옵니다.</p>
    </div>

    <div class="panel">
      <h2>회차별 정답률</h2>
      <table class="tbl">
        <tr><th>회차</th><th>정답률</th><th class="num">시도</th></tr>
        ${store.sessions.map(s => {
          const r = s.words.reduce((a, w) => { const p = store.prog(w.id); a.c += p.correct; a.t += p.correct + p.wrong; if (p.box) a.l++; return a; }, { c: 0, t: 0, l: 0 });
          return `<tr>
            <td><b>${esc(s.title)}</b><div class="muted small">${[s.date, `${r.l}/${s.words.length} 학습`].filter(Boolean).map(esc).join(' · ')}</div></td>
            <td style="width:40%">${r.t ? `<div class="row" style="flex-wrap:nowrap"><div class="meter grow"><i style="width:${pct(r.c, r.t)}%"></i></div><span class="small">${pct(r.c, r.t)}%</span></div>` : '<span class="muted small">기록 없음</span>'}</td>
            <td class="num">${r.t}</td>
          </tr>`;
        }).join('')}
      </table>
    </div>

    <div class="panel">
      <h2>자주 틀리는 단어</h2>
      ${wrongList.length ? `
        <ul class="list">${wrongList.map(({ w, p }) => `
          <li><div class="w"><b>${esc(w.ru)}</b><div>${esc(w.ko)} · ${esc(store.session(w.sessionId)?.title || '')}</div></div>
          <span class="badge bad">틀림 ${p.wrong}/${p.correct + p.wrong}</span></li>`).join('')}
        </ul>
        <button type="button" class="btn primary big" id="study-wrong" style="margin-top:12px">이 단어들만 연습</button>` : '<p class="muted">아직 틀린 단어가 없어요.</p>'}
    </div>`;
  $$('[data-cal]', el).forEach(b => b.addEventListener('click', () => { calOffset += +b.dataset.cal; renderStats(); }));
  const sw = $('#study-wrong');
  if (sw) sw.addEventListener('click', () => startSession(wrongList.map(x => x.w), '자주 틀리는 단어'));
}

/* ---------------- 설정 ---------------- */
function renderSettings() {
  const s = store.settings;
  const el = $('#view-settings');
  el.innerHTML = `
    <div class="panel stack">
      <h2>학습</h2>
      <label class="field">글자 모드 보여주는 시간: <b id="st-sec-v">${s.showSeconds}초</b>
        <input type="range" id="st-sec" min="1" max="5" step="0.5" value="${s.showSeconds}">
      </label>
      <label class="field">한 번에 풀 단어 수
        <select id="st-size">${[10, 20, 30, 50, 0].map(n => `<option value="${n}" ${s.sessionSize === n ? 'selected' : ''}>${n || '전체'}</option>`).join('')}</select>
      </label>
    </div>
    <div class="panel stack">
      <h2>채점 방식</h2>
      ${Object.values(graders).map(g => `
        <label class="row" style="gap:10px"><input type="radio" name="grader" value="${g.id}" ${s.grader === g.id ? 'checked' : ''} ${g.available ? '' : 'disabled'}> ${esc(g.label)}</label>`).join('')}
      <p class="muted small" style="margin:0">AI 자동 채점은 나중에 추가될 예정이에요. 켜지면 필기 이미지를 보내 판단을 제안하고, 최종 맞음/틀림은 직접 고릅니다.</p>
    </div>
    <div class="panel stack">
      <h2>백업</h2>
      <p class="muted small" style="margin:0">단어 + 학습 기록 + 설정을 한 파일로 저장/복원합니다. 브라우저 데이터를 지우면 기록이 사라지니 가끔 백업하세요.</p>
      <div class="row">
        <button type="button" class="btn" id="st-export">전체 백업 저장</button>
        <button type="button" class="btn" id="st-import">백업 불러오기</button>
      </div>
    </div>
    <div class="panel stack">
      <h2>초기화</h2>
      <div class="row">
        <button type="button" class="btn danger" id="st-reset-prog">학습 기록 지우기</button>
        <button type="button" class="btn danger" id="st-reset-words">기본 단어로 되돌리기</button>
      </div>
    </div>
    <p class="muted small" style="text-align:center">오프라인 지원 PWA · 데이터는 이 기기에만 저장됩니다</p>`;

  const sec = $('#st-sec');
  sec.addEventListener('input', () => { store.setSetting('showSeconds', +sec.value); $('#st-sec-v').textContent = sec.value + '초'; });
  $('#st-size').addEventListener('change', e => store.setSetting('sessionSize', +e.target.value));
  $$('input[name=grader]').forEach(r => r.addEventListener('change', () => store.setSetting('grader', r.value)));
  $('#st-export').addEventListener('click', () => showExport(`russian-backup-${today()}.json`, store.exportAll()));
  $('#st-import').addEventListener('click', () => showImport(t => importText(t, renderSettings)));
  $('#st-reset-prog').addEventListener('click', async () => {
    if (await ask('모든 학습 기록(박스, 정답률)을 지울까요? 단어와 출석 기록은 남습니다.', { ok: '지우기', danger: true })) { store.resetProgress(); toast('학습 기록을 지웠어요.'); }
  });
  $('#st-reset-words').addEventListener('click', async () => {
    if (!(await ask('추가한 단어와 학습 기록이 모두 지워지고 기본 단어(Day 1~5)로 돌아갑니다. 계속할까요?', { ok: '되돌리기', danger: true }))) return;
    await store.resetWords(); store.setSetting('selected', []); toast('기본 단어로 되돌렸어요.');
  });
}

/* ---------------- 파일 ---------------- */
async function importText(text, after) {
  let obj;
  try { obj = JSON.parse(text); } catch { return notice('JSON 형식이 아니에요. 내보낸 내용을 그대로 붙여넣었는지 확인하세요.'); }
  const isFull = obj && obj.app === 'russian-dictation';
  if (!(await ask(isFull ? '백업으로 현재 단어와 학습 기록을 모두 바꿀까요?' : '불러온 단어로 현재 단어 목록을 바꿀까요? (같은 id의 학습 기록은 유지)', { ok: '바꾸기' }))) return;
  try {
    const kind = store.importAny(obj);
    renderMode();
    toast(kind === 'full' ? '백업을 복원했어요.' : '단어를 불러왔어요.');
    after();
  } catch (e) { notice('불러오기 실패: ' + e.message); }
}

/* ---------------- 출석 ---------------- */
const WD = ['일', '월', '화', '수', '목', '금', '토'];
let calOffset = 0; // 통계 달력: 0 = 이번 달

// 오늘 첫 학습이면 출석 처리 + 축하
function checkIn() {
  if (!store.markToday()) return;
  const { current } = streakInfo(store.days);
  toast(current > 1 ? `🔥 출석 완료! 연속 ${current}일째 학습 중` : '🔥 오늘 출석 완료!');
}

function streakBanner() {
  const st = streakInfo(store.days);
  const set = new Set(store.days);
  const now = new Date();
  const week = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));
  const msg = st.doneToday
    ? (st.current > 1 ? `연속 ${st.current}일째 학습!` : '오늘 출석 완료!')
    : (st.current ? `연속 ${st.current}일째 학습 중` : '오늘부터 연속 학습 시작!');
  const sub = st.doneToday
    ? `최장 기록 ${st.longest}일 · 총 ${st.total}일 출석`
    : (st.current ? `오늘 한 문제만 풀어도 ${st.current + 1}일째가 돼요` : '문제를 풀거나 연습장에 쓰면 출석돼요');
  return `
    <div class="panel streak ${st.doneToday ? 'done' : ''}">
      <div class="flame" aria-hidden="true">🔥</div>
      <div class="grow"><b>${msg}</b><div class="muted small">${sub}</div></div>
      <div class="week" aria-label="최근 7일 출석">
        ${week.map(d => `<div class="${set.has(dateKey(d)) ? 'on' : ''} ${dateKey(d) === dateKey(now) ? 'today' : ''}"><i></i><span>${WD[d.getDay()]}</span></div>`).join('')}
      </div>
    </div>`;
}

function calendarPanel() {
  const st = streakInfo(store.days);
  const set = new Set(store.days);
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + calOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
  const todayK = dateKey();
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<span></span>';
  for (let d = 1; d <= last; d++) {
    const k = dateKey(new Date(y, m, d));
    cells += `<span class="${set.has(k) ? 'on' : ''} ${k === todayK ? 'today' : ''}">${d}</span>`;
  }
  const monthCount = store.days.filter(k => { const d = parseKey(k); return d.getFullYear() === y && d.getMonth() === m; }).length;
  return `
    <div class="panel">
      <h2>출석</h2>
      <div class="big-stats">
        <div><b>🔥 ${st.current}</b><span>연속 학습일</span></div>
        <div><b>${st.longest}</b><span>최장 연속</span></div>
        <div><b>${st.total}</b><span>총 출석일</span></div>
      </div>
      <div class="cal-head">
        <button type="button" class="iconbtn" data-cal="-1" aria-label="이전 달">‹</button>
        <b>${y}년 ${m + 1}월 <span class="muted small">· ${monthCount}일 출석</span></b>
        <button type="button" class="iconbtn" data-cal="1" aria-label="다음 달" ${calOffset >= 0 ? 'disabled' : ''}>›</button>
      </div>
      <div class="cal">${WD.map(w => `<em>${w}</em>`).join('')}${cells}</div>
    </div>`;
}

/* ---------------- 연습장 ---------------- */
const SIZES = [{ v: 0.6, t: '가늘게' }, { v: 1, t: '보통' }, { v: 1.6, t: '굵게' }];
let refHidden = false;

function initPractice() {
  const sz = SIZES.findIndex(x => x.v === store.settings.practiceSize);
  freePad.size = SIZES[sz < 0 ? 1 : sz].v;
  freePad.onChange = () => { if (!freePad.isEmpty()) checkIn(); };
  $('#fp-pen').addEventListener('click', () => setTool(false));
  $('#fp-eraser').addEventListener('click', () => setTool(true));
  $('#fp-size').addEventListener('click', () => {
    const i = (SIZES.findIndex(x => x.v === freePad.size) + 1) % SIZES.length;
    freePad.size = SIZES[i].v; store.setSetting('practiceSize', freePad.size);
    renderTools();
  });
  $('#fp-undo').addEventListener('click', () => freePad.undo());
  $('#fp-clear').addEventListener('click', () => { freePad.clear(); toast('지웠어요. "되돌리기"로 되살릴 수 있어요.'); });
  $('#fp-prev').addEventListener('click', () => setPracticeWord(store.settings.practiceIdx - 1));
  $('#fp-next').addEventListener('click', () => setPracticeWord(store.settings.practiceIdx + 1));
  $('#fp-hide').addEventListener('click', () => { refHidden = !refHidden; renderPractice(); });
  $('#fp-days').addEventListener('click', e => {
    const c = e.target.closest('[data-day]'); if (!c) return;
    store.setSetting('practiceDay', c.dataset.day);
    setPracticeWord(0, true);
  });
  $('#fp-words').addEventListener('click', e => {
    const c = e.target.closest('[data-i]'); if (c) setPracticeWord(+c.dataset.i);
  });
  renderTools();
}

function setTool(erase) { freePad.erasing = erase; renderTools(); }
function renderTools() {
  $('#fp-pen').classList.toggle('on', !freePad.erasing);
  $('#fp-eraser').classList.toggle('on', freePad.erasing);
  $('#fp-size').textContent = '굵기: ' + SIZES.find(x => x.v === freePad.size).t;
}

function practiceSession() {
  const id = store.settings.practiceDay;
  return id === '' ? null : (store.session(id) || store.sessions[0] || null);
}

// 단어를 바꾸면 캔버스를 비움 (실수로 바꿨으면 '되돌리기'로 복구)
function setPracticeWord(i, force) {
  const s = practiceSession();
  const n = s ? s.words.length : 0;
  const idx = n ? Math.max(0, Math.min(n - 1, i)) : 0;
  if (!force && idx === store.settings.practiceIdx) return;
  store.setSetting('practiceIdx', idx);
  freePad.clear();
  renderPractice(true);
}

function renderPractice(scrollToWord) {
  const s = practiceSession();
  const sel = s ? s.id : '';
  $('#fp-days').innerHTML =
    `<button type="button" class="chip ${sel ? '' : 'on'}" data-day="">자유 쓰기</button>` +
    store.sessions.map(x => `<button type="button" class="chip ${x.id === sel ? 'on' : ''}" data-day="${esc(x.id)}">${esc(x.title)}<small>${x.words.length}</small></button>`).join('');

  const words = s ? s.words : [];
  const idx = Math.min(store.settings.practiceIdx || 0, Math.max(0, words.length - 1));
  $('#fp-words').hidden = !s;
  $('#fp-ref').hidden = !s;
  if (s) {
    $('#fp-words').innerHTML = words.length
      ? words.map((w, i) => `<button type="button" class="chip ru ${i === idx ? 'on' : ''}" data-i="${i}">${esc(w.ru)}</button>`).join('')
      : '<span class="muted small">이 회차에 단어가 없어요.</span>';
    const w = words[idx];
    $('#fp-ref-ru').textContent = w ? w.ru : '—';
    $('#fp-ref-ru').classList.toggle('blur', refHidden);
    $('#fp-ref-ko').textContent = w ? `${w.ko}${w.pron ? ' · ' + w.pron : ''}` : '';
    $('#fp-count').textContent = words.length ? `${idx + 1} / ${words.length}` : '';
    $('#fp-prev').disabled = idx <= 0;
    $('#fp-next').disabled = idx >= words.length - 1;
    $('#fp-hide').textContent = refHidden ? '보이기' : '가리기';
    if (scrollToWord) { const on = $('#fp-words .on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
  }
  const dayOn = $('#fp-days .on'); if (dayOn && !scrollToWord) dayOn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  requestAnimationFrame(() => freePad.resize());
}

/* ---------------- 시작 ---------------- */
(async function main() {
  await store.init();
  pad = new Pad($('#pad'));
  freePad = new Pad($('#pad-free'), { guides: false });
  initPractice();
  renderMode();
  go('study');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
