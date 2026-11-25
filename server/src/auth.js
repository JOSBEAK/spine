// Accounts: password hashing, bearer sessions, login rate limiting and the /auth routes.

import { randomBytes, scrypt as scryptCb, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { HttpError, unauthorized, readJson, parse } from './http.js';

const scrypt = promisify(scryptCb);

// scrypt N=2^15, r=8, p=1 needs 32 MiB; Node's default maxmem is exactly 32 MiB, so raise it.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
const SESSION_DAYS = 60;
const SLIDE_AFTER_MS = 60 * 60 * 1000; // refresh last_seen/expiry at most once an hour per session
const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 86400 * 1000;

// ---------- passwords ----------

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used when the email is unknown so a login takes the same time either way.
let dummyHash = null;
const getDummyHash = async () => (dummyHash ??= await hashPassword(randomBytes(16).toString('hex')));

// ---------- sessions ----------

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

export async function createSession(q, userId, userAgent, now) {
  const token = randomBytes(32).toString('base64url');
  await q.query(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent)
     VALUES (decode($1, 'hex'), $2, $3, $3, $4, $5)`,
    [sha256hex(token), userId, now.toISOString(), new Date(+now + SESSION_DAYS * DAY_MS).toISOString(), (userAgent || '').slice(0, 200) || null],
  );
  return token;
}

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, prefs: u.prefs || {}, created_at: u.created_at });

/** Middleware: requires `Authorization: Bearer <token>`, sets c.var.user and c.var.tokenHash. */
export function requireUser(ctx) {
  return async (c, next) => {
    const header = c.req.header('authorization') || '';
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})\s*$/i.exec(header);
    if (!m) throw unauthorized('You need to be signed in. Send your session token as "Authorization: Bearer <token>".');
    const hash = sha256hex(m[1]);
    const now = ctx.now();
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.email, u.name, u.prefs, u.created_at, u.pw_hash, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = decode($1, 'hex') AND s.expires_at > $2`,
      [hash, now.toISOString()],
    );
    if (!rows.length) throw unauthorized('Your session has expired or you were signed out. Please sign in again.');
    const user = rows[0];
    if (now - new Date(user.last_seen_at) > SLIDE_AFTER_MS) {
      await ctx.db.query(
        `UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = decode($1, 'hex')`,
        [hash, now.toISOString(), new Date(+now + SESSION_DAYS * DAY_MS).toISOString()],
      );
    }
    c.set('user', user);
    c.set('tokenHash', hash);
    await next();
  };
}

/** The signed-in user for an optional `Authorization` header, or null (no header, or a stale token). */
export async function optionalUser(ctx, c) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})\s*$/i.exec(c.req.header('authorization') || '');
  if (!m) return null;
  const { rows } = await ctx.db.query(
    `SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = decode($1, 'hex') AND s.expires_at > $2`,
    [sha256hex(m[1]), ctx.now().toISOString()],
  );
  return rows[0] || null;
}

// ---------- rate limiting (login_attempts) ----------

export async function checkRateLimit(q, key, now) {
  const { rows } = await q.query('SELECT failures, window_start FROM login_attempts WHERE key = $1', [key]);
  const r = rows[0];
  if (!r || r.failures < MAX_FAILURES) return;
  const left = WINDOW_MS - (now - new Date(r.window_start));
  if (left <= 0) return;
  const minutes = Math.ceil(left / 60000);
  throw new HttpError(
    429,
    `Too many wrong passwords. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
    { 'Retry-After': String(Math.ceil(left / 1000)) },
  );
}

export async function recordFailure(q, key, now) {
  const windowCut = new Date(+now - WINDOW_MS).toISOString();
  await q.query(
    `INSERT INTO login_attempts (key, failures, window_start) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       failures     = CASE WHEN login_attempts.window_start < $3 THEN 1 ELSE login_attempts.failures + 1 END,
       window_start = CASE WHEN login_attempts.window_start < $3 THEN $2::timestamptz ELSE login_attempts.window_start END`,
    [key, now.toISOString(), windowCut],
  );
  await q.query('DELETE FROM login_attempts WHERE window_start < $1', [new Date(+now - DAY_MS).toISOString()]);
}

export const clearFailures = (q, key) => q.query('DELETE FROM login_attempts WHERE key = $1', [key]);

/** Checks the signed-in user's password for sensitive actions, with the same rate limit as login. */
export async function confirmPassword(ctx, user, password) {
  const key = `pw|${user.id}`;
  const now = ctx.now();
  await checkRateLimit(ctx.db, key, now);
  if (!(await verifyPassword(password, user.pw_hash))) {
    await recordFailure(ctx.db, key, now);
    throw unauthorized('That password is not right. Check it and try again.');
  }
  await clearFailures(ctx.db, key);
}

export function clientIp(c, trustProxy) {
  if (trustProxy) {
    const fwd = c.req.header('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    const real = c.req.header('x-real-ip');
    if (real) return real.trim();
  }
  return c.env?.incoming?.socket?.remoteAddress || 'unknown';
}

// ---------- routes ----------

const email = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .max(254, 'That email address is too long')
  .pipe(z.email({ error: 'Enter a valid email address, like name@example.com' }));
const password = z.string({ error: 'Enter a password' }).max(256, 'Passwords can be at most 256 characters');

const SignupBody = z.object({
  email,
  password: password.min(8, 'Use a password with at least 8 characters'),
  name: z.string().trim().max(100, 'Names can be at most 100 characters').optional(),
});
const LoginBody = z.object({ email, password: password.min(1, 'Enter your password') });

export function authRoutes(app, ctx) {
  app.post('/auth/signup', async (c) => {
    const body = parse(SignupBody, await readJson(c));
    const now = ctx.now();
    const pwHash = await hashPassword(body.password);
    const result = await ctx.db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO users (email, name, pw_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name, prefs, created_at`,
        [body.email, body.name || '', pwHash, now.toISOString()],
      );
      if (!rows.length) return null;
      const token = await createSession(q, rows[0].id, c.req.header('user-agent'), now);
      return { token, user: publicUser(rows[0]) };
    });
    if (!result) throw new HttpError(409, 'An account with this email already exists. Sign in instead, or use a different email.');
    return c.json(result, 201);
  });

  app.post('/auth/login', async (c) => {
    const body = parse(LoginBody, await readJson(c));
    const now = ctx.now();
    const key = `${clientIp(c, ctx.config.trustProxy)}|${body.email}`;
    await checkRateLimit(ctx.db, key, now);
    const { rows } = await ctx.db.query('SELECT id, email, name, prefs, created_at, pw_hash FROM users WHERE email = $1', [body.email]);
    const user = rows[0];
    const ok = await verifyPassword(body.password, user ? user.pw_hash : await getDummyHash());
    if (!user || !ok) {
      await recordFailure(ctx.db, key, now);
      throw unauthorized("That email and password don't match. Check them and try again.");
    }
    await clearFailures(ctx.db, key);
    await ctx.db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= $2', [user.id, now.toISOString()]);
    const token = await createSession(ctx.db, user.id, c.req.header('user-agent'), now);
    return c.json({ token, user: publicUser(user) });
  });

  app.post('/auth/logout', requireUser(ctx), async (c) => {
    await ctx.db.query(`DELETE FROM sessions WHERE token_hash = decode($1, 'hex')`, [c.get('tokenHash')]);
    return c.body(null, 204);
  });
}
