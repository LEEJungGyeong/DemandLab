import type { AIProvider, AIProviderConfig, AIProviderKind } from './types';
import { AIServiceError } from './errors';
import { createOpenAIProvider } from './openai';
import { createOllamaProvider } from './ollama';

export function createAIProvider(
  kind: AIProviderKind,
  config: AIProviderConfig,
): AIProvider {
  if (kind === 'openai') return createOpenAIProvider(config);
  if (kind === 'ollama') return createOllamaProvider(config);
  throw new AIServiceError('invalid-request', 400);
}
