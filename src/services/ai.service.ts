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

// Safety cap: prevents infinite tool-call loops if the model misbehaves
const MAX_TOOL_ITERATIONS = 10;

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

    return this.runAgentLoop(sessionId);
  }

  /**
   * The core agentic loop. Calls the AI, handles tool calls, and repeats until
   * the model produces a final text response or the iteration limit is hit.
   */
  private async runAgentLoop(sessionId: string): Promise<string> {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const messages = sessionService.getHistory(sessionId);

      const response = await this.openai.chat.completions.create({
        model: env.GEMINI_MODEL,
        messages,
        tools: calendarToolDefinitions,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      if (!choice) throw new Error('AI returned an empty choices array');

      const { message, finish_reason } = choice;

      // Persist the assistant's turn (may contain tool_calls or final content)
      sessionService.appendMessage(
        sessionId,
        message as ChatCompletionMessageParam
      );

      if (finish_reason === 'stop') {
        // Model is satisfied — return the final text response
        return (message as ChatCompletionMessage).content ?? '';
      }

      if (
        finish_reason === 'tool_calls' &&
        (message as ChatCompletionMessage).tool_calls?.length
      ) {
        // Execute all requested tool calls in parallel
        const toolResults = await Promise.all(
          ((message as ChatCompletionMessage).tool_calls ?? []).map(
            async (tc) => {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(tc.function.arguments) as Record<
                  string,
                  unknown
                >;
              } catch {
                // Malformed JSON arguments — pass an empty object so the dispatcher
                // can return a meaningful error rather than crashing
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
            }
          )
        );

        // Append each tool result so the model can process them
        for (const result of toolResults) {
          sessionService.appendMessage(sessionId, result);
        }

        // Continue the loop — the AI will now read the tool results and reply
        continue;
      }

      // Unexpected finish reason — return whatever content we have
      return (message as ChatCompletionMessage).content ?? '';
    }

    // If we exhausted iterations, return a graceful failure message
    return "I'm sorry, I was unable to complete your request after multiple attempts. Please try again.";
  }
}

// Singleton instance used across the application
export const aiService = new AIService();
