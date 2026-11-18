// 저장소: 단어 데이터 / 학습 기록 / 설정을 localStorage에 보관
import { dateKey } from './streak.js';

const K = {
  days: 'rd.days',       // 출석한 날짜 ['YYYY-MM-DD', ...]
  data: 'rd.data',       // { version, sessions: [{id,title,subtitle,date,words:[{id,ru,ko,ex,exKo,pron}]}] }
  progress: 'rd.progress', // { [wordId]: { box, due, correct, wrong, last } }
  log: 'rd.log',         // [{ t, w, ok, m }]  (최근 5000건)
  settings: 'rd.settings',
};
const LOG_MAX = 5000;

export const DEFAULT_SETTINGS = {
  mode: 'meaning',       // 'meaning' | 'letters'
  showSeconds: 2,        // 글자 모드 보여주는 시간
  sessionSize: 20,       // 한 번에 풀 단어 수 (0 = 전체)
  selected: [],          // 선택한 회차 id (빈 배열 = 전체)
  practiceDay: 'day1',   // 연습장 회차 ('' = 자유 쓰기)
  practiceIdx: 0,
  practiceSize: 1,
  grader: 'manual',      // 'manual' | 'vision' (준비 중)
  vision: { endpoint: '', model: '' },
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('저장 실패', e); return false; }
}

export const store = {
  data: null,
  progress: {},
  log: [],
  settings: { ...DEFAULT_SETTINGS },
  days: [],

  async init() {
    this.data = read(K.data, null);
    if (!this.data) {
      this.data = await loadSeed();
      this.saveData();
    }
    this.progress = read(K.progress, {});
    this.log = read(K.log, []);
    this.settings = { ...DEFAULT_SETTINGS, ...read(K.settings, {}) };
    this.days = read(K.days, null);
    if (!Array.isArray(this.days)) { // 처음이면 기존 풀이 기록에서 출석일 복원
      this.days = [...new Set(this.log.map(l => dateKey(new Date(l.t))))].sort();
      write(K.days, this.days);
    }
  },

  saveData() { write(K.data, this.data); },
  saveProgress() { write(K.progress, this.progress); write(K.log, this.log); },
  saveSettings() { write(K.settings, this.settings); },
  setSetting(k, v) { this.settings[k] = v; this.saveSettings(); },

  // ---- 조회 ----
  get sessions() { return this.data.sessions; },
  session(id) { return this.data.sessions.find(s => s.id === id); },
  allWords() {
    return this.data.sessions.flatMap(s => s.words.map(w => ({ ...w, sessionId: s.id })));
  },
  word(id) {
    for (const s of this.data.sessions) {
      const w = s.words.find(x => x.id === id);
      if (w) return { ...w, sessionId: s.id };
    }
    return null;
  },
  prog(id) { return this.progress[id] || { box: 0, due: 0, correct: 0, wrong: 0, last: 0 }; },

  // ---- 단어 편집 ----
  addSession({ title, subtitle = '', date = '' }) {
    const s = { id: uid('s'), title, subtitle, date, words: [] };
    this.data.sessions.push(s);
    this.saveData();
    return s;
  },
  updateSession(id, patch) { Object.assign(this.session(id), patch); this.saveData(); },
  deleteSession(id) {
    const s = this.session(id);
    if (!s) return;
    s.words.forEach(w => delete this.progress[w.id]);
    this.data.sessions = this.data.sessions.filter(x => x.id !== id);
    this.settings.selected = this.settings.selected.filter(x => x !== id);
    this.saveData(); this.saveProgress(); this.saveSettings();
  },
  addWord(sessionId, w) {
    const s = this.session(sessionId);
    const word = { id: uid('w'), ru: w.ru.trim(), ko: w.ko.trim() };
    for (const k of ['ex', 'exKo', 'pron']) if (w[k] && w[k].trim()) word[k] = w[k].trim();
    s.words.push(word);
    this.saveData();
    return word;
  },
  deleteWord(sessionId, wordId) {
    const s = this.session(sessionId);
    s.words = s.words.filter(w => w.id !== wordId);
    delete this.progress[wordId];
    this.saveData(); this.saveProgress();
  },
  replaceData(data) { this.data = normalizeData(data); this.saveData(); },
  async resetWords() { this.data = await loadSeed(); this.progress = {}; this.log = []; this.saveData(); this.saveProgress(); },
  resetProgress() { this.progress = {}; this.log = []; this.saveProgress(); },

  // ---- 출석 ----
  // 오늘 처음 학습하면 true
  markToday() {
    const k = dateKey();
    if (this.days.includes(k)) return false;
    this.days.push(k); this.days.sort();
    write(K.days, this.days);
    return true;
  },

  // ---- 기록 ----
  record(wordId, ok, mode, nextProg) {
    this.progress[wordId] = nextProg;
    this.log.push({ t: Date.now(), w: wordId, ok: ok ? 1 : 0, m: mode === 'letters' ? 'l' : 'm' });
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.saveProgress();
  },

  // ---- 백업 ----
  exportAll() {
    return { app: 'russian-dictation', exported: new Date().toISOString(), data: this.data, progress: this.progress, log: this.log, settings: this.settings, days: this.days };
  },
  importAny(obj) {
    if (obj && obj.app === 'russian-dictation' && obj.data) {
      this.data = normalizeData(obj.data);
      this.progress = obj.progress || {};
      this.log = obj.log || [];
      if (obj.settings) this.settings = { ...DEFAULT_SETTINGS, ...obj.settings };
      this.days = Array.isArray(obj.days) ? obj.days : [...new Set(this.log.map(l => dateKey(new Date(l.t))))].sort();
      write(K.days, this.days);
      this.saveData(); this.saveProgress(); this.saveSettings();
      return 'full';
    }
    this.replaceData(obj);
    return 'words';
  },
};

async function loadSeed() {
  try {
    const res = await fetch('data/words.json');
    return normalizeData(await res.json());
  } catch {
    return { version: 1, sessions: [] };
  }
}

function normalizeData(d) {
  if (!d || !Array.isArray(d.sessions)) throw new Error('형식이 올바르지 않아요 (sessions 배열이 필요합니다).');
  const seen = new Set();
  d.sessions.forEach(s => {
    s.id = s.id || uid('s');
    s.title = s.title || '이름 없는 회차';
    s.words = (s.words || []).filter(w => w && w.ru && w.ko).map(w => {
      if (!w.id || seen.has(w.id)) w.id = uid('w');
      seen.add(w.id);
      return w;
    });
  });
  return { version: d.version || 1, sessions: d.sessions };
}

export function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
