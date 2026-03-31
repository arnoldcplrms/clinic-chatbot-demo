// ─── Facebook Messenger Webhook Payload Types ────────────────────────────────

export interface Sender {
  id: string;
}

export interface Recipient {
  id: string;
}

export interface MessageAttachment {
  type: string;
  payload: Record<string, unknown>;
}

export interface Message {
  mid: string;
  text?: string;
  attachments?: MessageAttachment[];
}

export interface Postback {
  title: string;
  payload: string;
  referral?: {
    ref: string;
    source: string;
    type: string;
  };
}

export interface MessagingEvent {
  sender: Sender;
  recipient: Recipient;
  timestamp: number;
  message?: Message;
  postback?: Postback;
}

export interface MessengerEntry {
  id: string;
  time: number;
  messaging: MessagingEvent[];
}

export interface MessengerWebhookPayload {
  object: 'page' | string;
  entry: MessengerEntry[];
}

// ─── Outgoing Send API Payload ────────────────────────────────────────────────

export interface SendMessagePayload {
  recipient: { id: string };
  message?: { text: string };
  sender_action?: 'typing_on' | 'typing_off' | 'mark_seen';
}
