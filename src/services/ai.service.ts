import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessage,
} from 'openai/resources/chat/completions';
import { businessRules } from '@/config/business-rules.config';
import { getActiveProvider } from '@/config/ai-providers.config';
import { buildSystemPrompt } from '@/utils/prompt-builder';
import {
  calendarToolDefinitions,
  executeToolCall,
} from '@/tools/calendar.tools';
import { sessionService } from '@/services/session.service';
import { CalendarService } from '@/services/calendar.service';
import { logger } from '@/utils/logger';

const log = logger.child({ service: 'AIService' });

const MAX_PROVIDER_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

export class AIService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly calendarService: CalendarService;

  constructor() {
    const provider = getActiveProvider();
    this.openai = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
    });
    this.model = provider.model;
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

      log.error(
        {
          status,
          err: error instanceof Error ? error : new Error(String(error)),
          body: (error as Record<string, unknown>)?.['error'],
        },
        'runAgentLoop threw'
      );

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
   */
  private async runAgentLoop(sessionId: string): Promise<string> {
    const MAX_ITERATIONS = 8;
    let toolCallsExecuted = false;
    const listConflict = { found: false, details: '' };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const messages = sessionService.getHistory(sessionId);
      log.debug(
        { iteration, historyLen: messages.length },
        'agent loop iteration'
      );

      // ── 1. Call the model ────────────────────────────────────────────────
      let response;
      try {
        response = await this.createChatCompletionWithRetry(messages, true);
      } catch (error) {
        // After at least one tool round, a 400 (failed_generation) means the
        // model struggled to format a follow-up tool call. Break out and let
        // the plain-text fallback produce a proper reply.
        if (toolCallsExecuted && getErrorStatusCode(error) === 400) break;
        throw error;
      }

      const choice = response.choices[0];
      if (!choice) throw new Error('AI returned an empty choices array');

      const message = choice.message as ChatCompletionMessage;
      log.debug(
        {
          finishReason: choice.finish_reason,
          toolCalls: message.tool_calls?.length ?? 0,
        },
        'model response'
      );
      sessionService.appendMessage(
        sessionId,
        message as ChatCompletionMessageParam
      );

      // ── 2. No tool calls → model is done ────────────────────────────────
      if (choice.finish_reason === 'stop' || !message.tool_calls?.length) {
        return normalizeAssistantContent(message.content);
      }

      // ── 3. Execute tool round ────────────────────────────────────────────
      const earlyReply = await this.executeToolRound(
        sessionId,
        message.tool_calls,
        listConflict
      );
      if (earlyReply) return earlyReply;

      toolCallsExecuted = true;
    }

    // ── 4. Fallback: conflict check or force plain-text ──────────────────
    return this.resolveFallback(sessionId, listConflict);
  }

  /**
   * Executes all tool calls for a single model round sequentially.
   * Returns a ready-to-send conflict reply string if a conflict is detected
   * early, or null to continue the loop.
   */
  private async executeToolRound(
    sessionId: string,
    toolCalls: NonNullable<ChatCompletionMessage['tool_calls']>,
    listConflict: { found: boolean; details: string }
  ): Promise<string | null> {
    for (const tc of toolCalls) {
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

      const parsedResult = tryParseJson(result);
      if (
        parsedResult &&
        parsedResult['success'] === false &&
        parsedResult['error'] !== 'SCHEDULE_CONFLICT'
      ) {
        log.error(
          { tool: tc.function.name, result: parsedResult },
          'tool call returned failure'
        );
      } else {
        log.debug(
          { tool: tc.function.name, result: parsedResult ?? result },
          'tool call succeeded'
        );
      }

      this.updateListEventsConflict(
        tc.function.name,
        args,
        result,
        listConflict
      );

      // Always append the tool result first so history stays valid even if we
      // return early. An orphaned assistant tool_calls message (with no matching
      // tool result) corrupts the session and makes every subsequent API call fail.
      sessionService.appendMessage(sessionId, {
        role: 'tool' as const,
        tool_call_id: tc.id,
        content: result,
      });

      // Detect a conflict early — avoids a follow-up AI call that Groq often
      // rejects with 400 (failed_generation) when tool results contain conflict data.
      const conflictReply = extractScheduleConflictReply([
        { role: 'tool', tool_call_id: tc.id, content: result },
      ]);
      if (conflictReply) return conflictReply;
    }
    return null;
  }

  /**
   * Updates the listConflict tracker when list_events returns events in a
   * narrow time window (≤ 4 hours), indicating a likely scheduling conflict.
   */
  private updateListEventsConflict(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
    conflict: { found: boolean; details: string }
  ): void {
    if (toolName !== 'list_events') return;

    const parsed = tryParseJson(result);
    if (
      !parsed?.success ||
      !Array.isArray(parsed.events) ||
      !parsed.events.length
    )
      return;

    const timeMin = args['timeMin'] as string | undefined;
    const timeMax = args['timeMax'] as string | undefined;
    if (!timeMin || !timeMax) return;

    const windowMs = new Date(timeMax).getTime() - new Date(timeMin).getTime();
    if (windowMs > 4 * 60 * 60 * 1000) return;

    conflict.found = true;
    conflict.details = (
      parsed.events as Array<{
        summary?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
      }>
    )
      .map(
        (e) =>
          `"${e.summary ?? 'Appointment'}" (${e.start?.dateTime ?? ''} – ${
            e.end?.dateTime ?? ''
          })`
      )
      .join(', ');
  }

  /**
   * Called after the iteration cap is reached (or after a 400 mid-loop).
   * Checks for a captured conflict first, then forces a final plain-text call.
   */
  private async resolveFallback(
    sessionId: string,
    listConflict: { found: boolean; details: string }
  ): Promise<string> {
    const conflictMessage = buildConflictMessage(listConflict.details);

    const historyConflict = extractScheduleConflictReply(
      sessionService.getHistory(sessionId)
    );
    if (historyConflict) return historyConflict;
    if (listConflict.found) return conflictMessage;

    // Iteration cap reached — force a plain-text response without tools
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
      // Plain-text fallback also failed — do one last conflict scan before giving up.
      const lateConflict = extractScheduleConflictReply(
        sessionService.getHistory(sessionId)
      );
      if (lateConflict) return lateConflict;
      if (listConflict.found) return conflictMessage;
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
          model: this.model,
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
        const delayMs = retryAfterMs ?? backoffMs;
        log.warn(
          {
            attempt,
            status,
            delayMs,
            err: error instanceof Error ? error : new Error(String(error)),
          },
          'AI provider request failed, retrying'
        );
        await sleep(delayMs);
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

function buildConflictMessage(details: string): string {
  return (
    `I'm sorry, that time slot is not available — ${
      details || 'another appointment'
    } is already booked. ` +
    `Please choose a different time, and I'll be happy to schedule your appointment.`
  );
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
