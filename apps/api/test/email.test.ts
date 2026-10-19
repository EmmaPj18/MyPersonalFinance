import { describe, expect, it } from 'vitest';
import type { MailboxSettings } from '../src/modules/email/imap';
import { runEmailSync } from '../src/modules/email/sync';
import { Client, registerUser, setupApp } from './helpers';

/** A synthetic bank notification as a raw MIME message (fake data). */
const eml = (id: string, from: string, subject: string, html: string, date = 'Sat, 03 Oct 2026 12:00:00 -0400') =>
  [`From: ${from}`, `Subject: ${subject}`, `Date: ${date}`, `Message-ID: <${id}@bank>`, 'Content-Type: text/html; charset=UTF-8', '', html].join('\r\n');

const purchase = (id: string, amount = '1,250.50', date?: string) =>
  eml(
    id,
    'notificaciones@popularenlinea.com',
    'Notificacion de Consumo',
    `<p>Gracias por utilizar su VISA, terminada en 1111.</p><table><tr><td>Monto</td><td>Moneda</td><td>Fecha</td><td>Comercio</td><td>Estatus</td></tr>
     <tr><td>RD$${amount}</td><td>Peso dominicano</td><td>03/10/2026</td><td>SUPERMERCADO CENTRAL</td><td>Aprobada</td></tr></table>`,
    date,
  );
const SENT = eml(
  'sent',
  'notificacionestubancoapp@banreservas.com',
  'Recibo de la transaccion',
  `<p>Monto:</p><p>DOP 3,000.00</p><p>#concept#</p><p>Transacción:</p><p>Transferencia Interbancaria</p>
   <p>Origen:</p><p>JUAN PEREZ, Cuenta de ahorro DOP ** - 7777</p><p>Destino:</p><p>JUAN PEREZ, Cuenta de ahorro DOP ** - 8888</p>
   <p>Fecha de transacción:</p><p>03 de Octubre 2026 - 09:23 AM</p><p>Comisión:</p><p>DOP 100.00</p><p>Impuestos:</p><p>#tax#</p>`,
);
const RECEIVED = eml(
  'received',
  'notificaciones@bsc.com.do',
  'Banco Santa Cruz',
  `<p>TRANSFERENCIA RECIBIDA</p><p>Monto: DOP 3,000.00</p><p>Terminal de cuenta: 8888</p><p>Fecha y hora: 3/10/2026 10:00:00</p><p>Remitente: JUAN PEREZ</p>`,
);
const PROMO = eml('promo', 'notificaciones@bsc.com.do', 'Conoce nuestras tarjetas', '<p>Nuevas tarjetas</p>');

const SECRET = 'test-secret-test-secret-test-secret-123';
const authError = () => Object.assign(new Error('auth'), { authenticationFailed: true });

// Fake mailbox: the password "good" works and it holds whatever the test puts in it.
const mailbox: Buffer[] = [];
const ctx = setupApp({
  mailbox: {
    verify: async (s: MailboxSettings) => {
      if (s.password !== 'good') throw authError();
    },
    fetch: async (s: MailboxSettings) => {
      if (s.password !== 'good') throw authError();
      return mailbox;
    },
  },
});

const uploadEmails = async (client: Client, files: Record<string, string>) => {
  const boundary = '----mpf-email-boundary';
  const body = Buffer.concat([
    ...Object.entries(files).map(([name, content]) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: message/rfc822\r\n\r\n${content}\r\n`),
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/import/email',
    payload: body,
    headers: { cookie: client.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
};

const account = (me: Client, name: string, identifiers: string) =>
  me.ok<{ id: string }>('POST', '/accounts', { name, type: 'bank', currency: 'DOP', identifiers });

describe('bank emails', () => {
  it('imports .eml files: matches accounts, pairs own transfers, adds fees and skips other emails', async () => {
    const me = await registerUser(ctx, 'Correo');
    const card = await account(me, 'Popular Visa', '1111');
    const reservas = await account(me, 'Banreservas ahorro', '7777');
    const santaCruz = await account(me, 'Santa Cruz ahorro', '8888');

    // The receiving side comes in the same upload as the sending one.
    const res = await uploadEmails(me, { 'a.eml': RECEIVED, 'b.eml': purchase('p1'), 'c.eml': SENT, 'd.eml': PROMO });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recognized: 3, added: 4, duplicates: 0, skipped: [{ subject: 'Conoce nuestras tarjetas' }] });

    const inbox = await me.ok<any[]>('GET', '/inbox');
    const by = (description: string) => inbox.find((i) => i.description === description);
    expect(by('SUPERMERCADO CENTRAL')).toMatchObject({ source: 'email', kind: 'expense', amount: '1250.50', accountId: card.id, date: '2026-10-03' });
    expect(by('Transferencia Interbancaria a JUAN PEREZ')).toMatchObject({ kind: 'transfer', accountId: reservas.id, transferAccountId: santaCruz.id });
    expect(by('Comisión e impuestos Banreservas')).toMatchObject({ kind: 'expense', amount: '100.00', accountId: reservas.id });
    expect(by('Transferencia de JUAN PEREZ')).toMatchObject({ kind: 'ignore', accountId: santaCruz.id, direction: 'credit' });

    // The same email again is skipped; an equal purchase in another email is not.
    const again = await uploadEmails(me, { 'b.eml': purchase('p1'), 'e.eml': purchase('p2') });
    expect(again.body).toMatchObject({ added: 1, duplicates: 1 });

    expect((await uploadEmails(me, { 'x.csv': 'a;b' })).status).toBe(400);
  });

  it('takes refunds off their purchase', async () => {
    const me = await registerUser(ctx, 'Devoluciones');
    const card = await me.ok<{ id: string }>('POST', '/accounts', { name: 'Visa USD', type: 'credit_card', currency: 'USD', identifiers: '1212' });
    const santaCruz = (id: string, kind: string, amount: string, day: string) =>
      eml(
        id,
        'notificaciones@bsc.com.do',
        'Notificacion, Banco Santa Cruz',
        `<p>NOTIFICACIÓN DE ${kind}</p><p>Te notificamos que desde tu tarjeta de Crédito terminada en 1212 fue realizada la siguiente transacción:</p>
         <p>Monto: USD ${amount}</p><p>Lugar de transacción: WWW.TIENDA.COM +1415 US</p><p>Fecha y hora: ${day}/10/2026 10:00:00</p><p>Estado: Aprobada</p>`,
      );
    const commitAll = async (remember = true) => {
      const pending = await me.ok<any[]>('GET', '/inbox');
      return me.ok('POST', '/inbox/commit', { remember, items: pending.map((i) => ({ id: i.id, kind: i.kind, refundExpenseId: i.refundExpenseId, scope: 'personal', ownerUserId: me.me.id })) });
    };

    // Purchase and its partial refund in the same review: the purchase is registered first.
    await uploadEmails(me, { 'a.eml': santaCruz('buy1', 'consumo', '100.00', '10'), 'b.eml': santaCruz('ret1', 'Retorno Mercancia', '8.21', '14') });
    const [refund] = (await me.ok<any[]>('GET', '/inbox')).filter((i) => i.kind === 'refund');
    expect(refund).toMatchObject({ direction: 'credit', amount: '8.21', accountId: card.id });
    expect(await commitAll()).toMatchObject({ expense: 1, refund: 1 });
    let [purchase] = await me.ok<any[]>('GET', '/expenses?month=2026-10');
    expect(purchase).toMatchObject({ amount: '91.79', description: 'WWW.TIENDA.COM +1415 US' });

    // A later refund finds the registered purchase; the remembered rule didn't turn it into an expense.
    await uploadEmails(me, { 'c.eml': santaCruz('ret2', 'Retorno Mercancia', '91.79', '16') });
    const [second] = await me.ok<any[]>('GET', '/inbox');
    expect(second).toMatchObject({ kind: 'refund', refundExpenseId: purchase.id });
    expect(second.refundCandidates.map((c: any) => c.id)).toEqual([purchase.id]);
    // The whole amount back cancels the purchase.
    await commitAll();
    expect(await me.ok<any[]>('GET', '/expenses?month=2026-10')).toHaveLength(0);

    // Without a purchase to take it from, it can't be registered.
    await uploadEmails(me, { 'd.eml': santaCruz('ret3', 'Retorno Mercancia', '5.00', '17') });
    expect((await me.post('/inbox/commit', { items: (await me.ok<any[]>('GET', '/inbox')).map((i) => ({ id: i.id, kind: 'refund' })) })).status).toBe(400);
  });

  it('reads a connected mailbox without exposing the password', async () => {
    const me = await registerUser(ctx, 'Buzon');
    await account(me, 'Popular Visa', '1111');
    const bad = await me.post('/email-connections', { username: 'yo@gmail.com', password: 'bad', sinceDate: '2026-10-01' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/contraseña de aplicación/);

    const conn = await me.ok('POST', '/email-connections', { username: 'yo@gmail.com', password: 'good', sinceDate: '2026-10-01' });
    expect(conn).toMatchObject({ host: 'imap.gmail.com', port: 993, mailbox: 'INBOX', active: true });
    expect(conn.passwordEnc).toBeUndefined();

    // The email received before the start date is not read.
    mailbox.splice(0, mailbox.length, Buffer.from(purchase('m1', '99.00')), Buffer.from(purchase('old', '5.00', 'Sat, 05 Sep 2026 12:00:00 -0400')));
    expect(await me.ok('POST', `/email-connections/${conn.id}/sync`)).toMatchObject({ recognized: 1, added: 1 });
    const [listed] = (await me.ok('GET', '/email-connections')).connections;
    expect(listed.lastSyncedAt).toBeTruthy();
    expect(listed.passwordEnc).toBeUndefined();

    // Mailboxes are personal.
    const other = await registerUser(ctx, 'Otro');
    expect((await other.post(`/email-connections/${conn.id}/sync`)).status).toBe(404);

    // The scheduled job reads every active mailbox.
    mailbox.push(Buffer.from(purchase('m2', '77.00')));
    expect((await runEmailSync(ctx.app.db, SECRET, ctx.app.mailbox.fetch)).failed).toBe(0);
    expect((await me.ok<any[]>('GET', '/inbox')).map((i) => i.amount).sort()).toEqual(['77.00', '99.00']);

    // One that fails keeps the reason.
    expect((await runEmailSync(ctx.app.db, 'another-secret-another-secret-123456', ctx.app.mailbox.fetch)).failed).toBeGreaterThan(0);
    const [afterError] = (await me.ok('GET', '/email-connections')).connections;
    expect(afterError.lastError).toBeTruthy();

    await me.ok('DELETE', `/email-connections/${conn.id}`);
    expect((await me.ok('GET', '/email-connections')).connections).toHaveLength(0);
  });
});
