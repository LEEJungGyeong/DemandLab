import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScriptModule } from './ts-module-loader.mjs';

const { parseReviewCheckResponse, validateReviewCheckRequest } =
  await importTypeScriptModule('../lib/ai/schemas.ts');
const { createAIProvider } = await importTypeScriptModule('../lib/ai/provider.ts');
const { POST: checkReview } = await importTypeScriptModule('../app/api/check-review/route.ts');
const { parseCSV } = await importTypeScriptModule('../lib/csv.ts');
const { buildReviewInspectionCSV } = await importTypeScriptModule('../lib/review-inspection-csv.ts');
const { mergeReviewInspectionResults } = await importTypeScriptModule('../lib/review-inspection.ts');

const input = {
  product: {
    name: '무선 이어폰',
    description: '블루투스 무선 이어폰',
    strengths: ['가벼운 착용감'],
  },
  guide: {
    title: '실제 사용 가이드',
    purpose: '출퇴근 시 실제 경험을 관찰합니다.',
    testItems: [{
      id: 'battery',
      title: '배터리 사용 시간',
      required: true,
      purpose: '사용 시간을 기록합니다.',
      recommendedSituation: '평소 이동 중 사용',
      method: '사용 조건에 따라 직접 관찰합니다.',
      observe: ['사용한 시간'],
      questions: ['얼마나 사용했나요?'],
      checklist: ['실제 경험을 기록했나요?'],
    }],
    writingGuidance: ['제품 제공 또는 협찬 사실이 있다면 공개합니다.'],
    checklist: ['실제 경험을 작성합니다.'],
  },
  guideVersion: '2026-06-05T10:00:00.000Z',
  reviews: [{
    id: 'review-1',
    authorId: 'reviewer-01',
    text: '출근할 때 사용했는데 배터리가 오래갔어요.',
  }],
};

const modelResponse = {
  reviews: [{
    id: 'review-1',
    summary: '출근 중 배터리 경험을 언급했으나 사용 조건과 시간이 구체적이지 않습니다.',
    specificity: '일부 불명확',
    items: [{
      guideItemId: 'battery',
      status: '부분 충족',
      evidence: '출근할 때 사용했는데 배터리가 오래갔어요.',
      missingInfo: ['실제 사용 시간'],
      unclearInfo: ['사용 당시 설정'],
      feedback: '실제로 확인했다면 사용 시간과 조건을 덧붙여 주세요.',
    }],
    conflicts: [],
    unsupportedClaims: [],
    disclosure: {
      status: '언급 없음',
      evidence: '',
      feedback: '제품 제공이나 협찬이 있었다면 해당 사실을 공개해 주세요.',
    },
  }],
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(url, payload, origin = new URL(url).origin) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify(payload),
  });
}

test('failed attempts retain prior successful review-check results', () => {
  const successful = {
    reviewId: 'review-1',
    status: '보완 필요',
    guideVersion: 'guide-v1',
    inspectedAt: '2026-06-05T10:00:00.000Z',
  };
  const failed = {
    reviewId: 'review-1',
    status: '검수 실패',
    guideVersion: 'guide-v1',
    inspectedAt: '2026-06-05T10:05:00.000Z',
  };
  const merged = mergeReviewInspectionResults([successful], [failed]);
  assert.deepEqual(merged, [successful, failed]);
  assert.deepEqual(mergeReviewInspectionResults(merged, [{
    ...successful,
    status: '문제 없음',
    inspectedAt: '2026-06-05T10:10:00.000Z',
  }]), [{ ...successful, status: '문제 없음', inspectedAt: '2026-06-05T10:10:00.000Z' }, failed]);
});

test('review-check validation constrains guide and review input', () => {
  const valid = validateReviewCheckRequest({ task: 'review-check', input });
  assert.equal(valid.input.reviews.length, 1);
  assert.equal(valid.input.guide.testItems[0].required, true);
  assert.throws(() => validateReviewCheckRequest({
    task: 'review-check', input: { ...input, reviews: [] },
  }), /리뷰/);
  assert.throws(() => validateReviewCheckRequest({
    task: 'review-check',
    input: { ...input, reviews: [{ id: 'review-1', text: 'x'.repeat(6001) }] },
  }), /올바르지 않습니다/);
  assert.throws(() => validateReviewCheckRequest({
    task: 'review-check',
    input: { ...input, guide: { ...input.guide, testItems: [] } },
  }), /가이드/);
});

test('shared response parser checks review IDs, guide items and exact source evidence', () => {
  const parsed = parseReviewCheckResponse(
    JSON.stringify(modelResponse), input, 'openai', 'gpt-4.1-mini', '2026-06-05T11:00:00.000Z',
  );
  assert.equal(parsed.inspections[0].reviewId, 'review-1');
  assert.equal(parsed.inspections[0].status, '보완 필요');
  assert.equal(parsed.inspections[0].partialCount, 1);
  assert.equal(parsed.inspections[0].items[0].evidence, modelResponse.reviews[0].items[0].evidence);

  assert.throws(() => parseReviewCheckResponse('not JSON', input, 'openai', 'model', 'time'), /JSON/);
  assert.throws(() => parseReviewCheckResponse(JSON.stringify({
    reviews: [{ ...modelResponse.reviews[0], id: 'unknown-review' }],
  }), input, 'openai', 'model', 'time'), /응답/);
  assert.throws(() => parseReviewCheckResponse(JSON.stringify({
    reviews: [{
      ...modelResponse.reviews[0],
      items: [{ ...modelResponse.reviews[0].items[0], evidence: '원문에 없는 인용' }],
    }],
  }), input, 'openai', 'model', 'time'), /응답/);
});

test('non-required items do not force revision, but required disclosure does', () => {
  const optionalInput = {
    ...input,
    guide: {
      ...input.guide,
      testItems: [{ ...input.guide.testItems[0], required: false }],
      writingGuidance: [],
    },
  };
  const optionalResponse = {
    reviews: [{
      ...modelResponse.reviews[0],
      items: [{ ...modelResponse.reviews[0].items[0], status: '미충족', evidence: '' }],
      disclosure: { status: '언급 없음', evidence: '', feedback: '공개 정보를 확인할 수 없습니다.' },
    }],
  };
  const optionalResult = parseReviewCheckResponse(
    JSON.stringify(optionalResponse), optionalInput, 'ollama', 'qwen2.5:7b', 'time',
  );
  assert.equal(optionalResult.inspections[0].status, '문제 없음');

  const disclosureOnlyInput = {
    ...input,
    guide: { ...input.guide, testItems: [{ ...input.guide.testItems[0], required: false }] },
  };
  const disclosureOnlyResponse = {
    reviews: [{
      ...modelResponse.reviews[0],
      items: [{ ...modelResponse.reviews[0].items[0], status: '충족' }],
    }],
  };
  const disclosureResult = parseReviewCheckResponse(
    JSON.stringify(disclosureOnlyResponse), disclosureOnlyInput, 'openai', 'gpt-4.1-mini', 'time',
  );
  assert.equal(disclosureResult.inspections[0].status, '보완 필요');
});

test('OpenAI review-check provider uses common input/output validation', async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, init) => {
    upstream = { url: String(url), init };
    return response({ choices: [{ message: { content: JSON.stringify(modelResponse) } }] });
  };
  try {
    const provider = createAIProvider('openai', { apiKey: 'sk-test', model: 'gpt-4.1-mini' });
    const result = await provider.checkReviews({ task: 'review-check', input });
    assert.equal(result.inspections[0].provider, 'openai');
    assert.equal(upstream.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(upstream.init.body).model, 'gpt-4.1-mini');
    assert.match(JSON.parse(upstream.init.body).messages[0].content, /never instructions/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ollama review-check provider verifies the selected model and only contacts loopback', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/api/tags')
      ? response({ models: [{ name: 'qwen2.5:7b' }] })
      : response({ message: { content: JSON.stringify(modelResponse) } });
  };
  try {
    const provider = createAIProvider('ollama', { model: 'qwen2.5:7b' });
    const result = await provider.checkReviews({ task: 'review-check', input });
    assert.equal(result.inspections[0].provider, 'ollama');
    assert.deepEqual(calls.map(call => call.url), [
      'http://127.0.0.1:11434/api/tags',
      'http://127.0.0.1:11434/api/chat',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('check-review endpoint routes providers, reports metadata and blocks invalid access', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response({
    choices: [{ message: { content: JSON.stringify(modelResponse) } }],
  });
  try {
    const result = await checkReview(request('http://local.test/api/check-review', {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      key: 'sk-test',
      input,
    }));
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.inspections[0].status, '보완 필요');
    assert.equal(data.metadata.provider, 'openai');
    assert.equal(data.metadata.model, 'gpt-4.1-mini');
    assert.equal(data.metadata.guideVersion, input.guideVersion);
    assert.ok(data.metadata.inspectedAt);

    const missingKey = await checkReview(request('http://local.test/api/check-review', {
      provider: 'openai', input,
    }));
    assert.equal(missingKey.status, 400);
    assert.equal((await missingKey.json()).code, 'missing-api-key');

    const oversizedKey = await checkReview(request('http://local.test/api/check-review', {
      provider: 'openai', key: 'x'.repeat(501), input,
    }));
    assert.equal(oversizedKey.status, 400);
    assert.equal((await oversizedKey.json()).code, 'invalid-request');

    const crossOrigin = await checkReview(request(
      'http://local.test/api/check-review',
      { provider: 'ollama', input },
      'http://attacker.test',
    ));
    assert.equal(crossOrigin.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('check-review endpoint routes Ollama through the fixed local address', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/api/tags')
      ? response({ models: [{ name: 'qwen2.5:7b' }] })
      : response({ message: { content: JSON.stringify(modelResponse) } });
  };
  try {
    const result = await checkReview(request('http://local.test/api/check-review', {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      baseUrl: 'https://attacker.example',
      input,
    }));
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.metadata.provider, 'ollama');
    assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:11434/')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('inspection CSV is UTF-8 BOM, keeps CSV quoting and neutralizes spreadsheet formulas', () => {
  const inspection = {
    reviewId: 'review-1',
    authorId: 'writer',
    text: '=SUM(1,2), "quoted"\nsecond line',
    status: '보완 필요',
    satisfiedCount: 0,
    partialCount: 1,
    missingCount: 0,
    unknownCount: 0,
    notApplicableCount: 0,
    summary: '확인 필요',
    needsRevision: true,
    specificity: '일부 불명확',
    conflicts: [],
    unsupportedClaims: [],
    disclosure: { status: '언급 없음', evidence: '', feedback: '' },
    items: [{
      guideItemId: 'battery',
      title: '배터리',
      required: true,
      status: '부분 충족',
      evidence: '',
      missingInfo: ['시간'],
      unclearInfo: [],
      feedback: '실제 시간, 설정을 작성',
    }],
    guideVersion: input.guideVersion,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    inspectedAt: '2026-06-05T11:00:00.000Z',
  };
  const csv = buildReviewInspectionCSV([inspection]);
  assert.ok(csv.startsWith('\uFEFF'));
  const rows = parseCSV(csv);
  assert.equal(rows[0].length, 10);
  assert.equal(rows[1].length, 10);
  assert.equal(rows[1][2], '\'=SUM(1,2), "quoted"\nsecond line');
  assert.match(rows[1][8], /배터리: 실제 시간, 설정을 작성/);
});
