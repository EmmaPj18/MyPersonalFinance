import { describe, expect, it } from 'vitest';
import { categoryId, Client, createCouple, registerUser, setupApp } from './helpers';

const ctx = setupApp();

/** Uploads a file the way the browser does (multipart/form-data). */
const upload = async (client: Client, fileName: string, content: string | Buffer) => {
  const boundary = '----mpf-test-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/import/parse',
    payload: body,
    headers: { cookie: client.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
};

const STATEMENT = [
  'Banco Popular - Estado de cuenta',
  '',
  'Fecha;Descripción;Débito;Crédito;Balance',
  '01/10/2026;COMPRA SUPERMERCADO NACIONAL 4521;3.250,75;;10.000,00',
  '02/10/2026;TRANSFERENCIA A CTA AHORRO;5.000,00;;5.000,00',
  '03/10/2026;DEPOSITO NOMINA DGII;;82.353,04;87.353,04',
  '05/10/2026;COMPRA SUPERMERCADO NACIONAL 9911;1.200,00;;86.153,04',
].join('\r\n');

describe('import and review', () => {
  it('imports a bank CSV into the review inbox and registers the reviewed transactions', async () => {
    const { owner } = await createCouple(ctx);
    const food = await categoryId(owner, 'Supermercado');
    const checking = await owner.ok('POST', '/accounts', { name: 'Popular corriente', type: 'bank', currency: 'DOP', openingBalance: '10000' });
    const savings = await owner.ok('POST', '/accounts', { name: 'Ahorro', type: 'savings', currency: 'DOP' });
    const job = await owner.ok('POST', '/income-sources', { name: 'DGII', type: 'formal_employment', defaultCurrency: 'DOP' });

    const parsed = await upload(owner, 'popular.csv', STATEMENT);
    expect(parsed.status).toBe(200);
    expect(parsed.body.headers).toEqual(['Fecha', 'Descripción', 'Débito', 'Crédito', 'Balance']);
    expect(parsed.body.suggested.columns).toEqual({ date: 'Fecha', description: 'Descripción', debit: 'Débito', credit: 'Crédito' });

    const batch = {
      fileName: 'popular.csv',
      source: 'csv',
      rows: parsed.body.rows,
      mapping: parsed.body.suggested,
      accountId: checking.id,
      currency: 'DOP',
    };
    const preview = await owner.ok('POST', '/import/batches', { ...batch, dryRun: true });
    expect(preview.total).toBe(4);
    expect(preview.preview[0]).toMatchObject({ date: '2026-10-01', amount: '3250.75', direction: 'debit' });

    expect(await owner.ok('POST', '/import/batches', { ...batch, saveProfileAs: 'Popular CSV' })).toMatchObject({ added: 4, duplicates: 0 });
    // Importing the same file again adds nothing.
    expect(await owner.ok('POST', '/import/batches', batch)).toMatchObject({ added: 0, duplicates: 4 });

    const inbox = await owner.ok<any[]>('GET', '/inbox');
    expect(inbox).toHaveLength(4);
    const byText = (t: string) => inbox.find((i) => i.description.includes(t));
    expect(byText('NOMINA')).toMatchObject({ direction: 'credit', kind: 'income' });

    // Review: groceries remembered as a rule, transfer to savings, salary to its source.
    const first = byText('4521');
    const result = await owner.ok('POST', '/inbox/commit', {
      remember: true,
      items: [
        { id: first.id, kind: 'expense', categoryId: food, scope: 'shared' },
        { id: byText('TRANSFERENCIA').id, kind: 'transfer', transferAccountId: savings.id },
        { id: byText('NOMINA').id, kind: 'income', incomeSourceId: job.id },
      ],
    });
    expect(result).toEqual({ expense: 1, income: 1, transfer: 1, ignore: 0 });

    // The rule was applied to the other pending grocery purchase.
    const rules = await owner.ok<any[]>('GET', '/categorization-rules');
    expect(rules.map((r) => r.pattern)).toContain('compra supermercado nacional');
    await owner.ok('POST', '/categorization-rules', { pattern: 'farmacia carol', kind: 'expense', categoryId: await categoryId(owner, 'Salud') });
    const [pending] = await owner.ok<any[]>('GET', '/inbox');
    expect(pending).toMatchObject({ kind: 'expense', categoryId: food });

    const accounts = await owner.ok<any[]>('GET', '/accounts');
    // 10,000 - 3,250.75 - 5,000 (transfer) + 82,353.04 (salary)
    expect(accounts.find((a) => a.id === checking.id).balance).toBe('84102.29');
    expect(accounts.find((a) => a.id === savings.id).balance).toBe('5000.00');
    const expenses = await owner.ok<any[]>('GET', '/expenses?month=2026-10');
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ amount: '3250.75', categoryId: food, accountId: checking.id, scope: 'shared' });

    const ignored = await owner.ok('POST', '/inbox/ignore', { ids: [pending.id] });
    expect(ignored).toEqual({ ignored: 1 });
    expect(await owner.ok<any[]>('GET', '/inbox')).toHaveLength(0);

    // The saved profile is suggested next time.
    const again = await upload(owner, 'otro.csv', STATEMENT);
    expect(again.body.profileName).toBe('Popular CSV');
  });

  it('flags transactions that look like an expense already registered', async () => {
    const me = await registerUser(ctx, 'Dup');
    await me.ok('POST', '/expenses', { description: 'Supermercado', amount: '1500', currency: 'DOP', date: '2026-10-02', scope: 'shared' });
    const parsed = await upload(me, 'gastos.csv', 'Fecha,Descripción,Monto\n2026-10-03,SUPER,-1500\n');
    await me.ok('POST', '/import/batches', { source: 'csv', rows: parsed.body.rows, mapping: parsed.body.suggested, currency: 'DOP' });
    const [item] = await me.ok<any[]>('GET', '/inbox');
    expect(item.duplicateOfExpenseId).toBeTruthy();
    expect(item.kind).toBe('ignore');
  });

  it('downloads the template and reads it back', async () => {
    const me = await registerUser(ctx, 'Plantilla');
    const res = await ctx.app.inject({ method: 'GET', url: '/api/import/template.xlsx' });
    expect(res.statusCode).toBe(200);
    const parsed = await upload(me, 'plantilla.xlsx', res.rawPayload);
    expect(parsed.body.headers).toEqual(['Fecha', 'Descripción', 'Monto', 'Moneda', 'Categoría', 'Tipo', 'De', 'Cuenta']);
    await me.ok('POST', '/import/batches', { source: 'xlsx', rows: parsed.body.rows, mapping: parsed.body.suggested, currency: 'DOP' });
    const inbox = await me.ok<any[]>('GET', '/inbox');
    const super_ = inbox.find((i) => i.description === 'Supermercado Nacional');
    expect(super_).toMatchObject({ amount: '3250.75', direction: 'debit', kind: 'expense', categoryId: await categoryId(me, 'Supermercado') });
    expect(inbox.find((i) => i.description === 'Netflix')).toMatchObject({ currency: 'USD', amount: '15.99' });
    expect(inbox.find((i) => i.description === 'Venta de artículos')).toMatchObject({ direction: 'credit', kind: 'income' });
  });

  it('records transfers between accounts', async () => {
    const me = await registerUser(ctx, 'Transfer');
    const usd = await me.ok('POST', '/accounts', { name: 'USD', type: 'bank', currency: 'USD', openingBalance: '1000' });
    const dop = await me.ok('POST', '/accounts', { name: 'DOP', type: 'bank', currency: 'DOP' });
    expect((await me.post('/transfers', { fromAccountId: usd.id, toAccountId: dop.id, date: '2026-10-01', amount: '100' })).status).toBe(400);
    await me.ok('POST', '/transfers', { fromAccountId: usd.id, toAccountId: dop.id, date: '2026-10-01', amount: '100', toAmount: '6150' });
    const accounts = await me.ok<any[]>('GET', '/accounts');
    expect(accounts.find((a) => a.id === usd.id).balance).toBe('900.00');
    expect(accounts.find((a) => a.id === dop.id).balance).toBe('6150.00');
  });
});
