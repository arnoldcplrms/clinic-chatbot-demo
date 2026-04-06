import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@/config/env';
import { aiService } from '@/services/ai.service';
import { messengerService } from '@/services/messenger.service';
import type { MessengerWebhookPayload } from '@/types/messenger.types';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /webhook
   *
   * Facebook sends a one-time GET request when you save the webhook URL in the
   * Developer Console. We must echo back hub.challenge if hub.verify_token
   * matches our secret — otherwise Facebook will reject the webhook.
   */
  app.get(
    '/webhook',
    async (
      request: FastifyRequest<{
        Querystring: {
          'hub.mode'?: string;
          'hub.verify_token'?: string;
          'hub.challenge'?: string;
        };
      }>,
      reply: FastifyReply
    ): Promise<void> => {
      const mode = request.query['hub.mode'];
      const token = request.query['hub.verify_token'];
      const challenge = request.query['hub.challenge'];

      if (mode === 'subscribe' && token === env.FB_VERIFY_TOKEN) {
        app.log.info('Facebook webhook verified successfully');
        reply.status(200).send(challenge);
      } else {
        app.log.warn(
          { mode, token },
          'Webhook verification failed — token mismatch'
        );
        reply.status(403).send({ error: 'Webhook verification failed' });
      }
    }
  );

  /**
   * POST /webhook
   *
   * Facebook posts all incoming Messenger events here. We MUST respond with
   * HTTP 200 within 5 seconds, so we reply immediately and process each
   * message asynchronously (fire-and-forget).
   */
  app.post(
    '/webhook',
    async (
      request: FastifyRequest<{ Body: MessengerWebhookPayload }>,
      reply: FastifyReply
    ): Promise<void> => {
      const body = request.body;

      if (body?.object !== 'page') {
        reply.status(404).send({ error: 'Not a page webhook event' });
        return;
      }

      // Acknowledge receipt immediately — Facebook requires 200 within 5 s
      reply.status(200).send('EVENT_RECEIVED');

      // Log full raw payload in development for easier debugging
      app.log.debug({ body }, 'Messenger webhook event received');

      // Process each messaging event independently
      for (const entry of body.entry ?? []) {
        for (const event of entry.messaging ?? []) {
          app.log.info(
            {
              senderPsid: event.sender?.id,
              hasMessage: !!event.message,
              hasPostback: !!event.postback,
            },
            'Processing messaging event'
          );
          const senderPsid = event.sender?.id;

          // Accept plain text messages OR Ice Breaker / postback taps
          const messageText =
            event.message?.text ?? resolvePostbackText(event.postback?.payload);

          if (!senderPsid || !messageText) continue;

          // Fire-and-forget — errors are caught inside handleMessengerMessage
          handleMessengerMessage(app, senderPsid, messageText).catch(
            (err: unknown) => {
              app.log.error(
                { err, senderPsid },
                'Unhandled error in handleMessengerMessage'
              );
            }
          );
        }
      }
    }
  );
}

/**
 * Maps Ice Breaker payload constants to natural-language phrases so the AI
 * receives a meaningful prompt instead of an ALL_CAPS constant.
 */
const POSTBACK_LABELS: Record<string, string> = {
  INQUIRY: 'I would like to inquire about your clinic.',
  SERVICES: 'What services do you offer?',
  BOOK_CONSULTATION: 'I would like to book a consultation.',
  BOOK_FOLLOWUP: 'I would like to book a follow-up appointment.',
};

function resolvePostbackText(payload?: string): string | undefined {
  if (!payload) return undefined;
  return POSTBACK_LABELS[payload] ?? payload;
}

/**
 * Orchestrates the full flow for a single Messenger message:
 * show typing → call AI → hide typing → send reply.
 * Errors are caught so that individual message failures don't crash the loop.
 */
async function handleMessengerMessage(
  app: FastifyInstance,
  senderPsid: string,
  messageText: string
): Promise<void> {
  try {
    await messengerService
      .sendTypingIndicator(senderPsid, true)
      .catch(() => {});

    const reply = await aiService.chat(senderPsid, messageText);

    await messengerService
      .sendTypingIndicator(senderPsid, false)
      .catch(() => {});
    await messengerService.sendMessage(senderPsid, reply);
  } catch (err) {
    app.log.error({ err, senderPsid }, 'Error processing Messenger message');

    const userFacingMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Sorry, I ran into a problem. Please try again in a moment.';

    // Best-effort: attempt to inform the user something went wrong
    try {
      await messengerService.sendTypingIndicator(senderPsid, false);
      await messengerService.sendMessage(senderPsid, userFacingMessage);
    } catch {
      // Suppress secondary send failures
    }
  }
}
