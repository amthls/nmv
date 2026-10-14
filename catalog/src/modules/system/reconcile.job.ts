import amqp from 'amqplib';
import { pool } from '../../config/db';
import { RABBITMQ_URL } from '../../config/env';
import { internalAuthHeader } from '../../middlewares/auth.middleware';
import { notifyAdmins } from '../users/identity-sync.job';

/**
 * Reconcile job (worker, every 6 hours): the copies this backend keeps of other services' data must match the
 * source, events must not pile up. Anything off becomes one admin notification per problem per day, with the fix.
 * - identity users vs users (identity_version > 0) and workspace chapters vs ws_chapter_versions: count + sum of versions
 * - outbox of identity/workspace not sent for over 10 minutes
 * - messages parked in a dead-letter queue
 */

const SERVICES = [
  { name: 'identity' as const, url: process.env.IDENTITY_INTERNAL_URL || 'http://identity:8080', what: 'tài khoản',
    copy: `SELECT count(*)::bigint AS n, COALESCE(sum(identity_version), 0)::bigint AS v FROM users WHERE identity_version > 0`,
    count: (s: any) => s.users },
  { name: 'workspace' as const, url: process.env.WORKSPACE_INTERNAL_URL || 'http://workspace:8080', what: 'chương',
    copy: `SELECT count(*)::bigint AS n, COALESCE(sum(version), 0)::bigint AS v FROM ws_chapter_versions`,
    count: (s: any) => s.chapters },
];
const DLQS = ['novel.notifications.dlq', 'backend.identity.dlq', 'backend.workspace.dlq'];
const OUTBOX_MAX_SECONDS = 600;

/** Returns the problems found (also sent to admins). */
export async function reconcile(): Promise<string[]> {
  const problems: [key: string, title: string, message: string][] = [];
  for (const svc of SERVICES) {
    try {
      const res = await fetch(`${svc.url.replace(/\/+$/, '')}/internal/stats`, {
        headers: { 'X-Internal-Auth': internalAuthHeader(svc.name) },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data: stats } = (await res.json()) as { data: any };
      const { rows: [copy] } = await pool.query(svc.copy);
      const [n, v] = [Number(copy.n), Number(copy.v)];
      if (n !== svc.count(stats) || v !== stats.version_sum) {
        problems.push([`${svc.name}-drift`, `Bản sao ${svc.what} lệch với ${svc.name}`,
          `${svc.name}: ${svc.count(stats)} ${svc.what} (tổng version ${stats.version_sum}), bản sao ở backend: ${n} (tổng ${v}). ` +
          `Phát lại để đồng bộ: docker compose run --rm ${svc.name} republish`]);
      }
      if (stats.outbox_oldest_seconds > OUTBOX_MAX_SECONDS) {
        problems.push([`${svc.name}-outbox`, `Sự kiện của ${svc.name} bị dồn`,
          `${stats.outbox_pending} sự kiện chưa gửi, cũ nhất ${Math.round(stats.outbox_oldest_seconds / 60)} phút. Kiểm tra RabbitMQ và log ${svc.name}.`]);
      }
    } catch (err: any) {
      problems.push([`${svc.name}-stats`, `Không đối soát được với ${svc.name}`, `GET /internal/stats lỗi: ${err.message}`]);
    }
  }
  try {
    const conn: any = await amqp.connect(RABBITMQ_URL);
    try {
      for (const q of DLQS) {
        const ch: any = await conn.createChannel(); // checkQueue on a missing queue closes the channel
        try {
          const { messageCount } = await ch.checkQueue(q);
          if (messageCount > 0) {
            problems.push([`dlq-${q}`, `Có ${messageCount} tin trong hàng cách ly ${q}`,
              `Các tin này đã thử lại nhiều lần vẫn lỗi. Xem trong RabbitMQ (trang quản lý, hàng ${q}) và log worker.`]);
          }
          await ch.close();
        } catch { /* queue not created yet: nothing parked */ }
      }
    } finally {
      await conn.close().catch(() => {});
    }
  } catch (err: any) {
    problems.push(['rabbitmq', 'Không kiểm tra được RabbitMQ', err.message]);
  }

  const day = new Date().toISOString().slice(0, 10);
  for (const [key, title, message] of problems) {
    await notifyAdmins(`reconcile:${key}:${day}`, title, message).catch((e) => console.error('[reconcile] notify:', e.message));
  }
  console.log(problems.length ? `[reconcile] ${problems.length} problem(s): ${problems.map((p) => p[0]).join(', ')}` : '[reconcile] all copies in step');
  return problems.map((p) => p[0]);
}

export function scheduleReconcile() {
  const run = () => void reconcile().catch((err) => console.error('[reconcile] failed:', err.message));
  setTimeout(run, 5 * 60_000).unref(); // after start-up settles
  setInterval(run, 6 * 3600_000).unref();
}
