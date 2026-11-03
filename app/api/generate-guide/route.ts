import { createAIProvider } from '../../../lib/ai/provider';
import { AIServiceError, toAIServiceError } from '../../../lib/ai/errors';
import { validateGuideGenerationRequest } from '../../../lib/ai/schemas';
import { DEFAULT_AI_SETTINGS, type AIProviderKind } from '../../../lib/ai/types';
import type { ReviewGuide } from '../../../lib/types';
import { formatReviewGuideMarkdown } from '../../../lib/guide';

type GenerateGuideRequest = {
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
    if (raw.length > 100_000) throw new AIServiceError('invalid-request', 413);
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new AIServiceError('invalid-request', 400);
    const { provider, model, key, input } = body as GenerateGuideRequest;
    if ((provider !== 'openai' && provider !== 'ollama' && provider !== 'gemini')
      || (model !== undefined && (typeof model !== 'string' || model.length > 200))) {
      throw new AIServiceError('invalid-request', 400);
    }
    if (provider === 'openai' && typeof key !== 'string') {
      throw new AIServiceError('missing-api-key', 400);
    }

    const selectedProvider = provider as AIProviderKind;
    const guideRequest = validateGuideGenerationRequest({ task: 'guide-generation', input });
    const selectedModel = typeof model === 'string'
      ? model.trim()
      : DEFAULT_AI_SETTINGS.models[selectedProvider];
    const aiProvider = createAIProvider(selectedProvider, {
      model: selectedModel,
      ...(typeof key === 'string' ? { apiKey: key } : {}),
    });
    const draft = await aiProvider.generateGuide(guideRequest);
    const generatedAt = new Date().toISOString();
    const guide: ReviewGuide = {
      content: '',
      checklist: draft.testItems.flatMap(item => item.checklist),
      generatedAt,
      updatedAt: generatedAt,
      title: draft.title,
      productName: guideRequest.input.product.name,
      targetCustomers: guideRequest.input.product.targetCustomers,
      purpose: draft.purpose,
      testItems: draft.testItems,
      writingGuidance: draft.writingGuidance,
      provider: aiProvider.kind,
      model: aiProvider.model,
    };
    guide.content = formatReviewGuideMarkdown(guide);
    return json({ guide });
  } catch (error) {
    const serviceError = error instanceof SyntaxError
      ? new AIServiceError('invalid-request', 400)
      : toAIServiceError(error);
    return json({ error: serviceError.message, code: serviceError.code }, serviceError.status);
  }
}
