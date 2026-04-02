import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessage,
} from 'openai/resources/chat/completions';
import { env } from '@/config/env';
import { businessRules } from '@/config/business-rules.config';
import { buildSystemPrompt } from '@/utils/prompt-builder';
import {
  calendarToolDefinitions,
  executeToolCall,
} from '@/tools/calendar.tools';
import { sessionService } from '@/services/session.service';
import { CalendarService } from '@/services/calendar.service';

const MAX_PROVIDER_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

export class AIService {
  private readonly openai: OpenAI;
  private readonly calendarService: CalendarService;

  constructor() {
    this.openai = new OpenAI({
      apiKey: env.GEMINI_API_KEY,
      baseURL: env.GEMINI_BASE_URL,
    });
    this.calendarService = new CalendarService();
  }

  /**
   * Initialises a session and returns the assistant's opening message.
   * Injects a hidden trigger so the model produces the intro greeting
   * (services + business hours) before any real user turn.
   */
  async initSession(sessionId: string): Promise<string> {
    const systemPrompt = buildSystemPrompt(businessRules);

    const history = sessionService.getHistory(sessionId);

    // Only run init once per session
    if (history.length > 0) {
      const firstAssistant = history.find((m) => m.role === 'assistant');
      if (firstAssistant) {
        return typeof firstAssistant.content === 'string'
          ? firstAssistant.content
          : '';
      }
    }

    history.unshift({ role: 'system', content: systemPrompt });

    // Hidden trigger - never shown to the user, prompts the intro greeting
    sessionService.appendMessage(sessionId, {
      role: 'user',
      content: '[session_start]',
    });

    return await this.runAgentLoop(sessionId);
  }

  /**
   * Processes a user message for the given session and returns the AI's
   * final text reply. Runs the full agentic loop internally:
   * call API → execute tool calls (if any) → call API again → repeat until
   * the model signals it is done (finish_reason "stop").
   */
  async chat(sessionId: string, userMessage: string): Promise<string> {
    // Rebuild the system prompt on every call so runtime rule changes are reflected
    const systemPrompt = buildSystemPrompt(businessRules);

    const history = sessionService.getHistory(sessionId);

    // Inject or refresh the system message at position 0
    if (history.length === 0 || history[0]?.role !== 'system') {
      history.unshift({ role: 'system', content: systemPrompt });
    } else {
      history[0] = { role: 'system', content: systemPrompt };
    }

    // Append the incoming user turn
    sessionService.appendMessage(sessionId, {
      role: 'user',
      content: userMessage,
    });

    try {
      return await this.runAgentLoop(sessionId);
    } catch (error) {
      const status = getErrorStatusCode(error);

      if (status === 429) {
        return 'I am currently experiencing high traffic from the chat provider. Please wait a moment and try again.';
      }

      throw error;
    }
  }

  /**
   * The core agentic loop. Calls the AI, handles tool calls, and repeats until
   * the model produces a final text response or the iteration limit is hit.
   */
  private async runAgentLoop(sessionId: string): Promise<string> {
    const messages = sessionService.getHistory(sessionId);

    // First completion: tools enabled so booking flows can invoke calendar ops.
    const firstResponse = await this.createChatCompletionWithRetry(
      messages,
      true
    );

    const firstChoice = firstResponse.choices[0];
    if (!firstChoice) throw new Error('AI returned an empty choices array');

    const firstMessage = firstChoice.message as ChatCompletionMessage;
    sessionService.appendMessage(
      sessionId,
      firstMessage as ChatCompletionMessageParam
    );

    if (firstChoice.finish_reason === 'stop') {
      return normalizeAssistantContent(firstMessage.content);
    }

    if (
      firstChoice.finish_reason !== 'tool_calls' ||
      !firstMessage.tool_calls?.length
    ) {
      return normalizeAssistantContent(firstMessage.content);
    }

    // Execute one tool round only to avoid long model/tool chains per turn.
    const toolResults = await Promise.all(
      (firstMessage.tool_calls ?? []).map(async (tc) => {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        const result = await executeToolCall(
          tc.function.name,
          args,
          this.calendarService
        );

        return {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: result,
        };
      })
    );

    for (const result of toolResults) {
      sessionService.appendMessage(sessionId, result);
    }

    // Final completion: tools disabled to prevent additional tool rounds.
    const finalResponse = await this.createChatCompletionWithRetry(
      sessionService.getHistory(sessionId),
      false
    );

    const finalChoice = finalResponse.choices[0];
    if (!finalChoice) throw new Error('AI returned an empty choices array');

    const finalMessage = finalChoice.message as ChatCompletionMessage;
    sessionService.appendMessage(
      sessionId,
      finalMessage as ChatCompletionMessageParam
    );

    return normalizeAssistantContent(finalMessage.content);
  }

  private async createChatCompletionWithRetry(
    messages: ChatCompletionMessageParam[],
    allowTools: boolean
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt++) {
      try {
        return await this.openai.chat.completions.create({
          model: env.GEMINI_MODEL,
          messages,
          ...(allowTools
            ? {
                tools: calendarToolDefinitions,
                tool_choice: 'auto' as const,
              }
            : { tool_choice: 'none' as const }),
        });
      } catch (error) {
        lastError = error;

        const status = getErrorStatusCode(error);
        const shouldRetry =
          // Avoid retry storms on rate-limit responses.
          status !== 429 &&
          ((status !== undefined && status >= 500) || status === 408) &&
          attempt < MAX_PROVIDER_RETRIES;

        if (!shouldRetry) {
          throw error;
        }

        const retryAfterMs = getRetryAfterDelayMs(error);
        const backoffMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
        await sleep(retryAfterMs ?? backoffMs);
      }
    }

    throw lastError;
  }
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = (error as { status?: unknown }).status;
  return typeof candidate === 'number' ? candidate : undefined;
}

function getRetryAfterDelayMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const headers = (error as { headers?: unknown }).headers;
  if (!headers || typeof headers !== 'object') return undefined;

  const retryAfter = (headers as Record<string, unknown>)['retry-after'];
  if (typeof retryAfter !== 'string') return undefined;

  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;

  return Math.floor(seconds * 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAssistantContent(content: string | null): string {
  const text = content?.trim();
  if (text) return text;

  return 'I completed your request, but could not format a full response. Please ask me to summarize and I will provide the details.';
}

// Singleton instance used across the application
export const aiService = new AIService();
