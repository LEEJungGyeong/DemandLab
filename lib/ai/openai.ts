import type {
  AIProvider, AIProviderConfig, GuideGenerationRequest, ReviewAnalysisRequest, ReviewAnalysisResponse,
  ReviewCheckRequest,
} from './types';
import { AIServiceError, toAIServiceError } from './errors';
import {
  GUIDE_GENERATION_SYSTEM_PROMPT, parseGuideGenerationResponse, parseReviewAnalysisResponse,
  parseReviewCheckResponse, REVIEW_ANALYSIS_SYSTEM_PROMPT, REVIEW_CHECK_SYSTEM_PROMPT,
} from './schemas';

const OPENAI_API = 'https://api.openai.com/v1';

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey?.startsWith('sk-') || apiKey.length > 512) {
    throw new AIServiceError('missing-api-key', 400);
  }
  return apiKey;
}

async function openAIRequest(
  path: string,
  apiKey: string,
  init?: RequestInit,
  timeout = 15000,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${OPENAI_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, ...init?.headers },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw toAIServiceError(error);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AIServiceError('openai-authentication', response.status);
    }
    if (response.status === 429) throw new AIServiceError('openai-rate-limit', 429);
    if (path === '/chat/completions' && (response.status === 400 || response.status === 404)) {
      throw new AIServiceError('openai-model-error', response.status);
    }
    throw new AIServiceError('provider-error', 502);
  }
  return response;
}

export function createOpenAIProvider(config: AIProviderConfig): AIProvider {
  const apiKey = requireApiKey(config.apiKey);
  const model = config.model.trim();
  if (!model || model.length > 100) throw new AIServiceError('invalid-request', 400);

  return {
    kind: 'openai',
    model,
    async listModels() {
      const response = await openAIRequest('/models', apiKey);
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== 'object' || !Array.isArray((data as { data?: unknown }).data)) {
        throw new AIServiceError('invalid-response');
      }
      return (data as { data: unknown[] }).data.flatMap(item =>
        item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
          ? [(item as { id: string }).id]
          : []);
    },
    async analyzeReviews(request: ReviewAnalysisRequest): Promise<ReviewAnalysisResponse> {
      const response = await openAIRequest('/chat/completions', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: REVIEW_ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(request.reviews) },
          ],
        }),
      }, 90000);
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new AIServiceError('invalid-response');
      const choices = (data as { choices?: unknown }).choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
        throw new AIServiceError('invalid-response');
      }
      const message = (choices[0] as { message?: unknown }).message;
      if (!message || typeof message !== 'object'
        || typeof (message as { content?: unknown }).content !== 'string') {
        throw new AIServiceError('invalid-response');
      }
      return parseReviewAnalysisResponse((message as { content: string }).content, request.reviews);
    },
    async generateGuide(request: GuideGenerationRequest) {
      const response = await openAIRequest('/chat/completions', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: GUIDE_GENERATION_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(request.input) },
          ],
        }),
      }, 90000);
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new AIServiceError('invalid-response');
      const choices = (data as { choices?: unknown }).choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
        throw new AIServiceError('invalid-response');
      }
      const message = (choices[0] as { message?: unknown }).message;
      if (!message || typeof message !== 'object'
        || typeof (message as { content?: unknown }).content !== 'string') {
        throw new AIServiceError('invalid-response');
      }
      return parseGuideGenerationResponse((message as { content: string }).content, request.input);
    },
    async checkReviews(request: ReviewCheckRequest) {
      const response = await openAIRequest('/chat/completions', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: REVIEW_CHECK_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(request.input) },
          ],
        }),
      }, 90000);
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new AIServiceError('invalid-response');
      const choices = (data as { choices?: unknown }).choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
        throw new AIServiceError('invalid-response');
      }
      const message = (choices[0] as { message?: unknown }).message;
      if (!message || typeof message !== 'object'
        || typeof (message as { content?: unknown }).content !== 'string') {
        throw new AIServiceError('invalid-response');
      }
      return parseReviewCheckResponse(
        (message as { content: string }).content,
        request.input,
        'openai',
        model,
        new Date().toISOString(),
      );
    },
  };
}
