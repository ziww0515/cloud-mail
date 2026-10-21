import orm from '../entity/orm';
import email from '../entity/email';
import user from '../entity/user';
import account from '../entity/account';
import { emailConst, isDel, userConst } from '../const/entity-const';
import { and, eq } from 'drizzle-orm';

const PATH = '/internal/portal-otp-log';
const SENDER = 'service@ziww.cc.cd';
const SUBJECT = 'Ziww 登录验证码';
const REDACTED_CONTENT = '已隐藏安全验证码';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024;
const MIN_SECRET_LENGTH = 32;

function hexToBytes(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function validatePortalOtpLogPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const baseKeys = ['challenge', 'providerId', 'sentAt', 'status'];
  const contentKeys = ['loginIp', 'subject', 'targetHost', 'text'];
  const keys = Object.keys(payload).sort();
  const allowed = [...baseKeys, ...contentKeys].sort();
  if (!keys.every(key => allowed.includes(key))) return null;
  if (!baseKeys.every(key => keys.includes(key))) return null;
  if (!(payload.providerId === null || (typeof payload.providerId === 'string' && payload.providerId.length <= 200))) return null;
  if (typeof payload.challenge !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.challenge)) return null;
  if (payload.status !== 'accepted' && payload.status !== 'failed') return null;
  if (typeof payload.sentAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.sentAt) || !Number.isFinite(Date.parse(payload.sentAt))) return null;
  // The portal sends message contents only for a successful delivery. Keep the
  // legacy status-only contract for failures and never persist an OTP in logs.
  const hasContent = contentKeys.every(key => typeof payload[key] === 'string' && payload[key].length > 0);
  if (keys.some(key => contentKeys.includes(key)) && (payload.status !== 'accepted' || !hasContent)) return null;
  if (hasContent && (payload.subject.length > 500 || payload.text.length > 10000 || payload.loginIp.length > 100 || payload.targetHost.length > 253)) return null;
  return {
    providerId: payload.providerId,
    challenge: payload.challenge.toLowerCase(),
    status: payload.status,
    sentAt: payload.sentAt,
    ...(hasContent ? { subject: payload.subject, text: payload.text, loginIp: payload.loginIp, targetHost: payload.targetHost } : {})
  };
}

async function readBodyUnderLimit(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* best effort */ }
      return null;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

export async function verifyPortalOtpLogRequest(request, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return null;
  if (request.method !== 'POST') return null;
  const timestamp = request.headers.get('x-portal-log-timestamp');
  const signature = request.headers.get('x-portal-log-signature');
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return null;
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > MAX_CLOCK_SKEW_MS) return null;
  const rawBody = await readBodyUnderLimit(request);
  if (rawBody === null) return null;
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return null; }
  const normalized = validatePortalOtpLogPayload(payload);
  if (!normalized) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, hexToBytes(signature), new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return valid ? normalized : null;
}

const INSERT_IF_ABSENT = `INSERT INTO email
(send_email, name, account_id, user_id, subject, text, content, recipient, to_email, message_id, type, status, resend_email_id, create_time)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM email WHERE user_id = ? AND message_id = ? AND type = ?)`;

export async function persistPortalOtpLog(c, payload, database = orm(c)) {
  const adminEmail = typeof c.env.admin === 'string' ? c.env.admin : '';
  if (!adminEmail) throw new Error('admin account is not configured');
  const recipient = c.env.PORTAL_MAIL_RECIPIENT || adminEmail;
  if (typeof recipient !== 'string' || !/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(recipient)) throw new Error('owner recipient is not configured');
  const adminUser = await database.select({ userId: user.userId }).from(user).where(and(eq(user.email, adminEmail), eq(user.isDel, isDel.NORMAL), eq(user.status, userConst.status.NORMAL))).get();
  if (!adminUser) throw new Error('admin user does not exist');
  const serviceAccount = await database.select({ accountId: account.accountId }).from(account).where(and(eq(account.userId, adminUser.userId), eq(account.email, SENDER), eq(account.isDel, isDel.NORMAL))).get();
  const adminAccount = serviceAccount || await database.select({ accountId: account.accountId }).from(account).where(and(eq(account.userId, adminUser.userId), eq(account.isDel, isDel.NORMAL))).get();
  if (!adminAccount) throw new Error('admin email account does not exist');

  const status = payload.status === 'accepted' ? emailConst.status.SENT : emailConst.status.FAILED;
  const db = c.env.db;
  if (!db?.prepare) throw new Error('database binding unavailable');
  const subject = payload.subject || SUBJECT;
  const text = payload.text || REDACTED_CONTENT;
  const values = [SENDER, 'service', adminAccount.accountId, adminUser.userId, subject, text, text, JSON.stringify([{ address: recipient, name: '' }]), recipient, payload.challenge, emailConst.type.SEND, status, payload.providerId, payload.sentAt, adminUser.userId, payload.challenge, emailConst.type.SEND];
  await db.prepare(INSERT_IF_ABSENT).bind(...values).run();
  const found = await db.prepare('SELECT email_id, status FROM email WHERE user_id = ? AND message_id = ? AND type = ? LIMIT 1').bind(adminUser.userId, payload.challenge, emailConst.type.SEND).first();
  if (!found) throw new Error('otp log write failed');
  // Delivery is terminal; an accepted result wins over a previous failed result, but failed never downgrades accepted/delivered.
  const shouldUpdate = found.status !== emailConst.status.DELIVERED && (payload.status === 'accepted' || found.status !== emailConst.status.SENT);
  if (shouldUpdate || payload.providerId !== null) {
    const statusSql = 'status = CASE WHEN status = 2 THEN 2 WHEN ? = 8 AND status = 1 THEN 1 ELSE ? END, resend_email_id = COALESCE(?, resend_email_id)';
    // The SQL checks the current row atomically, not a potentially stale SELECT.
    if (payload.status === 'accepted' && payload.text && payload.subject) {
      await db.prepare(`UPDATE email SET ${statusSql}, subject = ?, text = ?, content = ?, recipient = ?, to_email = ? WHERE email_id = ?`).bind(status, status, payload.providerId, subject, text, text, JSON.stringify([{ address: recipient, name: '' }]), recipient, found.email_id).run();
    } else {
      await db.prepare(`UPDATE email SET ${statusSql} WHERE email_id = ?`).bind(status, status, payload.providerId, found.email_id).run();
    }
  }
  return { emailId: found.email_id, duplicate: found.status !== status || !shouldUpdate };
}

export async function handlePortalOtpLog(request, env) {
  const payload = await verifyPortalOtpLogRequest(request, env.PORTAL_MAIL_LOG_SECRET);
  if (!payload) return new Response('Not Found', { status: 404 });
  try {
    await persistPortalOtpLog({ env }, payload);
    return new Response(null, { status: 204 });
  } catch {
    console.error('portal OTP log persistence failed');
    return new Response('Internal Server Error', { status: 500 });
  }
}

export { PATH };
