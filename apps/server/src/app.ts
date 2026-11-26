import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';
import { logChange, now, tx } from './db.ts';
import { PRODUCT_IMAGE_GROUPS, productImagePath } from './productImages.ts';
import { productDir } from './menuWatch.ts';
import { authenticate, safeEqual } from './auth.ts';
import { HttpError } from './validate.ts';
import { hardwareRouter } from './hardwareRoutes.ts';
import { authRoutes, publicAuthRoutes } from './routes/auth.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { salesRoutes } from './routes/sales.ts';
import { miscRoutes } from './routes/misc.ts';
import { openOrderRoutes } from './routes/openOrders.ts';
import { storeRoutes } from './routes/store.ts';

export const API_VERSION = '2';

export interface AppOptions {
  db: DB;
  /** Optional service key: requests with header `x-api-key` act as the owner (integrations, scripts). */
  apiKey?: string;
}

export function createApp({ db, apiKey }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a tunnel / reverse proxy on this machine (cloudflared, Caddy), use the real client IP
  // from X-Forwarded-For so per-IP login lockout and rate limits apply to the right person.
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  // Simple per-IP rate limit for the API (generous for a shop, stops floods when exposed to the Internet).
  const hits = new Map<string, { n: number; reset: number }>();
  app.use('/api', (req, res, next) => {
    if (req.path === '/events') return next();
    const ip = req.ip ?? '';
    const t = Date.now();
    const h = hits.get(ip);
    if (!h || t > h.reset) hits.set(ip, { n: 1, reset: t + 60_000 });
    else if (++h.n > 1200) return void res.status(429).json({ error: 'too many requests, slow down' });
    if (hits.size > 5000) hits.clear();
    next();
  });
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ---- public
  app.get('/api/health', (req, res) => {
    const given = req.header('x-api-key') ?? undefined;
    const auth = !apiKey ? 'disabled' : !given ? 'missing' : safeEqual(given, apiKey) ? 'ok' : 'invalid';
    res.json({ ok: true, service: 'shopflow-server', apiVersion: API_VERSION, time: now(), auth });
  });
  app.use('/api', publicAuthRoutes(db));

  // Migrate only legacy local image URLs; leave custom/external photos and menu data intact.
  tx(db, () => {
    const rows = db.prepare('SELECT id, image_url FROM products WHERE image_url LIKE ?').all('/media/products/%');
    for (const row of rows) {
      const url = String(row.image_url);
      const match = url.match(/^\/media\/products\/([a-z0-9-]+)(\.(?:jpe?g|png|webp))?$/i);
      if (!match) continue;
      const path = productImagePath(match[1]);
      if (path === match[1]) continue;
      db.prepare('UPDATE products SET image_url = ?, updated_at = ? WHERE id = ?')
        .run(`/media/products/${path}${match[2] ?? ''}`, now(), row.id);
      logChange(db, 'product', String(row.id), 'upsert');
    }
  });

  // Public labeled photos, plus legacy flat URLs for existing clients.
  const imgDirs = [
    process.env.MENU_IMG_DIR ?? join(productDir(), 'product_img'),
    join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'products'),
  ];
  app.get(['/media/products/:group/:name', '/media/products/:name'], (req, res) => {
    const name = String(req.params.name).replace(/\.(jpe?g|png|webp)$/i, '');
    if (!/^[a-z0-9-]{1,80}$/.test(name)) return void res.status(400).end();
    const group = req.params.group;
    if (group && !PRODUCT_IMAGE_GROUPS.some((g) => g === group)) return void res.status(400).end();
    const paths = group ? [`${group}/${name}`] : [...new Set([productImagePath(name), name])];
    for (const dir of imgDirs) {
      for (const path of paths) {
        for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
          const file = join(dir, `${path}.${ext}`);
          // Revalidate replaced photos on the next load, while retaining cheap 304 responses.
          if (existsSync(file)) return void res.sendFile(file, { maxAge: 0, lastModified: true, etag: true });
        }
      }
    }
    res.status(404).end();
  });

  // ---- everything else requires a session token (or the service key)
  app.use('/api', authenticate(db, apiKey));
  app.use('/api', authRoutes(db));
  app.use('/api', catalogRoutes(db));
  app.use('/api', salesRoutes(db));
  app.use('/api', miscRoutes(db));
  app.use('/api', openOrderRoutes(db));
  app.use('/api', storeRoutes(db));
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
  // Bare link: computers/POS terminals go straight to the POS, phones to Boss. "/?chon" shows the chooser.
  app.get('/', (req, res, next) => {
    if ('chon' in req.query) return next();
    const ua = String(req.headers['user-agent'] ?? '');
    const phone = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua);
    res.redirect(302, phone ? '/boss/' : '/pos/');
  });
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
