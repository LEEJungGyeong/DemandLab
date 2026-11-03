import { DEFAULT_AI_SETTINGS, type AISettings } from '../ai/types';
import { openDatabase, SETTINGS, requestValue, transactionDone } from './db';

const AI_SETTINGS_KEY = 'aiSettings';

export async function loadAISettings(): Promise<AISettings> {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS, 'readonly');
  const done = transactionDone(tx);
  const stored = await requestValue<unknown>(tx.objectStore(SETTINGS).get(AI_SETTINGS_KEY));
  await done;

  if (!stored || typeof stored !== 'object') return DEFAULT_AI_SETTINGS;
  const value = stored as Partial<AISettings>;
  const provider = value.provider === 'gemini' ? 'gemini' : value.provider === 'ollama' ? 'ollama' : 'openai';
  const models: Partial<AISettings['models']> = value.models && typeof value.models === 'object'
    ? value.models
    : {};
  return {
    provider,
    models: {
      gemini: typeof models.gemini === 'string' && models.gemini.trim() && models.gemini.length <= 200
        ? models.gemini : DEFAULT_AI_SETTINGS.models.gemini,
      openai: typeof models.openai === 'string' && models.openai.length <= 100
        ? models.openai
        : DEFAULT_AI_SETTINGS.models.openai,
      ollama: typeof models.ollama === 'string' && models.ollama.length <= 200
        ? models.ollama
        : DEFAULT_AI_SETTINGS.models.ollama,
    },
  };
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  const safeSettings: AISettings = {
    provider: settings.provider === 'gemini' ? 'gemini' : settings.provider === 'ollama' ? 'ollama' : 'openai',
    models: {
      gemini: settings.models.gemini.slice(0, 200),
      openai: settings.models.openai.slice(0, 100),
      ollama: settings.models.ollama.slice(0, 200),
    },
  };
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(SETTINGS).put(safeSettings, AI_SETTINGS_KEY);
  await done;
}
