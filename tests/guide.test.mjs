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
