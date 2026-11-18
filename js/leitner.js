// 간단한 Leitner 박스 (1~5). box 0 = 아직 안 배운 단어.
// 맞으면 한 칸 위로, 틀리면 1번 박스로. 박스가 낮을수록 자주 나옵니다.
export const BOXES = 5;
const DAY = 24 * 60 * 60 * 1000;
// 각 박스에 들어간 뒤 다시 나올 때까지의 간격
export const INTERVALS = { 1: 0, 2: 1 * DAY, 3: 2 * DAY, 4: 4 * DAY, 5: 8 * DAY };
export const INTERVAL_LABEL = { 0: '새 단어', 1: '매번', 2: '1일', 3: '2일', 4: '4일', 5: '8일' };

export function nextProgress(p, ok, now = Date.now()) {
  const box = ok ? Math.min(BOXES, Math.max(1, p.box) + 1) : 1;
  return {
    box,
    due: now + INTERVALS[box],
    correct: p.correct + (ok ? 1 : 0),
    wrong: p.wrong + (ok ? 0 : 1),
    last: now,
  };
}

export function isDue(p, now = Date.now()) { return p.box === 0 || p.due <= now; }

// 출제 큐 만들기
// words: 후보 단어, prog: id => progress
// onlyDue=true 이면 복습 시기가 된 단어만, 아니면 전체를 박스 가중치로 섞어서
export function buildQueue(words, prog, { size = 20, onlyDue = true } = {}) {
  const now = Date.now();
  let pool = words.map(w => ({ w, p: prog(w.id) }));
  if (onlyDue) pool = pool.filter(x => isDue(x.p, now));
  // 낮은 박스(자주 틀림)일수록 앞쪽에 오도록 가중 랜덤 정렬. 새 단어는 박스 1과 비슷하게 취급
  const weight = x => {
    const b = x.p.box || 1.5;
    const wrongBoost = 1 + Math.min(x.p.wrong, 5) * 0.15;
    return (Math.pow(2, BOXES - b) * wrongBoost);
  };
  pool.forEach(x => { x.k = Math.pow(Math.random(), 1 / weight(x)); }); // 가중 무작위 샘플링 키
  pool.sort((a, b) => b.k - a.k);
  const list = size > 0 ? pool.slice(0, size) : pool;
  return list.map(x => x.w);
}

export function countDue(words, prog) {
  const now = Date.now();
  return words.filter(w => isDue(prog(w.id), now)).length;
}
