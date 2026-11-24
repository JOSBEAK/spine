// Errors and request parsing. Every error leaves the API as { error: "Plain sentence." }.

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const unauthorized = (msg = 'Please sign in again.') => new HttpError(401, msg);
export const notFound = (msg) => new HttpError(404, msg);

/** Reads the JSON body. An empty body counts as {}. */
export async function readJson(c) {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('The request body is not valid JSON. Send a JSON object with Content-Type: application/json.');
  }
}

/** Validates with a zod schema and turns the first problem into a readable sentence. */
export function parse(schema, value, label = 'request body') {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue.path.length ? issue.path.join('.') : label;
  const msg = issue.message && !/^Invalid input/.test(issue.message) ? issue.message : 'has the wrong type or format';
  throw badRequest(`${where}: ${msg.replace(/\.$/, '')}.`);
}

/** Runs async fn over items with at most `limit` in flight; results keep their order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());
