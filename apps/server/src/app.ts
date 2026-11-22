import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
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
  app.use('/api/hardware', hardwareRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not found')));

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
