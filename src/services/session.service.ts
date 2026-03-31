import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// Trim history when the accumulated content exceeds this character limit.
// ~4 chars per token × 12 000 chars ≈ 3 000 tokens — well within Gemini's context window
// while still preventing unbounded memory growth on long-lived sessions.
const MAX_HISTORY_CHARS = 12_000;

export class SessionService {
  private readonly sessions = new Map<string, ChatCompletionMessageParam[]>();

  /**
   * Returns the message history array for a session, creating an empty one
   * if the session does not yet exist.
   *
   * The returned array is the *same reference* stored internally, so callers
   * can mutate it directly (e.g. unshift for system message injection).
   */
  getHistory(sessionId: string): ChatCompletionMessageParam[] {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    return this.sessions.get(sessionId)!;
  }

  /** Appends a message to the session history, then trims if necessary. */
  appendMessage(sessionId: string, message: ChatCompletionMessageParam): void {
    const history = this.getHistory(sessionId);
    history.push(message);
    this.trimIfTooLong(sessionId);
  }

  /** Removes all history for the given session. */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * If the total character count of the history exceeds the threshold, removes
   * the oldest non-system messages one-by-one until we're back within limits.
   * The system message (role "system") is always preserved.
   */
  private trimIfTooLong(sessionId: string): void {
    const history = this.getHistory(sessionId);

    const totalChars = (): number =>
      history.reduce((sum, msg) => {
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content ?? '');
        return sum + content.length;
      }, 0);

    // Keep at least system message + one turn (2 messages minimum)
    while (totalChars() > MAX_HISTORY_CHARS && history.length > 2) {
      // Find the first non-system message and remove it
      const idx = history.findIndex((m) => m.role !== 'system');
      if (idx === -1) break;
      history.splice(idx, 1);
    }
  }
}

// Singleton — shared across the entire process lifetime
export const sessionService = new SessionService();
