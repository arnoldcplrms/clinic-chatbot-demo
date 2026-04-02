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

    // ── AI — Google Gemini via OpenAI-compatible endpoint ────────────────────
    GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
    GEMINI_BASE_URL: z
      .string()
      .url()
      .default('https://generativelanguage.googleapis.com/v1beta/openai/'),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

    // ── Google Calendar OAuth2 ────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
    GOOGLE_REDIRECT_URI: z
      .string()
      .url('GOOGLE_REDIRECT_URI must be a valid URL'),
    GOOGLE_REFRESH_TOKEN: z.string().min(1).optional(),
    GOOGLE_CALENDAR_ID: z.string().default('primary'),

    // ── Facebook Messenger ────────────────────────────────────────────────────
    FB_VERIFY_TOKEN: z.string().min(1, 'FB_VERIFY_TOKEN is required'),
    FB_PAGE_ACCESS_TOKEN: z.string().min(1, 'FB_PAGE_ACCESS_TOKEN is required'),
  },

  runtimeEnv: process.env,

  // Treat empty strings in .env files the same as missing values
  emptyStringAsUndefined: true,
});
