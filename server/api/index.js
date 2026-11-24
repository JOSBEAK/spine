// Vercel entry point (Node.js runtime). vercel.json sends every path here.

import { handle } from 'hono/vercel';
import app from '../src/app.js';

const h = handle(app);

// Requests normally arrive with their original path (/health, /sync, ...). If one arrives as /api/...,
// strip the prefix so the same routes match.
function handler(req) {
  const url = new URL(req.url);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.slice(4) || '/';
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    req = new Request(url, { method: req.method, headers: req.headers, body: hasBody ? req.body : undefined, duplex: 'half' });
  }
  return h(req);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
