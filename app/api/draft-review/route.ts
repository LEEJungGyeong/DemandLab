import { createAIProvider } from '../../../lib/ai/provider';
import { AIServiceError, toAIServiceError } from '../../../lib/ai/errors';
import { validateReviewDraftInput } from '../../../lib/ai/review-draft';
import { DEFAULT_AI_SETTINGS } from '../../../lib/ai/types';

const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 100_000) throw new AIServiceError('invalid-request', 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new AIServiceError('invalid-request', 400);
    const { provider, model, key, input } = body;
    if ((provider !== 'openai' && provider !== 'ollama' && provider !== 'gemini')
      || (model !== undefined && (typeof model !== 'string' || model.length > 200))
      || (key !== undefined && (typeof key !== 'string' || key.length > 512))) {
      throw new AIServiceError('invalid-request', 400);
    }
    const validated = validateReviewDraftInput(input);
    const ai = createAIProvider(provider, {
      model: typeof model === 'string' ? model.trim() : DEFAULT_AI_SETTINGS.models[provider as 'openai' | 'ollama' | 'gemini'],
      ...(typeof key === 'string' ? { apiKey: key } : {}),
    });
    const draft = await ai.draftReview(validated);
    return json({ draft: { ...draft, provider: ai.kind, model: ai.model,
      guideVersion: validated.guideVersion, generatedAt: new Date().toISOString() } });
  } catch (error) {
    const e = error instanceof SyntaxError ? new AIServiceError('invalid-request', 400) : toAIServiceError(error);
    return json({ error: e.message, code: e.code }, e.status);
  }
}
