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
      apiKey: env.GROQ_API_KEY ?? env.GEMINI_API_KEY,
      baseURL: env.GROQ_API_KEY ? env.GROQ_BASE_URL : env.GEMINI_BASE_URL,
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

      console.error('[AIService.chat] runAgentLoop threw:', {
        status,
        message: error instanceof Error ? error.message : String(error),
        body: (error as Record<string, unknown>)?.['error'],
      });

      if (status === 429) {
        return 'I am currently experiencing high traffic from the chat provider. Please wait a moment and try again.';
      }

      if (status !== undefined && status >= 500) {
        return 'The AI service is temporarily unavailable. Please try again in a moment.';
      }

      // Groq returns 400 with "failed_generation" when the model produces a
      // malformed tool call. Return a safe fallback message.
      if (status === 400) {
        return "Oops! I wasn't able to process that. Could you try again or rephrase your message?";
      }

      // Surface the actual message so the caller (and the user) can see what went wrong
      const message =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred.';
      throw new Error(message);
    }
  }

  /**
   * The core agentic loop. Repeatedly calls the AI and executes tool calls
   * until the model reaches finish_reason "stop" or the iteration cap is hit.
   * Each iteration handles exactly one round of tool calls, keeping each
   * generation simple and preventing malformed tool-call arguments.
   */
  private async runAgentLoop(sessionId: string): Promise<string> {
    const MAX_ITERATIONS = 8;
    let toolCallsExecuted = false;
    // Track whether list_events returned results suggesting a conflict
    let listEventsFoundConflict = false;
    let listEventsConflictDetails = '';

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const messages = sessionService.getHistory(sessionId);
      console.log(
        `[runAgentLoop] iteration=${iteration} history_len=${messages.length} toolCallsExecuted=${toolCallsExecuted}`
      );

      let response;
      try {
        response = await this.createChatCompletionWithRetry(messages, true);
      } catch (error) {
        console.error(
          `[runAgentLoop] createChatCompletionWithRetry threw at iteration=${iteration}:`,
          {
            status: getErrorStatusCode(error),
            message: error instanceof Error ? error.message : String(error),
            toolCallsExecuted,
          }
        );
        // After at least one tool round, a 400 (failed_generation) usually
        // means the model struggled to format a follow-up tool call from the
        // tool results (e.g. a schedule conflict response). Break out and let
        // the plain-text fallback below produce a proper reply for the user.
        if (toolCallsExecuted && getErrorStatusCode(error) === 400) {
          break;
        }
        throw error;
      }

      const choice = response.choices[0];
      if (!choice) throw new Error('AI returned an empty choices array');

      const message = choice.message as ChatCompletionMessage;
      console.log(
        `[runAgentLoop] finish_reason=${choice.finish_reason} tool_calls=${
          message.tool_calls?.length ?? 0
        }`
      );
      sessionService.appendMessage(
        sessionId,
        message as ChatCompletionMessageParam
      );

      // Model is done — return the text response
      if (choice.finish_reason === 'stop' || !message.tool_calls?.length) {
        return normalizeAssistantContent(message.content);
      }

      // Execute all tool calls in this round sequentially
      for (const tc of message.tool_calls) {
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

        console.log(`[runAgentLoop] tool=${tc.function.name} result=${result}`);

        // If list_events returned events for a narrow time window, flag it as a
        // potential conflict so we can use it in the fallback path if Groq later
        // fails to generate a response.
        if (tc.function.name === 'list_events') {
          const parsed = tryParseJson(result);
          if (
            parsed?.success === true &&
            Array.isArray(parsed.events) &&
            (parsed.events as unknown[]).length > 0
          ) {
            const requestedMin = args['timeMin'] as string | undefined;
            const requestedMax = args['timeMax'] as string | undefined;
            // Treat as a conflict check if the window is ≤ 4 hours
            if (requestedMin && requestedMax) {
              const windowMs =
                new Date(requestedMax).getTime() -
                new Date(requestedMin).getTime();
              if (windowMs <= 4 * 60 * 60 * 1000) {
                listEventsFoundConflict = true;
                const events = parsed.events as Array<{
                  summary?: string;
                  start?: { dateTime?: string };
                  end?: { dateTime?: string };
                }>;
                listEventsConflictDetails = events
                  .map(
                    (e) =>
                      `"${e.summary ?? 'Appointment'}" (${
                        e.start?.dateTime ?? ''
                      } – ${e.end?.dateTime ?? ''})`
                  )
                  .join(', ');
              }
            }
          }
        }

        // Detect a schedule conflict and respond directly — avoids a follow-up
        // AI call that Groq often rejects with 400 (failed_generation) when the
        // tool result contains conflict data.
        const conflictReplyEarly = extractScheduleConflictReply([
          { role: 'tool', tool_call_id: tc.id, content: result },
        ]);
        if (conflictReplyEarly) return conflictReplyEarly;

        sessionService.appendMessage(sessionId, {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: result,
        });

        await sleep(1500);
      }

      toolCallsExecuted = true;
    }

    // Before falling back to a plain-text call, check if a schedule conflict
    // was already recorded in the tool results — if so, respond directly.
    const conflictReply = extractScheduleConflictReply(
      sessionService.getHistory(sessionId)
    );
    if (conflictReply) return conflictReply;

    // Also handle the case where list_events found overlapping events but
    // create_event was never reached (model tried to respond in text and failed).
    if (listEventsFoundConflict) {
      return (
        `I'm sorry, that time slot is not available — ${
          listEventsConflictDetails || 'another appointment'
        } is already booked. ` +
        `Please choose a different time, and I'll be happy to schedule your appointment.`
      );
    }

    // Iteration cap reached (or 400 after tool execution) — force a plain text response
    try {
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
    } catch (error) {
      // Plain-text fallback also failed (often 400 from Groq on large histories).
      // Do one final history scan before giving up.
      const lateConflictReply = extractScheduleConflictReply(
        sessionService.getHistory(sessionId)
      );
      if (lateConflictReply) return lateConflictReply;
      if (listEventsFoundConflict) {
        return (
          `I'm sorry, that time slot is not available — ${
            listEventsConflictDetails || 'another appointment'
          } is already booked. ` +
          `Please choose a different time, and I'll be happy to schedule your appointment.`
        );
      }
      throw error;
    }
  }

  private async createChatCompletionWithRetry(
    messages: ChatCompletionMessageParam[],
    allowTools: boolean
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt++) {
      try {
        return await this.openai.chat.completions.create({
          model: env.GROQ_API_KEY ? env.GROQ_MODEL : env.GEMINI_MODEL,
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

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON
  }
  return null;
}

/**
 * Scans session history for a SCHEDULE_CONFLICT tool result and returns a
 * ready-to-send user-facing message, or null if none is found.
 */
function extractScheduleConflictReply(
  history: ChatCompletionMessageParam[]
): string | null {
  for (const msg of history) {
    if (msg.role !== 'tool') continue;
    const content = typeof msg.content === 'string' ? msg.content : null;
    if (!content) continue;
    const parsed = tryParseJson(content);
    if (parsed?.error !== 'SCHEDULE_CONFLICT') continue;

    const conflictMsg =
      typeof parsed.message === 'string' ? parsed.message : '';
    const bookedMatch = conflictMsg.match(
      /The requested time slot is already booked: (.+?)\./
    );
    const booked = bookedMatch?.[1] ?? 'another appointment';
    return (
      `I'm sorry, that time slot is not available — ${booked} is already booked. ` +
      `Please choose a different time, and I'll be happy to schedule your appointment.`
    );
  }
  return null;
}

// Singleton instance used across the application
export const aiService = new AIService();
