import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScriptModule } from './ts-module-loader.mjs';
const { createAIProvider } = await importTypeScriptModule('../lib/ai/provider.ts');
const { DEFAULT_AI_SETTINGS } = await importTypeScriptModule('../lib/ai/types.ts');
const { POST: settings } = await importTypeScriptModule('../app/api/ai/route.ts');
const { POST: analyze } = await importTypeScriptModule('../app/api/analyze/route.ts');
const { readAnalysisResponse } = await importTypeScriptModule('../lib/ai/analysis-stream.ts');
const model = 'gemini-3.5-flash-lite';
const key = 'AIza-fake-test-key';
function request(path, data) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
function generated(value) {
  return Response.json({ candidates: [{ content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] }, finishReason: 'STOP' }] });
}
async function mockFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { await run(); } finally { globalThis.fetch = original; }
}
function content(init) { return JSON.parse(JSON.parse(init.body).contents[0].parts[0].text); }
function analysis(reviews, theme = '착용감') {
  return { themes: [{ name: theme }], results: reviews.map(review => ({ id: review.id, theme, subtheme: '일상 사용', sentiment: '긍정', evidence: review.text })) };
}

test('Gemini default and connection test use real generateContent, header key and Korean generation', async () => {
  assert.equal(DEFAULT_AI_SETTINGS.models.gemini, model);
  let calls = 0;
  await mockFetch(async (url, init) => {
    calls++;
    assert.ok(String(url).includes(`${model}:generateContent`));
    assert.ok(!String(url).includes(key));
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), key);
    return generated('연결 확인');
  }, async () => {
    const result = await settings(request('/api/ai', { provider: 'gemini', action: 'test', key }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).modelAvailable, true);
    assert.equal(calls, 1);
  });
});

test('Gemini 100 reviews retain IDs/evidence, merge synonymous themes and stream progress', async () => {
  const reviews = Array.from({ length: 100 }, (_, i) => ({ id: i + 15, text: `사용 후기 ${i} 편해요` }));
  let batches = 0;
  await mockFetch(async (url, init) => {
    const input = content(init);
    if (typeof input[0] === 'string') return generated({ mapping: [{ from: '착용감', to: '착용감' }, { from: '착용 편안함', to: '착용감' }] });
    assert.ok(input.length <= 10);
    batches++;
    const config = JSON.parse(init.body).generationConfig;
    assert.equal(config.responseMimeType, 'application/json');
    assert.deepEqual(config.responseJsonSchema.required, ['themes', 'results']);
    assert.deepEqual(config.responseJsonSchema.properties.results.items.properties.id, { type: 'integer' });
    assert.ok(config.responseJsonSchema.properties.results.items.required.includes('evidence'));
    return generated(analysis(input, batches % 2 ? '착용감' : '착용 편안함'));
  }, async () => {
    const response = await analyze(request('/api/analyze', { provider: 'gemini', key, reviews, stream: true }));
    const progress = [];
    const result = await readAnalysisResponse(response, (count, total) => progress.push([count, total]));
    assert.equal(batches, 10);
    assert.deepEqual(progress.at(-1), [100, 100]);
    assert.equal(progress.length, 10);
    assert.deepEqual(result.themes, [{ name: '착용감' }]);
    assert.deepEqual(result.results.map(item => item.id), reviews.map(item => item.id));
    assert.equal(new Set(result.results.map(item => item.id)).size, 100);
    assert.ok(result.results.every(item => reviews.find(review => review.id === item.id).text.includes(item.evidence)));
    assert.deepEqual(result.missingReviewIds, []);
    assert.equal(result.metadata.provider, 'gemini');
    assert.ok(!JSON.stringify(result).includes(key));
  });
});

test('Gemini errors distinguish HTTP status, redact keys and retry transient errors only once', async () => {
  for (const status of [400, 401, 403, 404, 429, 503]) {
    let calls = 0;
    await mockFetch(async () => {
      calls++;
      return Response.json({ error: { code: status, message: `Google rejected ${key}`, status: 'ERROR' } }, { status });
    }, async () => {
      const result = await settings(request('/api/ai', { provider: 'gemini', action: 'test', key }));
      assert.equal(result.status, status);
      const data = await result.json();
      assert.equal(data.code, 'gemini-error');
      assert.ok(!JSON.stringify(data).includes(key));
      assert.ok(data.error.includes('Google rejected'));
      assert.equal(calls, [429, 503].includes(status) ? 2 : 1);
    });
  }
});

test('Gemini environment key works without UI key, missing credentials fail safely', async () => {
  const old = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = key;
    await mockFetch(async () => generated('연결 성공'), async () => {
      const response = await settings(request('/api/ai', { provider: 'gemini', action: 'test' }));
      assert.equal(response.status, 200);
    });
    delete process.env.GEMINI_API_KEY;
    assert.throws(() => createAIProvider('gemini', { model }), /Gemini API 키/);
  } finally {
    if (old === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = old;
  }
});

test('Gemini rejects truncated/invalid JSON, missing reviews and fabricated evidence after bounded repair', async () => {
  const reviews = [{ id: 1, text: '편해요' }, { id: 2, text: '좋아요' }];
  for (const value of ['invalid json', analysis([reviews[0]]), { themes: [{ name: '착용감' }], results: [{ id: 1, theme: '착용감', subtheme: '사용', sentiment: '긍정', evidence: '만든 인용' }] }]) {
    let calls = 0;
    await mockFetch(async () => { calls++; return generated(value); }, async () => {
      const response = await analyze(request('/api/analyze', { provider: 'gemini', key, reviews, stream: true }));
      await assert.rejects(readAnalysisResponse(response, () => {}), /1~2번째 배치 검증/);
      assert.equal(calls, 2);
    });
  }
});

test('Gemini timeout returns 504 and empty or token-truncated output is rejected', async () => {
  await mockFetch(async () => { throw new DOMException('timeout', 'TimeoutError'); }, async () => {
    const result = await settings(request('/api/ai', { provider: 'gemini', action: 'test', key }));
    assert.equal(result.status, 504);
  });
  await mockFetch(async () => Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'MAX_TOKENS' }] }), async () => {
    const result = await settings(request('/api/ai', { provider: 'gemini', action: 'test', key }));
    assert.equal(result.status, 502);
  });
});

test('analysis stream handles split Korean UTF-8 and reports premature termination', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'result', data: { text: '한국어' } }) + '\n');
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  assert.deepEqual(await readAnalysisResponse(response, () => {}), { text: '한국어' });
  await assert.rejects(readAnalysisResponse(new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } }), () => {}), /중단/);
});


test('Gemini accepts valid chained topic mappings and preserves one result per review per theme', async () => {
  const reviews = [{ id: 1, text: '편안해요' }, { id: 2, text: '편해요' }];
  await mockFetch(async (url, init) => {
    const input = content(init);
    if (typeof input[0] === 'string') return generated({ mapping: [
      { from: '착용감', to: '편안함' }, { from: '편안함', to: '편안함' },
    ] });
    return generated({ themes: [{ name: '착용감' }, { name: '편안함' }], results: [
      ...analysis(reviews, '착용감').results, ...analysis(reviews, '편안함').results,
    ] });
  }, async () => {
    const result = await createAIProvider('gemini', { apiKey: key, model }).analyzeReviews({ task: 'review-analysis', reviews });
    assert.equal(result.results.length, 2);
    assert.deepEqual(result.themes, [{ name: '편안함' }]);
  });
});

test('Gemini identifies empty blocked output without exposing review content', async () => {
  await mockFetch(async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }), async () => {
    const result = await settings(request('/api/ai', { provider: 'gemini', action: 'test', key }));
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /생성된 텍스트가 없습니다.*SAFETY/);
  });
});


test('Gemini schema 400 falls back once to JSON mode and remembers compatibility across batches', async () => {
  const reviews = Array.from({ length: 20 }, (_, id) => ({ id, text: `후기 ${id} 편해요` }));
  const configs = [];
  await mockFetch(async (url, init) => {
    const config = JSON.parse(init.body).generationConfig;
    configs.push(config);
    if (config.responseJsonSchema) return Response.json({ error: { code: 400, message: 'Request contains an invalid argument.' } }, { status: 400 });
    return generated(analysis(content(init)));
  }, async () => {
    const result = await createAIProvider('gemini', { apiKey: key, model }).analyzeReviews({ task: 'review-analysis', reviews });
    assert.equal(result.results.length, 20);
    assert.equal(configs.length, 3);
    assert.ok(configs[0].responseJsonSchema);
    assert.ok(configs.slice(1).every(config => !config.responseJsonSchema && config.responseMimeType === 'application/json'));
  });
});

test('Gemini compatibility fallback remains bounded and still rejects invented evidence', async () => {
  let calls = 0;
  await mockFetch(async () => {
    calls++;
    return Response.json({ error: { code: 400, message: 'Request contains an invalid argument.' } }, { status: 400 });
  }, async () => {
    await assert.rejects(createAIProvider('gemini', { apiKey: key, model }).analyzeReviews({ task: 'review-analysis', reviews: [{ id: 1, text: '좋아요' }] }), /요청 형식/);
    assert.equal(calls, 2);
  });
  calls = 0;
  await mockFetch(async (url, init) => {
    calls++;
    if (JSON.parse(init.body).generationConfig.responseJsonSchema) return Response.json({ error: { code: 400, message: 'invalid schema' } }, { status: 400 });
    return generated(analysis([{ id: 1, text: '원문에 없는 근거' }]));
  }, async () => {
    await assert.rejects(createAIProvider('gemini', { apiKey: key, model }).analyzeReviews({ task: 'review-analysis', reviews: [{ id: 1, text: '좋아요' }] }), /배치 검증/);
    assert.equal(calls, 3);
  });
});

test('Gemini completes a fully covered batch while excluding six invalid extra results', async () => {
  const reviews = Array.from({ length: 10 }, (_, id) => ({ id, text: `실제 후기 ${id} 편해요` }));
  let calls = 0;
  await mockFetch(async () => {
    calls++;
    const payload = analysis(reviews);
    payload.results.push(...Array.from({ length: 6 }, (_, i) => ({ ...payload.results[i], evidence: '원문에 없는 내용' })));
    return generated(payload);
  }, async () => {
    const response = await analyze(request('/api/analyze', { provider: 'gemini', key, reviews, stream: true }));
    const result = await readAnalysisResponse(response, () => {});
    assert.equal(calls, 1);
    assert.equal(result.results.length, 10);
    assert.equal(result.dropped, 6);
    assert.deepEqual(result.missingReviewIds, []);
    assert.ok(result.results.every(result => reviews.find(review => review.id === result.id).text.includes(result.evidence)));
  });
});

test('Gemini merges valid duplicate review/theme pairs and retains mixed sentiment without double counting', async () => {
  const reviews = [{ id: 1, text: '착용은 편하지만 오래 쓰면 아파요' }];
  await mockFetch(async () => {
    const payload = analysis(reviews);
    payload.results[0].evidence = '착용은 편하지만';
    payload.results.push({ ...payload.results[0], sentiment: '부정', evidence: '오래 쓰면 아파요' });
    return generated(payload);
  }, async () => {
    const result = await createAIProvider('gemini', { apiKey: key, model }).analyzeReviews({ task: 'review-analysis', reviews });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].sentiment, '혼합');
    assert.equal(result.dropped, 0);
    assert.deepEqual(result.missingReviewIds, []);
  });
});
