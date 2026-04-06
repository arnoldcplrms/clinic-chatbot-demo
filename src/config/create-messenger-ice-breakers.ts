/**
 * One-time setup script — registers Ice Breaker conversation starters on the
 * Facebook Messenger Profile API for the connected Page.
 *
 * Ice Breakers appear as quick-tap prompts when a user opens a fresh
 * conversation with your Page for the first time.
 *
 * Run with:
 *   bun run src/config/create-messenger-ice-breakers.ts
 */

import { env } from '@/config/env';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

const ICE_BREAKERS = [
  {
    question: 'I would like to inquire',
    payload: 'INQUIRY',
  },
  {
    question: 'What services do you offer?',
    payload: 'SERVICES',
  },
  {
    question: 'Book a Consultation',
    payload: 'BOOK_CONSULTATION',
  },
  {
    question: 'Book a Follow-Up',
    payload: 'BOOK_FOLLOWUP',
  },
];

async function registerIceBreakers(): Promise<void> {
  console.log('Registering Messenger Ice Breakers...');

  const response = await fetch(`${GRAPH_API_BASE}/me/messenger_profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.FB_PAGE_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ ice_breakers: ICE_BREAKERS }),
  });

  const data = (await response.json()) as {
    result?: string;
    error?: { message: string };
  };

  if (!response.ok || data.error) {
    console.error(
      `Failed to register Ice Breakers (HTTP ${response.status}):`,
      data.error?.message ?? JSON.stringify(data)
    );
    process.exit(1);
  }

  console.log('Ice Breakers registered successfully!');
  console.log('Configured starters:');
  ICE_BREAKERS.forEach((ib, i) => {
    console.log(`  ${i + 1}. "${ib.question}"  →  payload: ${ib.payload}`);
  });
}

/**
 * Subscribes the Page to the required Messenger webhook fields, including
 * `messaging_postbacks` so Ice Breaker taps are forwarded to the webhook.
 */
async function subscribePageWebhookFields(): Promise<void> {
  console.log('\nSubscribing page to webhook fields...');

  const fields = ['messages', 'messaging_postbacks', 'message_reads'].join(',');
  const url = `${GRAPH_API_BASE}/me/subscribed_apps?subscribed_fields=${fields}&access_token=${env.FB_PAGE_ACCESS_TOKEN}`;

  const response = await fetch(url, { method: 'POST' });

  const data = (await response.json()) as {
    success?: boolean;
    error?: { message: string };
  };

  if (!response.ok || data.error) {
    console.error(
      `Failed to subscribe webhook fields (HTTP ${response.status}):`,
      data.error?.message ?? JSON.stringify(data)
    );
    process.exit(1);
  }

  console.log(
    'Webhook fields subscribed: messages, messaging_postbacks, message_reads'
  );
}

(async function (): Promise<void> {
  await registerIceBreakers();
  await subscribePageWebhookFields();
  console.log('\nSetup complete.');
})().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
