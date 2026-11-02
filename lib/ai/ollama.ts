import type {
  AIProvider, AIProviderConfig, GuideGenerationRequest, ReviewAnalysisRequest, ReviewAnalysisResponse,
  ReviewCheckRequest,
} from './types';
import { AIServiceError } from './errors';
import {
  GUIDE_GENERATION_SYSTEM_PROMPT, parseGuideGenerationResponse, parseReviewAnalysisResponse,
  parseReviewCheckResponse, REVIEW_ANALYSIS_SYSTEM_PROMPT, REVIEW_CHECK_SYSTEM_PROMPT,
} from './schemas';
import { OLLAMA_BASE_URL } from './constants';

export { OLLAMA_BASE_URL } from './constants';

async function ollamaRequest(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(init?.method === 'POST' ? 180000 : 10000),
    });
  } catch {
    throw new AIServiceError('ollama-unavailable', 503);
  }
  if (response.status === 404 && path === '/api/chat') {
    throw new AIServiceError('ollama-model-missing', 404);
  }
  if (!response.ok) throw new AIServiceError('provider-error', 502);
  return response;
}

async function readModels(): Promise<string[]> {
  const response = await ollamaRequest('/api/tags');
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown }).models)) {
    throw new AIServiceError('invalid-response');
  }
  return (payload as { models: unknown[] }).models.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const model = item as { name?: unknown; model?: unknown };
    const name = typeof model.name === 'string' ? model.name : model.model;
    return typeof name === 'string' && name.trim() ? [name] : [];
  });
}

export function createOllamaProvider(config: AIProviderConfig): AIProvider {
  const model = config.model.trim();
  if (model.length > 200) throw new AIServiceError('invalid-request', 400);

  return {
    kind: 'ollama',
    model,
    listModels: readModels,
    async analyzeReviews(request: ReviewAnalysisRequest): Promise<ReviewAnalysisResponse> {
      if (!model) throw new AIServiceError('ollama-model-missing', 400);
      const availableModels = await readModels();
      if (!availableModels.includes(model)) throw new AIServiceError('ollama-model-missing', 404);
      const response = await ollamaRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: REVIEW_ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(request.reviews) },
          ],
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new AIServiceError('invalid-response');
      const message = (data as { message?: unknown }).message;
      if (!message || typeof message !== 'object'
        || typeof (message as { content?: unknown }).content !== 'string') {
        throw new AIServiceError('invalid-response');
      }
      return parseReviewAnalysisResponse((message as { content: string }).content, request.reviews);
    },
    async generateGuide(request: GuideGenerationRequest) {
      if (!model) throw new AIServiceError('ollama-model-missing', 400);
      const availableModels = await readModels();
      if (!availableModels.includes(model)) throw new AIServiceError('ollama-model-missing', 404);
      const response = await ollamaRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: GUIDE_GENERATION_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(request.input) },
          ],
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new AIServiceError('invalid-response');
      const message = (data as { message?: unknown }).message;
      if (!message || typeof message !== 'object'
        || typeof (message as { content?: unknown }).content !== 'string') {
        throw new AIServiceError('invalid-response');
      }
      return parseGuideGenerationResponse((message as { content: string }).content, request.input);
    },
    async checkReviews(request: ReviewCheckRequest) {
      if (!model) throw new AIServiceError('ollama-model-missing', 400);
      const availableModels = await readModels();
      if (!availableModels.includes(model)) throw new AIServiceError('ollama-model-missing', 404);
      const response = await ollamaRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: REVIEW_CHECK_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(request.input) },
          ],
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new AIServiceError('invalid-response');
      const message = (data as { message?: unknown }).message;
      if (!message || typeof message !== 'object'
        || typeof (message as { content?: unknown }).content !== 'string') {
        throw new AIServiceError('invalid-response');
      }
      return parseReviewCheckResponse(
        (message as { content: string }).content,
        request.input,
        'ollama',
        model,
        new Date().toISOString(),
      );
    },
  };
}
