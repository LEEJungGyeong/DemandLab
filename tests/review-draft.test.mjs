import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScriptModule } from './ts-module-loader.mjs';

const { validateReviewDraftInput, parseReviewDraftResponse, reviewDraftContext } = await importTypeScriptModule('../lib/ai/review-draft.ts');
const { createAIProvider } = await importTypeScriptModule('../lib/ai/provider.ts');
const { POST } = await importTypeScriptModule('../app/api/draft-review/route.ts');
const input = {
  product: { name: '시연용 표백제', description: '실제 판매 상품이 아닌 시연용 가상 상품', strengths: ['표백 효과'] },
  guide: { title: '표백제 가이드', purpose: '실제 관찰 기록', testItems: [{
    id: 'effect', title: '표백 효과', purpose: '변화 관찰', recommendedSituation: '제품 표시사항에 맞는 상황',
    method: '표시사항에 따라 사용한 결과 기록', observe: ['얼룩 변화'], questions: ['어떤 변화가 있었나요?'], checklist: ['장단점 기록'],
  }], writingGuidance: ['제품 제공 관계가 있다면 공개'], checklist: ['사용 경험 기록'] },
  guideVersion: '2026-11-04T02:00:00Z',
  experience: '흰 면 수건의 최근 차 얼룩은 옅어졌지만 오래된 얼룩은 남았습니다. 손잡이는 잡기 편했습니다.',
  techniques: ['구체적 묘사', '비교·대조', '장단점 균형'], relationship: '시연용 가상 데이터',
};
const payload = { sentences: [
  { text: '흰 면 수건의 차 얼룩 변화를 살펴봤습니다.', evidence: '흰 면 수건', technique: '구체적 묘사' },
  { text: '최근 생긴 얼룩은 옅어졌지만 오래된 얼룩은 남았습니다.', evidence: '최근 차 얼룩은 옅어졌지만 오래된 얼룩은 남았습니다.', technique: '비교·대조' },
  { text: '손잡이는 잡기 편했습니다.', evidence: '손잡이는 잡기 편했습니다.', technique: '장단점 균형' },
] };
const request = (body, origin = 'http://local.test') => new Request('http://local.test/api/draft-review', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const response = body => Response.json(body);

test('review drafting requires experience, a saved guide, selected techniques and explicit relationship', () => {
  assert.equal(validateReviewDraftInput(input).experience, input.experience);
  const writingContext = reviewDraftContext(input);
  assert.deepEqual(writingContext.guideCoverage, ['표백 효과']);
  assert.equal(JSON.stringify(writingContext).includes(input.guide.testItems[0].method), false);
  assert.equal('strengths' in writingContext, false);
  for (const patch of [{ experience: '' }, { guide: {} }, { techniques: [] }, { techniques: ['허위 과장'] }, { relationship: '' }]) {
    assert.throws(() => validateReviewDraftInput({ ...input, ...patch }));
  }
});

test('draft sentences must quote the reviewer experience, not the guide or product marketing', () => {
  const draft = parseReviewDraftResponse(JSON.stringify(payload), input);
  assert.match(draft.text, /시연용 가상 리뷰/);
  assert.equal(draft.sentences.length, 3);
  for (const bad of [{ evidence: '표시사항에 따라 사용한 결과 기록' }, { evidence: '' }, { technique: '인과 설명' }]) {
    assert.throws(() => parseReviewDraftResponse(JSON.stringify({ sentences: [{ ...payload.sentences[0], ...bad }, ...payload.sentences.slice(1)] }), input));
  }
  assert.match(parseReviewDraftResponse(JSON.stringify(payload), { ...input, relationship: '제품 제공' }).text, /^제품을 제공받아/);
  assert.doesNotMatch(parseReviewDraftResponse(JSON.stringify(payload), { ...input, relationship: '없음' }).text, /제품을 제공받아/);
});

test('strength-based generation needs neither a test guide nor notes and labels the example', () => {
  const example = validateReviewDraftInput({ product: input.product, mode: 'guide-example', relationship: '없음' });
  assert.equal(example.experience, '');
  assert.equal(example.relationship, '시연용 가상 데이터');
  assert.deepEqual(reviewDraftContext(example).writingGuidance, input.product.strengths);
  assert.equal('guide' in reviewDraftContext(example), false);
  assert.throws(() => validateReviewDraftInput({ product: { ...input.product, strengths: [] }, mode: 'guide-example' }));
  const rows = { sentences: payload.sentences.map(row => ({ ...row, evidence: '표백 효과' })) };
  const result = parseReviewDraftResponse(JSON.stringify(rows), example);
  assert.match(result.text, /^\[상품 강점 기반 예시 리뷰 · 실제 사용 후기 아님\]/);
  const labelled = { sentences: [{ text: '표백 효과, 구체적 묘사: 가상의 사용 상황을 가정한 예시입니다.', evidence: '표백 효과', technique: '구체적 묘사' }] };
  assert.equal(parseReviewDraftResponse(JSON.stringify(labelled), example).sentences[0].text, '가상의 사용 상황을 가정한 예시입니다.');
  assert.throws(() => parseReviewDraftResponse(JSON.stringify(payload), example));
});

test('draft API routes to local Ollama with schema and does not require an OpenAI key', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/api/tags') ? response({ models: [{ name: 'gemma3:4b' }] })
      : response({ message: { content: JSON.stringify(payload) } });
  };
  try {
    const result = await POST(request({ provider: 'ollama', model: 'gemma3:4b', input, baseUrl: 'https://attacker.test' }));
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.draft.guideVersion, input.guideVersion);
    assert.equal(data.draft.provider, 'ollama');
    assert.deepEqual(calls.map(c => c.url), ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/chat']);
    const sent = JSON.parse(calls[1].init.body);
    assert.deepEqual(sent.format.properties.sentences.items.properties.technique.enum, input.techniques);
    assert.ok(sent.format.properties.sentences.items.properties.evidence.enum.every(quote => input.experience.includes(quote)));
    assert.equal(sent.messages[1].content.includes(input.experience), true);
  } finally { globalThis.fetch = original; }
});

test('OpenAI drafts use server authorization and validate evidence', async () => {
  const original = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, init) => {
    upstream = { url, init };
    return response({ choices: [{ message: { content: JSON.stringify(payload) } }] });
  };
  try {
    const provider = createAIProvider('openai', { apiKey: 'sk-test', model: 'gpt-4.1-mini' });
    const result = await provider.draftReview(input);
    assert.equal(result.sentences.length, 3);
    assert.equal(upstream.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(upstream.init.headers.Authorization, 'Bearer sk-test');
  } finally { globalThis.fetch = original; }
});

test('draft API rejects cross-origin access, malformed input and missing OpenAI credentials', async () => {
  assert.equal((await POST(request({ provider: 'ollama', input }, 'https://attacker.test'))).status, 403);
  assert.equal((await POST(request({ provider: 'ollama', input: { ...input, experience: '' } }))).status, 400);
  assert.equal((await POST(request({ provider: 'openai', input }))).status, 400);
});
