import amqp from 'amqplib';
import { RABBITMQ_URL } from '../../config/env';

/**
 * Consumer side of the novelhub.events exchange (other services' outboxes publish there; schemas in events/).
 * Own durable queue per subscriber, retries 10 s apart through <queue>.retry, then <queue>.dlq after MAX_ATTEMPTS.
 * `handle` must be idempotent (processed_events + version checks) and throw to have the event retried.
 */

const EXCHANGE = 'novelhub.events';
const MAX_ATTEMPTS = 5;

export async function startEventConsumer(opts: {
  queue: string;
  bindings: string[];
  label: string;
  handle: (evt: any) => Promise<string>;
  onClose: () => void;
}): Promise<{ close: () => Promise<void> }> {
  const { queue, label } = opts;
  const retry = `${queue}.retry`;
  const dlq = `${queue}.dlq`;
  const conn: any = await amqp.connect(`${RABBITMQ_URL}${RABBITMQ_URL.includes('?') ? '&' : '?'}heartbeat=30`);
  conn.on('error', (e: Error) => console.error(`[${label}] connection error:`, e.message));
  conn.on('close', opts.onClose);
  const ch: any = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue(dlq, { durable: true });
  await ch.assertQueue(retry, {
    durable: true,
    arguments: { 'x-message-ttl': 10_000, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue },
  });
  await ch.assertQueue(queue, { durable: true, arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': retry } });
  for (const key of opts.bindings) await ch.bindQueue(queue, EXCHANGE, key);
  await ch.prefetch(20);

  const { consumerTag } = await ch.consume(queue, async (msg: any) => {
    if (!msg) return;
    const attempts = ((msg.properties.headers?.['x-death'] || []).find((d: any) => d.queue === queue)?.count || 0) + 1;
    let evt: any = null;
    try {
      evt = JSON.parse(msg.content.toString());
      const outcome = await opts.handle(evt);
      if (outcome !== 'duplicate') console.log(`[${label}] ${evt.type} ${evt.data?.id || evt.data?.chapter_id || ''} v${evt.data?.version ?? '-'}: ${outcome}`);
      ch.ack(msg);
    } catch (err: any) {
      if (attempts >= MAX_ATTEMPTS || !evt) {
        console.error(`[${label}] event ${evt?.event_id || '(unparsable)'} failed ${attempts}x, moved to ${dlq}: ${err.message}`);
        ch.sendToQueue(dlq, msg.content, { persistent: true, headers: { last_error: String(err.message).slice(0, 500) } });
        ch.ack(msg);
      } else {
        console.warn(`[${label}] event ${evt.event_id} failed (attempt ${attempts}/${MAX_ATTEMPTS}), retrying: ${err.message}`);
        ch.nack(msg, false, false); // dead-letters to the retry queue, back here after 10 s
      }
    }
  });
  return {
    close: async () => {
      try { await ch.cancel(consumerTag); } catch {}
      try { await ch.close(); } catch {}
      try { await conn.close(); } catch {}
    },
  };
}
