import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Single source of truth for all environment variables.
 * Validated at startup — the server will refuse to start if any required
 * variable is missing or fails its schema check.
 */
export const env = createEnv({
  server: {
    // ── Server ──────────────────────────────────────────────────────────────
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    // ── AI provider selection ────────────────────────────────────────────────
    // Active provider (see src/config/ai-providers.config.ts). Switch providers
    // by changing this one value; keys/models are picked up automatically.
    AI_PROVIDER: z.enum(['opencode', 'gemini', 'groq']).default('opencode'),

    // ── Opencode Go (OpenAI-compatible) ──────────────────────────────────────
    OPENCODE_API_KEY: z.string().min(1).optional(),
    OPENCODE_BASE_URL: z.string().url().default('https://opencode.ai/zen/go/v1'),
    OPENCODE_MODEL: z.string().default('mimo-v2.5'),

    // ── AI — Google Gemini via OpenAI-compatible endpoint ────────────────────
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_BASE_URL: z
      .string()
      .url()
      .default('https://generativelanguage.googleapis.com/v1beta/openai/'),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

    // ── AI — Groq via OpenAI-compatible endpoint ─────────────────────────────
    GROQ_API_KEY: z.string().min(1).optional(),
    GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
    GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),

    // ── Google Calendar (service account) ────────────────────────────────────
    GOOGLE_SERVICE_ACCOUNT: z.string().min(1, 'GOOGLE_SERVICE_ACCOUNT is required'),
    GOOGLE_CALENDAR_ID: z.string().default('primary'),

    // ── Facebook Messenger ────────────────────────────────────────────────────
    FB_VERIFY_TOKEN: z.string().min(1, 'FB_VERIFY_TOKEN is required'),
    FB_PAGE_ACCESS_TOKEN: z.string().min(1, 'FB_PAGE_ACCESS_TOKEN is required'),
  },

  runtimeEnv: process.env,

  // Treat empty strings in .env files the same as missing values
  emptyStringAsUndefined: true,
});
