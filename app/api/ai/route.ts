import { createAIProvider } from '../../../lib/ai/provider';
import { AIServiceError, toAIServiceError } from '../../../lib/ai/errors';
import { DEFAULT_AI_SETTINGS, type AIProviderKind } from '../../../lib/ai/types';

type SettingsRequest = {
  action?: unknown;
  provider?: unknown;
  model?: unknown;
  key?: unknown;
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
    const { action, provider, model, key } = body as SettingsRequest;
    if ((action !== 'test' && action !== 'models')
      || (provider !== 'openai' && provider !== 'ollama' && provider !== 'gemini')
      || (model !== undefined && (typeof model !== 'string' || model.length > 200))) {
      throw new AIServiceError('invalid-request', 400);
    }

    const selectedProvider = provider as AIProviderKind;
    const apiKey = selectedProvider !== 'ollama' ? key : undefined;
    const selectedModel = typeof model === 'string'
      ? model
      : DEFAULT_AI_SETTINGS.models[selectedProvider];
    const aiProvider = createAIProvider(selectedProvider, {
      model: selectedModel,
      ...(typeof apiKey === 'string' ? { apiKey } : {}),
    });
    if (selectedProvider === 'gemini' && action === 'test') {
      await aiProvider.testConnection!();
      return json({ provider: selectedProvider, models: [aiProvider.model], modelAvailable: true });
    }
    const models = await aiProvider.listModels();
    return json({
      provider: selectedProvider,
      models,
      modelAvailable: selectedModel ? models.includes(selectedModel) : models.length > 0,
    });
  } catch (error) {
    const serviceError = error instanceof SyntaxError
      ? new AIServiceError('invalid-request', 400)
      : toAIServiceError(error);
    return json({ error: serviceError.message, code: serviceError.code }, serviceError.status);
  }
}
