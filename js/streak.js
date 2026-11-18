// 출석(연속 학습일) 계산. 날짜는 기기 시간 기준 'YYYY-MM-DD'.
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// current: 오늘(또는 오늘 아직 안 했으면 어제)까지 이어진 연속 일수
export function streakInfo(days) {
  const set = new Set(days);
  const now = new Date();
  const doneToday = set.has(dateKey(now));
  let cur = 0;
  for (let d = doneToday ? now : addDays(now, -1); set.has(dateKey(d)); d = addDays(d, -1)) cur++;

  let longest = 0, run = 0, prev = null;
  for (const k of [...set].sort()) {
    const d = parseKey(k);
    run = prev && dateKey(addDays(prev, 1)) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current: cur, doneToday, longest, total: set.size };
}
