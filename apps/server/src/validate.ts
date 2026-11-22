export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg: string) => new HttpError(400, msg);

export function str(v: unknown, field: string, opts: { optional?: boolean; max?: number } = {}): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return undefined;
    throw bad(`${field} is required`);
  }
  if (typeof v !== 'string') throw bad(`${field} must be a string`);
  const s = v.trim();
  if (s.length > (opts.max ?? 200)) throw bad(`${field} is too long`);
  return s;
}

export function reqStr(v: unknown, field: string, max?: number): string {
  return str(v, field, { max }) as string;
}

export function int(v: unknown, field: string, opts: { optional?: boolean; min?: number; max?: number } = {}): number | undefined {
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw bad(`${field} is required`);
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) throw bad(`${field} must be an integer`);
  if (opts.min !== undefined && v < opts.min) throw bad(`${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw bad(`${field} must be <= ${opts.max}`);
  return v;
}

export function reqInt(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  return int(v, field, opts) as number;
}

export function isoDate(v: unknown, field: string, optional = false): string | undefined {
  const s = str(v, field, { optional, max: 40 });
  if (s === undefined) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw bad(`${field} must be an ISO date`);
  return d.toISOString();
}

/** Upper bound for money values (integer VND). */
export const MAX_MONEY = 10_000_000_000;
