import type { Review, Result, Theme } from './types';

// Local, deterministic UI fixtures. These are not AI sentiment judgments.
const topics: [string, RegExp][] = [
  ['배터리', /배터리|충전/],
  ['착용감', /착용|귀|가볍|무겁/],
  ['연결 안정성', /연결|끊김|끊겨|기기 전환/],
  ['통화 품질', /통화|목소리/],
  ['음질', /음질|저음|소리/],
  ['배송', /배송|택배/],
  ['내구성', /흠집|고장|파손/],
];

export function createDemoAnalysis(reviews: Review[]): { results: Result[]; themes: Theme[] } {
  const results = reviews.map(({ id, text }): Result => ({
    id,
    theme: topics.find(([, pattern]) => pattern.test(text))?.[0] ?? '기타',
    subtheme: '모의 분류 · 감성 미분석',
    sentiment: '중립',
    evidence: text.slice(0, 120),
  }));
  return { results, themes: [...new Set(results.map(result => result.theme))].map(name => ({ name })) };
}
