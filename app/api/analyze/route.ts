import { createAIProvider } from '../../../lib/ai/provider';
import { AIServiceError, toAIServiceError } from '../../../lib/ai/errors';
import { validateReviewAnalysisRequest } from '../../../lib/ai/schemas';
import { DEFAULT_AI_SETTINGS, type AIProviderKind } from '../../../lib/ai/types';

type AnalyzeRequest = {
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
    const { key, provider, model, reviews } = body as AnalyzeRequest;
    const selectedProvider = provider === undefined ? 'openai' : provider;
    if (selectedProvider !== 'openai' && selectedProvider !== 'ollama') {
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
      : selectedProvider === 'openai'
        ? DEFAULT_AI_SETTINGS.models.openai
        : '';
    const aiProvider = createAIProvider(selectedProvider as AIProviderKind, {
      model: selectedModel,
      ...(typeof key === 'string' ? { apiKey: key } : {}),
    });
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
