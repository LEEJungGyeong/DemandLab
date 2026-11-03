import { createAIProvider } from '../../../lib/ai/provider';
import { AIServiceError, toAIServiceError } from '../../../lib/ai/errors';
import { validateReviewAnalysisRequest } from '../../../lib/ai/schemas';
import { DEFAULT_AI_SETTINGS, type AIProviderKind } from '../../../lib/ai/types';

type AnalyzeRequest = {
  stream?: unknown;
  key?: unknown;
  provider?: unknown;
  model?: unknown;
  reviews?: unknown;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return json({ error: '허용되지 않은 요청입니다.' }, 403);
  }

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') throw new AIServiceError('invalid-request', 400);
    const { key, provider, model, reviews, stream } = body as AnalyzeRequest;
    const selectedProvider = provider === undefined ? 'openai' : provider;
    if (selectedProvider !== 'openai' && selectedProvider !== 'ollama' && selectedProvider !== 'gemini') {
      throw new AIServiceError('invalid-request', 400);
    }
    if (model !== undefined && (typeof model !== 'string' || model.length > 200
      || (selectedProvider === 'openai' && !model.trim()))) {
      throw new AIServiceError('invalid-request', 400);
    }
    if (selectedProvider === 'openai' && typeof key !== 'string') {
      throw new AIServiceError('missing-api-key', 400);
    }

    const analysisRequest = validateReviewAnalysisRequest({
      task: 'review-analysis',
      reviews,
    });
    const selectedModel = typeof model === 'string'
      ? model.trim()
      : DEFAULT_AI_SETTINGS.models[selectedProvider];
    const aiProvider = createAIProvider(selectedProvider as AIProviderKind, {
      model: selectedModel,
      ...(typeof key === 'string' ? { apiKey: key } : {}),
    });
    if (selectedProvider === 'gemini' && stream === true) {
      const encoder = new TextEncoder();
      let cancelled = false;
      const body = new ReadableStream({
        async start(controller) {
          const send = (value: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
          try {
            const analysis = await aiProvider.analyzeReviews(analysisRequest, (completed, total) => {
              if (cancelled || request.signal.aborted) throw new AIServiceError('network-error', 499);
              send({ type: 'progress', completed, total });
            });
            send({ type: 'result', data: { ...analysis, metadata: { provider: aiProvider.kind, model: aiProvider.model, analyzedAt: new Date().toISOString() } } });
          } catch (error) {
            const failure = toAIServiceError(error);
            send({ type: 'error', error: failure.message, code: failure.code });
          } finally { if (!cancelled) controller.close(); }
        },
        cancel() { cancelled = true; },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
    }
    const analysis = await aiProvider.analyzeReviews(analysisRequest);
    return json({
      themes: analysis.themes,
      results: analysis.results,
      dropped: analysis.dropped,
      missingReviewIds: analysis.missingReviewIds,
      metadata: {
        provider: aiProvider.kind,
        model: aiProvider.model,
        analyzedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const serviceError = error instanceof SyntaxError
      ? new AIServiceError('invalid-request', 400)
      : toAIServiceError(error);
    return json({ error: serviceError.message, code: serviceError.code }, serviceError.status);
  }
}
