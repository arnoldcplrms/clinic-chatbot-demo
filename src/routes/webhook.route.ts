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

      // Process each messaging event independently
      for (const entry of body.entry ?? []) {
        for (const event of entry.messaging ?? []) {
          const senderPsid = event.sender?.id;
          const messageText = event.message?.text;

          // Ignore non-text events (attachments, postbacks handled separately)
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
    await messengerService.sendTypingIndicator(senderPsid, true);

    const reply = await aiService.chat(senderPsid, messageText);

    await messengerService.sendTypingIndicator(senderPsid, false);
    await messengerService.sendMessage(senderPsid, reply);
  } catch (err) {
    app.log.error({ err, senderPsid }, 'Error processing Messenger message');

    // Best-effort: attempt to inform the user something went wrong
    try {
      await messengerService.sendTypingIndicator(senderPsid, false);
      await messengerService.sendMessage(
        senderPsid,
        'Sorry, I ran into a problem. Please try again in a moment.'
      );
    } catch {
      // Suppress secondary send failures
    }
  }
}
