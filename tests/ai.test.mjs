import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScriptModule } from './ts-module-loader.mjs';

const { parseReviewAnalysisResponse } = await importTypeScriptModule('../lib/ai/schemas.ts');
const { createAIProvider } = await importTypeScriptModule('../lib/ai/provider.ts');
const { POST: analyze } = await importTypeScriptModule('../app/api/analyze/route.ts');
const { POST: aiSettings } = await importTypeScriptModule('../app/api/ai/route.ts');

const reviews = [
  { id: 3, text: '지하철에서 연결이 안정적이에요.' },
  { id: 8, text: '한 시간 사용하니 귀가 아파요.' },
];

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

test('shared response validation verifies schema, review IDs, sentiment and exact evidence', () => {
  const analysis = parseReviewAnalysisResponse(JSON.stringify({
    themes: [{ name: '연결 안정성', description: '연결 상태' }, { name: '착용감' }],
    results: [
      { id: 3, theme: '연결 안정성', subtheme: '지하철 연결', sentiment: '긍정', evidence: '연결이 안정적이에요' },
      { id: 8, theme: '착용감', subtheme: '장시간 착용', sentiment: '좋음', evidence: '귀가 아파요' },
      { id: 99, theme: '착용감', subtheme: '잘못된 리뷰 ID', sentiment: '부정', evidence: '귀가 아파요' },
      { id: 8, theme: '착용감', subtheme: '없는 근거', sentiment: '부정', evidence: '아주 편해요' },
    ],
  }), reviews);

  assert.equal(analysis.results.length, 1);
  assert.equal(analysis.dropped, 3);
  assert.deepEqual(analysis.missingReviewIds, [8]);
  assert.throws(() => parseReviewAnalysisResponse('not JSON', reviews), /JSON/);
  assert.throws(() => parseReviewAnalysisResponse('{"themes":[],"results":[]}', reviews), /응답/);
});

test('OpenAI provider uses the shared analysis shape and server-side key', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/models')) return response({ data: [{ id: 'gpt-4.1-mini' }] });
    return response({ choices: [{ message: { content: JSON.stringify({
      themes: [{ name: '연결 안정성' }],
      results: [{ id: 3, theme: '연결 안정성', subtheme: '지하철 연결', sentiment: '긍정', evidence: '연결이 안정적이에요' }],
    }) } }] });
  };
  try {
    const provider = createAIProvider('openai', { apiKey: 'sk-test', model: 'gpt-4.1-mini' });
    assert.deepEqual(await provider.listModels(), ['gpt-4.1-mini']);
    const result = await provider.analyzeReviews({ task: 'review-analysis', reviews: [reviews[0]] });
    assert.equal(result.results[0].theme, '연결 안정성');
    assert.equal(calls[1].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[1].init.headers.Authorization, 'Bearer sk-test');
    assert.equal(JSON.parse(calls[1].init.body).model, 'gpt-4.1-mini');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ollama provider enumerates installed models and calls only the fixed loopback server', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/tags')) return response({ models: [{ name: 'qwen2.5:7b' }] });
    return response({ message: { content: JSON.stringify({
      themes: [{ name: '연결 안정성' }],
      results: [{ id: 3, theme: '연결 안정성', subtheme: '지하철 연결', sentiment: '긍정', evidence: '연결이 안정적이에요' }],
    }) } });
  };
  try {
    const provider = createAIProvider('ollama', { model: 'qwen2.5:7b' });
    assert.deepEqual(await provider.listModels(), ['qwen2.5:7b']);
    const result = await provider.analyzeReviews({ task: 'review-analysis', reviews: [reviews[0]] });
    assert.equal(result.results[0].id, 3);
    assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:11434/')));
    assert.equal(calls.at(-1).url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(JSON.parse(calls.at(-1).init.body).model, 'qwen2.5:7b');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy analyze requests still use OpenAI, and responses include provider metadata', async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, init) => {
    upstream = { url: String(url), init };
    return response({ choices: [{ message: { content: JSON.stringify({
      themes: [{ name: '연결 안정성' }],
      results: [{ id: 3, theme: '연결 안정성', subtheme: '지하철 연결', sentiment: '긍정', evidence: '연결이 안정적이에요' }],
    }) } }] });
  };
  try {
    const result = await analyze(request('http://local.test/api/analyze', { key: 'sk-test', reviews: [reviews[0]] }));
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(upstream.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(data.metadata.provider, 'openai');
    assert.equal(data.metadata.model, 'gpt-4.1-mini');
    assert.equal(data.results[0].evidence, '연결이 안정적이에요');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analyze endpoint routes Ollama requests through the fixed local provider', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/tags')) return response({ models: [{ name: 'qwen2.5:7b' }] });
    return response({ message: { content: JSON.stringify({
      themes: [{ name: '착용감' }],
      results: [{ id: 8, theme: '착용감', subtheme: '장시간 착용', sentiment: '부정', evidence: '귀가 아파요' }],
    }) } });
  };
  try {
    const result = await analyze(request('http://local.test/api/analyze', {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      baseUrl: 'https://attacker.example',
      reviews: [reviews[1]],
    }));
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.metadata.provider, 'ollama');
    assert.equal(data.metadata.model, 'qwen2.5:7b');
    const sent = JSON.parse(calls.find(call => call.url.endsWith('/api/chat')).init.body);
    assert.deepEqual(sent.format.properties.results.items.properties.id.enum, [reviews[1].id]);
    assert.ok(sent.format.required.includes('themes'));
    assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:11434/')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI settings endpoint reports missing credentials and blocks cross-origin requests', async () => {
  const missingKey = await aiSettings(request('http://local.test/api/ai', {
    action: 'test', provider: 'openai', model: 'gpt-4.1-mini',
  }));
  assert.equal(missingKey.status, 400);
  assert.match((await missingKey.json()).error, /API 키/);

  const crossOrigin = await aiSettings(request(
    'http://local.test/api/ai',
    { action: 'test', provider: 'ollama' },
    'http://attacker.test',
  ));
  assert.equal(crossOrigin.status, 403);
});

test('Ollama connection test returns the installed model list', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl;
  globalThis.fetch = async url => {
    calledUrl = String(url);
    return response({ models: [{ name: 'llama3.2:latest' }] });
  };
  try {
    const result = await aiSettings(request('http://local.test/api/ai', {
      action: 'test',
      provider: 'ollama',
      model: '',
    }));
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.deepEqual(data.models, ['llama3.2:latest']);
    assert.equal(data.modelAvailable, true);
    assert.equal(calledUrl, 'http://127.0.0.1:11434/api/tags');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analysis returns a model-missing error instead of silently substituting an Ollama model', async () => {
  const result = await analyze(request('http://local.test/api/analyze', {
    provider: 'ollama',
    model: '',
    reviews: [reviews[0]],
  }));
  const data = await result.json();
  assert.equal(result.status, 400);
  assert.equal(data.code, 'ollama-model-missing');
});

test('OpenAI authentication and usage-limit responses remain distinguishable', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, code] of [[401, 'openai-authentication'], [429, 'openai-rate-limit']]) {
      globalThis.fetch = async () => response({ error: { message: 'redacted upstream response' } }, status);
      const provider = createAIProvider('openai', { apiKey: 'sk-test', model: 'gpt-4.1-mini' });
      await assert.rejects(provider.listModels(), error => {
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /redacted/);
        return true;
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ollama model discovery reports a missing local server without making fallback requests', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(
      createAIProvider('ollama', { model: '' }).listModels(),
      /Ollama에 연결할 수 없습니다/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
