import { env } from '@/config/env';
import type { SendMessagePayload } from '@/types/messenger.types';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export class MessengerService {
  /**
   * Sends a plain-text message to a Messenger user via the Facebook Send API.
   */
  async sendMessage(recipientPsid: string, text: string): Promise<void> {
    const payload: SendMessagePayload = {
      recipient: { id: recipientPsid },
      message: { text },
    };
    await this.callSendApi(payload);
  }

  /**
   * Sends a typing indicator to a Messenger user.
   * @param on — true to show the typing bubble, false to hide it.
   */
  async sendTypingIndicator(recipientPsid: string, on: boolean): Promise<void> {
    const payload: SendMessagePayload = {
      recipient: { id: recipientPsid },
      sender_action: on ? 'typing_on' : 'typing_off',
    };
    await this.callSendApi(payload);
  }

  /** POSTs a payload to the Facebook Send API using Bearer token auth. */
  private async callSendApi(payload: SendMessagePayload): Promise<void> {
    const url = `${GRAPH_API_BASE}/me/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Authorization header keeps the token out of server logs / URL history
        Authorization: `Bearer ${env.FB_PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Facebook Send API error (HTTP ${response.status}): ${body}`
      );
    }
  }
}

// Singleton instance
export const messengerService = new MessengerService();
