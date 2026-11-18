// 채점기 플러그인 구조.
// 지금은 'manual'(직접 채점)만 동작합니다. 'vision'은 나중에 비전 AI 자동 채점을 붙일 자리입니다.
//
// 채점기 인터페이스:
//   {
//     id, label, available: boolean,
//     grade({ image, word }) => Promise<{ correct: boolean, confidence?: number, read?: string, reason?: string }>
//   }
//   image: 흰 배경 PNG data URL (pad.toDataURL())
//   word:  { ru, ko, ex, ... }
//
// 자동 채점 결과는 "제안"으로만 보여 주고, 최종 맞음/틀림은 사용자가 누르도록 설계했습니다.

export const graders = {
  manual: {
    id: 'manual',
    label: '직접 채점',
    available: true,
    async grade() { return null; }, // 사용자 선택에 맡김
  },

  vision: {
    id: 'vision',
    label: 'AI 자동 채점 (준비 중)',
    available: false,
    // 구현 예시 (나중에):
    //   const res = await fetch(settings.vision.endpoint, {
    //     method: 'POST', headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ image, answer: word.ru, ignoreStress: true }),
    //   });
    //   return await res.json(); // { correct, confidence, read, reason }
    // API 키는 브라우저에 두지 말고 작은 프록시 서버(endpoint)에서 붙이는 것을 권장합니다.
    async grade({ image, word }, settings) {
      throw new Error('비전 AI 채점은 아직 구현되지 않았어요.');
    },
  },
};

export function getGrader(id) {
  const g = graders[id];
  return g && g.available ? g : graders.manual;
}

// 비교용 유틸: 강세 부호 제거, 소문자, 공백 정리 (자동 채점 결과 비교에 사용)
export function normalizeRu(s) {
  return s.normalize('NFD').replace(/́/g, '').normalize('NFC')
    .toLowerCase().replace(/ё/g, 'е').replace(/[.,!?…]/g, '').replace(/\s+/g, ' ').trim();
}
