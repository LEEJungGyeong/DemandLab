import { createAIProvider } from '../../../lib/ai/provider';
import { AIServiceError, toAIServiceError } from '../../../lib/ai/errors';
import { validateReviewCheckRequest } from '../../../lib/ai/schemas';
import { DEFAULT_AI_SETTINGS, type AIProviderKind } from '../../../lib/ai/types';

type CheckReviewRequest = {
  provider?: unknown;
  model?: unknown;
  key?: unknown;
  input?: unknown;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return json({ error: '허용되지 않은 요청입니다.' }, 403);
  }

  try {
    const raw = await request.text();
    if (raw.length > 500_000) throw new AIServiceError('invalid-request', 413);
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new AIServiceError('invalid-request', 400);
    const { provider, model, key, input } = body as CheckReviewRequest;
    if ((provider !== 'openai' && provider !== 'ollama' && provider !== 'gemini')
      || (model !== undefined && (typeof model !== 'string' || model.length > 200))) {
      throw new AIServiceError('invalid-request', 400);
    }
    if (key !== undefined && (typeof key !== 'string' || key.length > 500)) {
      throw new AIServiceError('invalid-request', 400);
    }
    if (provider === 'openai' && typeof key !== 'string') {
      throw new AIServiceError('missing-api-key', 400);
    }

    const selectedProvider = provider as AIProviderKind;
    const checkRequest = validateReviewCheckRequest({ task: 'review-check', input });
    const selectedModel = typeof model === 'string'
      ? model.trim()
      : DEFAULT_AI_SETTINGS.models[selectedProvider];
    const aiProvider = createAIProvider(selectedProvider, {
      model: selectedModel,
      ...(typeof key === 'string' ? { apiKey: key } : {}),
    });
    const result = await aiProvider.checkReviews(checkRequest);
    return json({
      inspections: result.inspections,
      metadata: {
        provider: aiProvider.kind,
        model: aiProvider.model,
        inspectedAt: new Date().toISOString(),
        guideVersion: checkRequest.input.guideVersion,
      },
    });
  } catch (error) {
    const serviceError = error instanceof SyntaxError
      ? new AIServiceError('invalid-request', 400)
      : toAIServiceError(error);
    return json({ error: serviceError.message, code: serviceError.code }, serviceError.status);
  }
}
