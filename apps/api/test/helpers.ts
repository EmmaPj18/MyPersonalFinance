import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import { buildApp, type App } from '../src/app';
import { createDb } from '../src/db/client';

export interface TestContext {
  app: App;
}

/** Builds the app against the test database for one test file. */
export const setupApp = () => {
  const ctx = {} as TestContext;
  let pool: { end: () => Promise<void> };
  beforeAll(async () => {
    const created = createDb(process.env.TEST_DATABASE_URL!);
    pool = created.pool;
    ctx.app = await buildApp({
      db: created.db,
      logger: false,
      config: {
        NODE_ENV: 'test',
        API_PORT: 0,
        DATABASE_URL: process.env.TEST_DATABASE_URL!,
        SESSION_SECRET: 'test-secret-test-secret-test-secret-123',
        COOKIE_SECURE: false,
        WEB_ORIGIN: 'http://localhost:5173',
        SESSION_TTL_DAYS: 1,
      },
    });
  });
  afterAll(async () => {
    await ctx.app.close();
    await pool.end();
  });
  return ctx;
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A logged-in API client that keeps its session cookie. */
export class Client {
  cookie = '';
  me!: { id: string; email: string; name: string; household: { id: string } };

  constructor(private ctx: TestContext) {}

  async request<T = any>(method: Method, url: string, payload?: unknown) {
    const res = await this.ctx.app.inject({
      method,
      url: `/api${url}`,
      payload: payload as any,
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const setCookie = res.cookies.find((c) => c.name === 'mpf_session');
    if (setCookie) this.cookie = `mpf_session=${setCookie.value}`;
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  }

  get = <T = any>(url: string) => this.request<T>('GET', url);
  post = <T = any>(url: string, payload?: unknown) => this.request<T>('POST', url, payload ?? {});
  put = <T = any>(url: string, payload?: unknown) => this.request<T>('PUT', url, payload);
  patch = <T = any>(url: string, payload?: unknown) => this.request<T>('PATCH', url, payload);
  del = <T = any>(url: string) => this.request<T>('DELETE', url);

  /** Expects a 2xx and returns the body. */
  async ok<T = any>(method: Method, url: string, payload?: unknown): Promise<T> {
    const res = await this.request<T>(method, url, payload);
    if (res.status >= 300) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}

export const uniqueEmail = (prefix: string) =>
  `${prefix.normalize('NFD').replace(/[^a-z0-9]/gi, '')}-${randomUUID().slice(0, 8)}@test.com`;

export const registerUser = async (ctx: TestContext, name: string, extra: Record<string, unknown> = {}) => {
  const client = new Client(ctx);
  client.me = await client.ok('POST', '/auth/register', {
    name,
    email: uniqueEmail(name.toLowerCase()),
    password: 'secret123',
    defaultCurrency: 'DOP',
    ...extra,
  });
  return client;
};

/** Registers an owner and invites a second member that creates a new account. */
export const createCouple = async (ctx: TestContext) => {
  const owner = await registerUser(ctx, 'Emmanuel');
  const wifeEmail = uniqueEmail('esposa');
  const invitation = await owner.ok('POST', '/household/invitations', { email: wifeEmail, role: 'member' });
  const token = invitation.url.split('/').pop();
  const wife = new Client(ctx);
  await wife.ok('POST', `/invitations/${token}/accept`, { name: 'Esposa', password: 'secret123' });
  wife.me = await wife.ok('GET', '/auth/me');
  return { owner, wife };
};

export const categoryId = async (client: Client, name: string) => {
  const cats = await client.ok<{ id: string; name: string }[]>('GET', '/categories');
  return cats.find((c) => c.name === name)!.id;
};
