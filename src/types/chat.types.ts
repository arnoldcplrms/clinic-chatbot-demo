// ─── Chat API Request / Response ─────────────────────────────────────────────

export interface ChatRequest {
  sessionId: string;
  message: string;
}

export interface ChatResponse {
  reply: string;
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

// Convenience re-export so other modules can import message types from one place
export type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
