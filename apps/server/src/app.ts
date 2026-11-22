import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';
import { now } from './db.ts';
import { authenticate, safeEqual } from './auth.ts';
import { HttpError } from './validate.ts';
import { hardwareRouter } from './hardwareRoutes.ts';
import { authRoutes, publicAuthRoutes } from './routes/auth.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { salesRoutes } from './routes/sales.ts';
import { inventoryRoutes } from './routes/inventory.ts';
import { miscRoutes } from './routes/misc.ts';
import { openOrderRoutes } from './routes/openOrders.ts';

export const API_VERSION = '2';

export interface AppOptions {
  db: DB;
  /** Optional service key: requests with header `x-api-key` act as the owner (integrations, scripts). */
  apiKey?: string;
}

export function createApp({ db, apiKey }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ---- public
  app.get('/api/health', (req, res) => {
    const given = req.header('x-api-key') ?? undefined;
    const auth = !apiKey ? 'disabled' : !given ? 'missing' : safeEqual(given, apiKey) ? 'ok' : 'invalid';
    res.json({ ok: true, service: 'shopflow-server', apiVersion: API_VERSION, time: now(), auth });
  });
  app.use('/api', publicAuthRoutes(db));

  // ---- everything else requires a session token (or the service key)
  app.use('/api', authenticate(db, apiKey));
  app.use('/api', authRoutes(db));
  app.use('/api', catalogRoutes(db));
  app.use('/api', salesRoutes(db));
  app.use('/api', inventoryRoutes(db));
  app.use('/api', miscRoutes(db));
  app.use('/api', openOrderRoutes(db));
  app.use('/api/hardware', hardwareRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not found')));

  // Built web apps (npm run build): POS at /pos/, Boss at /boss/. One port serves everything,
  // so a phone on the same Wi-Fi only needs http://<pc-ip>:4000/boss/.
  const appsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const [route, dir] of [['/pos', 'pos'], ['/boss', 'boss']] as const) {
    const dist = join(appsDir, dir, 'dist');
    if (!existsSync(join(dist, 'index.html'))) continue;
    // Non-strict routing treats /pos and /pos/ alike: only redirect the exact slash-less path.
    app.get(route, (req, res, next) => (req.originalUrl === route ? res.redirect(`${route}/`) : next()));
    app.use(route, express.static(dist, { index: 'index.html', maxAge: '1h', setHeaders: (res, path) => path.endsWith('index.html') && res.setHeader('cache-control', 'no-cache') }));
  }
  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShopFlow</title>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#eff6ff">
<div style="display:flex;flex-direction:column;gap:12px;width:min(360px,90vw)"><h1 style="color:#1d4ed8">ShopFlow</h1>
<a href="/pos/" style="padding:16px;border-radius:12px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">ShopFlow POS (bán hàng)</a>
<a href="/boss/" style="padding:16px;border-radius:12px;background:#f97316;color:#fff;text-decoration:none;font-weight:700">ShopFlow Boss (điện thoại chủ)</a></div></body>`);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'invalid JSON body' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
