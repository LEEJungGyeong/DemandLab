import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScriptModule } from './ts-module-loader.mjs';

const { parseGuideGenerationResponse, validateGuideGenerationRequest } =
  await importTypeScriptModule('../lib/ai/schemas.ts');
const { createAIProvider } = await importTypeScriptModule('../lib/ai/provider.ts');
const { POST: generateGuide } = await importTypeScriptModule('../app/api/generate-guide/route.ts');
const { buildGuideGenerationInput, formatReviewGuideMarkdown, formatReviewGuideText, isReviewGuideStale } =
  await importTypeScriptModule('../lib/guide.ts');

const input = {
  product: {
    name: '무선 이어폰',
    description: '블루투스 연결 이어폰',
    emphasizedStrengths: ['가벼운 착용감'],
    targetCustomers: '출퇴근하는 직장인',
    useSituations: ['지하철 이동'],
  },
  evaluationItems: ['배터리 지속시간', '착용감'],
};

const draft = {
  title: '무선 이어폰 실제 사용 가이드',
  purpose: '출퇴근 환경에서 관찰한 실제 사용 경험을 정리합니다.',
  testItems: input.evaluationItems.map(title => ({
    title,
    purpose: `${title}을 실제 조건에서 확인합니다.`,
    recommendedSituation: '평소 이용하는 이동 상황에서 사용합니다.',
    method: '제조사 안내를 따르고 평소 설정으로 사용합니다.',
    observe: ['사용 조건과 실제 관찰 내용을 기록합니다.'],
    questions: ['기대와 달랐던 점이 있었나요?'],
    checklist: ['실제로 수행한 테스트만 기록했나요?'],
  })),
  writingGuidance: [
    '실제 사용한 상황과 설정을 구체적으로 설명합니다.',
    '좋았던 점과 불편했던 점을 모두 실제 경험에 따라 작성합니다.',
    '제품 제공 또는 협찬 사실이 있다면 해당 플랫폼 기준에 맞게 공개합니다.',
  ],
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function request(url, payload, origin = new URL(url).origin) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify(payload),
  });
}

test('guide request validation requires product information and selected evaluation items', () => {
  assert.throws(() => validateGuideGenerationRequest({ task: 'guide-generation', input: {
    ...input, product: { ...input.product, name: '' },
  } }), /상품명/);
  assert.throws(() => validateGuideGenerationRequest({ task: 'guide-generation', input: {
    ...input, evaluationItems: [],
  } }), /평가 항목/);
  assert.deepEqual(validateGuideGenerationRequest({ task: 'guide-generation', input }).input, input);
});

test('guide response validation requires the selected topics, disclosure and safe neutral methods', () => {
  const parsed = parseGuideGenerationResponse(JSON.stringify(draft), input);
  assert.equal(parsed.testItems.length, 2);
  assert.equal(parsed.testItems[0].id, 'guide-item-1');
  assert.throws(() => parseGuideGenerationResponse(JSON.stringify({
    ...draft, writingGuidance: ['좋은 점을 자세히 작성합니다.'],
  }), input), /가이드/);
  assert.throws(() => parseGuideGenerationResponse(JSON.stringify({
    ...draft, testItems: draft.testItems.map(item => ({ ...item, method: '제품을 물에 담가 침수 시험을 합니다.' })),
  }), input), /가이드/);
  assert.throws(() => parseGuideGenerationResponse(JSON.stringify({
    ...draft, testItems: draft.testItems.slice(1),
  }), input), /가이드/);
  assert.throws(() => parseGuideGenerationResponse(JSON.stringify({
    ...draft, writingGuidance: ['좋은 점만 긍정적으로 작성합니다.', ...draft.writingGuidance.slice(1)],
  }), input), /가이드/);
});

test('OpenAI provider generates a validated guide using the common request', async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, init) => {
    upstream = { url: String(url), init };
    return response({ choices: [{ message: { content: JSON.stringify(draft) } }] });
  };
  try {
    const provider = createAIProvider('openai', { apiKey: 'sk-test', model: 'gpt-4.1-mini' });
    const result = await provider.generateGuide({ task: 'guide-generation', input });
    assert.equal(result.testItems[1].title, '착용감');
    assert.equal(upstream.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(upstream.init.body).model, 'gpt-4.1-mini');
    assert.equal(JSON.parse(upstream.init.body).messages[0].content.includes('Do not invent product performance'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ollama provider checks the selected local model before generating a guide', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/api/tags')
      ? response({ models: [{ name: 'qwen2.5:7b' }] })
      : response({ message: { content: JSON.stringify(draft) } });
  };
  try {
    const provider = createAIProvider('ollama', { model: 'qwen2.5:7b' });
    const result = await provider.generateGuide({ task: 'guide-generation', input });
    assert.equal(result.testItems.length, 2);
    assert.deepEqual(calls.map(call => call.url), [
      'http://127.0.0.1:11434/api/tags',
      'http://127.0.0.1:11434/api/chat',
    ]);
    assert.equal(JSON.parse(calls[1].init.body).messages[0].content.includes('Do not invent product performance'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generate-guide endpoint routes providers and returns a project-ready guide', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ choices: [{ message: { content: JSON.stringify(draft) } }] });
  try {
    const result = await generateGuide(request('http://local.test/api/generate-guide', {
      provider: 'openai', model: 'gpt-4.1-mini', key: 'sk-test', input,
    }));
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.guide.productName, '무선 이어폰');
    assert.equal(data.guide.provider, 'openai');
    assert.equal(data.guide.testItems.length, 2);
    assert.equal(data.guide.checklist.length, 2);
    assert.ok(data.guide.generatedAt);
    assert.ok(data.guide.updatedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generate-guide endpoint routes Ollama through its fixed local model', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/api/tags')
      ? response({ models: [{ name: 'qwen2.5:7b' }] })
      : response({ message: { content: JSON.stringify(draft) } });
  };
  try {
    const result = await generateGuide(request('http://local.test/api/generate-guide', {
      provider: 'ollama', model: 'qwen2.5:7b', input,
    }));
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.guide.provider, 'ollama');
    assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:11434/')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generate-guide reports missing credentials and blocks cross-origin requests', async () => {
  const missingKey = await generateGuide(request('http://local.test/api/generate-guide', {
    provider: 'openai', input,
  }));
  assert.equal(missingKey.status, 400);
  assert.equal((await missingKey.json()).code, 'missing-api-key');

  const crossOrigin = await generateGuide(request(
    'http://local.test/api/generate-guide',
    { provider: 'ollama', input },
    'http://attacker.test',
  ));
  assert.equal(crossOrigin.status, 403);
});

test('guide input uses persisted review evidence and excludes demo analysis', () => {
  const project = {
    productName: input.product.name,
    productDescription: input.product.description,
    strengths: input.product.emphasizedStrengths,
    targetCustomers: input.product.targetCustomers,
    useSituations: input.product.useSituations,
    evaluationItems: input.evaluationItems.map((title, index) => ({ id: `item-${index}`, title })),
    guideInputVersion: 4,
    analysisInputVersion: 2,
    analyzedInputVersion: 2,
    workspace: {
      mode: 'AI 분석 완료',
      reviews: [{ id: 1, text: '배터리가 오래가요.' }],
      results: [{ id: 1, theme: '배터리', subtheme: '사용시간', sentiment: '긍정', evidence: '배터리가 오래가요' }],
      themes: [{ name: '배터리' }],
    },
  };
  const guideInput = buildGuideGenerationInput(project);
  const editingProject = { ...project,
    strengths: ['  긴 배터리 사용 시간 ', '', '편안한 착용감', ' '],
    useSituations: [' 출퇴근 중 ', ''],
  };
  const cleaned = buildGuideGenerationInput(editingProject);
  assert.deepEqual(cleaned.product.emphasizedStrengths, ['긴 배터리 사용 시간', '편안한 착용감']);
  assert.deepEqual(cleaned.product.useSituations, ['출퇴근 중']);
  assert.equal(editingProject.strengths[0], '  긴 배터리 사용 시간 ');
  assert.equal(guideInput.existingReviewAnalysis.topics[0].positive, 1);
  assert.equal(guideInput.existingReviewAnalysis.topics[0].evidence[0].quote, '배터리가 오래가요');
  assert.equal(isReviewGuideStale({ sourceVersion: 4 }, project), false);
  assert.equal(isReviewGuideStale({ sourceVersion: 3 }, project), true);

  project.workspace.mode = '무료 데모 · 모의 결과';
  assert.equal(buildGuideGenerationInput(project).existingReviewAnalysis, undefined);
});

test('guide Markdown download content contains product, test steps, writing guidance and checklist', () => {
  const markdown = formatReviewGuideMarkdown({
    ...draft,
    content: '',
    checklist: [],
    productName: input.product.name,
    targetCustomers: input.product.targetCustomers,
    generatedAt: new Date().toISOString(),
    testItems: [{ ...draft.testItems[0], id: 'item-1' }],
  });
  assert.match(markdown, /무선 이어폰/);
  assert.match(markdown, /실제 조건에서 확인/);
  assert.match(markdown, /실제로 수행한 테스트만 기록/);
  assert.match(markdown, /협찬 사실/);
  assert.match(formatReviewGuideText({
    ...draft, content: '', checklist: [], productName: input.product.name,
    targetCustomers: input.product.targetCustomers, generatedAt: new Date().toISOString(),
    testItems: [{ ...draft.testItems[0], id: 'item-1' }],
  }), /무선 이어폰/);
});

test('Gemini generates a project-ready guide through the existing validated endpoint', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('gemini-3.5-flash-lite:generateContent'));
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }] });
  };
  try {
    const result = await generateGuide(request('http://localhost/api/generate-guide', { provider: 'gemini', key: 'fake-gemini-key', input }));
    assert.equal(result.status, 200);
    const { guide } = await result.json();
    assert.equal(guide.provider, 'gemini');
    assert.equal(guide.model, 'gemini-3.5-flash-lite');
    assert.equal(guide.testItems.length, input.evaluationItems.length);
  } finally { globalThis.fetch = originalFetch; }
});

test('Gemini repairs a mismatched evaluation title once and requests the required guide schema', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.deepEqual(body.generationConfig.responseJsonSchema.properties.testItems.items.properties.title.enum, input.evaluationItems);
    if (calls === 2) assert.ok(JSON.stringify(body).includes('평가 항목'));
    const value = calls === 1 ? { ...draft, testItems: draft.testItems.map(item => ({ ...item, title: `${item.title} 테스트` })) } : draft;
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });
  };
  try {
    const provider = createAIProvider('gemini', { model: 'gemini-3.5-flash-lite', apiKey: 'fake-key' });
    const result = await provider.generateGuide({ task: 'guide-generation', input });
    assert.equal(calls, 2);
    assert.deepEqual(result.testItems.map(item => item.title), input.evaluationItems);
  } finally { globalThis.fetch = originalFetch; }
});

test('Gemini supplies application-owned disclosure and writing rules without retrying missing advice', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...draft, writingGuidance: ['실제 경험을 작성하세요.', '관찰 조건을 적으세요.', '아쉬운 점을 적으세요.'] }) }] } }] });
  };
  try {
    const result = await generateGuide(request('http://localhost/api/generate-guide', { provider: 'gemini', key: 'fake-key', input }));
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.ok(body.guide.writingGuidance.some(item => item.includes('협찬')));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('guide warnings prohibiting hazards or forced positive reviews are accepted', () => {
  const safe = { ...draft, writingGuidance: [
    ...draft.writingGuidance,
    '제품을 분해하지 마세요. 침수 테스트는 하지 마세요. 물에 담그지 마세요.',
    '긍정적으로 작성하지 마세요. 좋은 점만 쓰지 말고 실제 단점도 작성하세요.',
    'Do not disassemble. Never submerge. Avoid immersion.',
  ] };
  assert.doesNotThrow(() => parseGuideGenerationResponse(JSON.stringify(safe), input));
});

test('safe warnings do not mask dangerous actions or forced positive reviews elsewhere', () => {
  for (const text of ['분해하지 마세요. 제품을 물에 담그세요.', '침수 테스트는 하지 마세요. 제품을 분해하세요.', '긍정적으로 작성하지 마세요. 단점을 숨기세요.', '제품을 분해한 뒤 물에 담그지 마세요.']) {
    assert.throws(() => parseGuideGenerationResponse(JSON.stringify({ ...draft,
      testItems: draft.testItems.map(item => ({ ...item, method: text })),
    }), input), /테스트 1번/);
  }
});

test('generated advice is normalized across coordinated warnings, bias, missing and malformed lists', async () => {
  const { parseGeneratedGuideResponse, STANDARD_GUIDE_WRITING_GUIDANCE } = await importTypeScriptModule('../lib/ai/schemas.ts');
  for (const writingGuidance of [undefined, null, '글로 반환된 작성 안내', [],
    ['제품 분해나 침수 등 위험한 테스트는 절대 하지 마세요.', '분해, 침수 테스트는 금지합니다.'],
    ['좋은 점만 긍정적으로 작성하세요.', '제품을 물에 담가 보세요.', '실제로 관찰한 조건을 기록하세요.'],
  ]) {
    const value = parseGeneratedGuideResponse(JSON.stringify({ ...draft, writingGuidance }), input);
    assert.deepEqual(value.writingGuidance.slice(0, 4), STANDARD_GUIDE_WRITING_GUIDANCE);
    assert.ok(value.writingGuidance.length <= 12);
    assert.deepEqual(value.testItems.map(item => item.title), input.evaluationItems);
  }
  assert.throws(() => parseGeneratedGuideResponse(JSON.stringify({ ...draft,
    testItems: draft.testItems.map(item => ({ ...item, method: '제품을 분해하여 테스트하세요.' })),
  }), input), /테스트 1번.*위험/);
  assert.throws(() => parseGeneratedGuideResponse(JSON.stringify({ ...draft, testItems: [] }), input), /가이드 검증/);
});
