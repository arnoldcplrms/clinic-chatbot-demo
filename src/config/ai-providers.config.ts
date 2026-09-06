import { env } from '@/config/env';

export type AIProviderId = 'opencode' | 'gemini' | 'groq';

export interface AIProviderConfig {
  apiKey?: string;
  baseURL: string;
  model: string;
}

/**
 * Provider registry. Every entry is an OpenAI-compatible endpoint, so the AI
 * service stays provider-agnostic — it just reads the active entry.
 *
 * To add a provider:
 *   1. add `XXX_API_KEY` / `XXX_BASE_URL` / `XXX_MODEL` to src/config/env.ts
 *   2. add one entry here
 *   3. set AI_PROVIDER=xxx in .env
 */
export const AI_PROVIDERS: Record<AIProviderId, AIProviderConfig> = {
  opencode: {
    apiKey: env.OPENCODE_API_KEY,
    baseURL: env.OPENCODE_BASE_URL,
    model: env.OPENCODE_MODEL,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    baseURL: env.GEMINI_BASE_URL,
    model: env.GEMINI_MODEL,
  },
  groq: {
    apiKey: env.GROQ_API_KEY,
    baseURL: env.GROQ_BASE_URL,
    model: env.GROQ_MODEL,
  },
};

export function getActiveProvider(): AIProviderConfig {
  const provider = AI_PROVIDERS[env.AI_PROVIDER];
  if (!provider.apiKey) {
    throw new Error(
      `AI provider "${env.AI_PROVIDER}" is selected but has no API key. ` +
        `Set ${env.AI_PROVIDER.toUpperCase()}_API_KEY in .env.`
    );
  }
  return provider;
}
