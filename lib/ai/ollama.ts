import type {
  AIProvider, AIProviderConfig, GuideGenerationRequest, ReviewAnalysisRequest, ReviewAnalysisResponse,
  ReviewCheckRequest,
} from './types';
import { AIServiceError } from './errors';
import { reviewDraftPrompt, parseReviewDraftResponse, reviewDraftSchema, reviewDraftContext } from './review-draft';
import {
  GUIDE_GENERATION_SYSTEM_PROMPT, parseGeneratedGuideResponse, parseReviewAnalysisResponse,
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
    async draftReview(input) {
      if (!model) throw new AIServiceError('ollama-model-missing', 400);
      if (!(await readModels()).includes(model)) throw new AIServiceError('ollama-model-missing', 404);
      const response = await ollamaRequest('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, format: reviewDraftSchema(input),
          options: { temperature: 0.2 },
          messages: [{ role: 'system', content: reviewDraftPrompt(input) },
            { role: 'user', content: JSON.stringify(reviewDraftContext(input)) }] }),
      });
      const data = await response.json() as { message?: { content?: unknown } };
      if (typeof data?.message?.content !== 'string') throw new AIServiceError('invalid-response');
      return parseReviewDraftResponse(data.message.content, input);
    },
    listModels: readModels,
    async analyzeReviews(request: ReviewAnalysisRequest): Promise<ReviewAnalysisResponse> {
      if (!model) throw new AIServiceError('ollama-model-missing', 400);
      const availableModels = await readModels();
      if (!availableModels.includes(model)) throw new AIServiceError('ollama-model-missing', 404);
      const string = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
      const object = (properties: Record<string, unknown>) => ({
        type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
      });
      const format = object({
        themes: { type: 'array', minItems: 1, maxItems: 100,
          items: object({ name: string(100), description: string(1000) }) },
        results: { type: 'array', minItems: request.reviews.length, maxItems: 2000,
          items: object({
            id: { type: 'integer', enum: request.reviews.map(review => review.id) },
            theme: string(100), subtheme: string(160),
            sentiment: { type: 'string', enum: ['긍정', '부정', '중립', '혼합'] },
            evidence: string(1000),
          }) },
      });
      const response = await ollamaRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format,
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: REVIEW_ANALYSIS_SYSTEM_PROMPT +
              ' Repeat theme names exactly in results. Copy evidence verbatim from the corresponding review, without quotation marks or ellipses.' },
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
      const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
      const list = (maxLength: number, minItems = 1) => ({
        type: 'array', minItems, maxItems: 12, items: text(maxLength),
      });
      const properties = {
        title: text(160), purpose: text(800), recommendedSituation: text(500), method: text(1200),
        observe: list(300), questions: list(300), checklist: list(300),
      };
      const format = {
        type: 'object', additionalProperties: false,
        required: ['title', 'purpose', 'testItems', 'writingGuidance'],
        properties: {
          title: text(160), purpose: text(1200),
          testItems: {
            type: 'array', minItems: request.input.evaluationItems.length, maxItems: 30,
            items: {
              type: 'object', additionalProperties: false, required: Object.keys(properties),
              properties: { ...properties, title: { type: 'string', enum: request.input.evaluationItems } },
            },
          },
          writingGuidance: list(500, 3),
        },
      };
      const response = await ollamaRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format,
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: GUIDE_GENERATION_SYSTEM_PROMPT +
              ' writingGuidance must contain 3 to 12 instructions, including an explicit Korean instruction to disclose 협찬 or 제품 제공. ' +
              'Use each evaluation item verbatim as a test item title, without prefixes or suffixes.' },
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
      return parseGeneratedGuideResponse((message as { content: string }).content, request.input);
    },
    async checkReviews(request: ReviewCheckRequest) {
      if (!model) throw new AIServiceError('ollama-model-missing', 400);
      const availableModels = await readModels();
      if (!availableModels.includes(model)) throw new AIServiceError('ollama-model-missing', 404);
      const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength });
      const object = (properties: Record<string, unknown>) => ({
        type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
      });
      const list = (items: unknown, maxItems = 10) => ({ type: 'array', maxItems, items });
      const quotes = list(object({ claim: text(500, 1), evidence: text(1000) }));
      const guideIds = request.input.guide.testItems!.map(item => item.id);
      const format = object({ reviews: {
        type: 'array', minItems: request.input.reviews.length, maxItems: request.input.reviews.length,
        items: object({
          id: { type: 'string', enum: request.input.reviews.map(review => review.id) },
          summary: text(1200, 1),
          specificity: { type: 'string', enum: ['구체적', '일부 불명확', '구체성 부족', '판단 불가'] },
          items: {
            type: 'array', minItems: guideIds.length, maxItems: guideIds.length,
            items: object({
              guideItemId: { type: 'string', enum: guideIds },
              status: { type: 'string', enum: ['충족', '부분 충족', '미충족', '해당 없음', '판단 불가'] },
              evidence: text(1000), missingInfo: list(text(300)), unclearInfo: list(text(300)),
              feedback: text(800, 1),
            }),
          },
          conflicts: quotes, unsupportedClaims: quotes,
          disclosure: object({
            status: { type: 'string', enum: ['공개 확인', '언급 없음', '판단 불가', '해당 없음'] },
            evidence: text(1000), feedback: text(600, 1),
          }),
        }),
      } });
      const response = await ollamaRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format,
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: REVIEW_CHECK_SYSTEM_PROMPT +
              ' Keep evidence short: copy one exact contiguous sentence from the corresponding review, without quotation marks or ellipses. ' +
              'Never paraphrase evidence. Use an empty string when there is no exact supporting quote.' },
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
