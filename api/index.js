import app from '../dist/index.js';

export default async function handler(req, res) {
  // Convert Vercel Node req/res into something Hono can handle
  return app.handle(req, res);
}
