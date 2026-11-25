import type { Request, Response } from 'express';
import type { Role } from './auth.ts';

// Server-Sent Events hub: POS and Boss subscribe to GET /api/events and receive
// { type, data } messages (order.created, shift.updated, notification, ...).

interface Client {
  res: Response;
  role: Role;
}

const clients = new Set<Client>();

export type EventType =
  | 'order.created'
  | 'order.updated'
  | 'shift.updated'
  | 'catalog.changed'
  | 'open_orders.changed'
  | 'notification';

export function publish(type: EventType, data: unknown, roles?: Role[]) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (roles && c.role !== 'owner' && !roles.includes(c.role)) continue;
    c.res.write(payload);
  }
}

export function subscribe(req: Request, res: Response) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no', // disable proxy buffering (nginx)
  });
  res.write(`retry: 3000\n\n`);
  const client: Client = { res, role: req.user!.role };
  clients.add(client);
  // A named event (not a ":" comment, which EventSource hides from the page) so clients can tell a
  // live stream from one silently dropped while the phone app slept, and reconnect.
  const ping = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

export const clientCount = () => clients.size;
