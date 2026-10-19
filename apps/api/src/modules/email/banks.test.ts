import { describe, expect, it } from 'vitest';
import { parseBankEmail } from './banks';
import { htmlToText, parseDate, readEmail, type EmailContent } from './text';

// Synthetic notifications with the same layout as the real ones (fake names, numbers and amounts).
const email = (from: string, subject: string, text: string, receivedAt = '2026-10-10T16:00:00.000Z'): EmailContent => ({
  messageId: `<${subject}@test>`,
  from,
  subject,
  receivedAt,
  text: text.trim().replace(/^ +/gm, ''),
});

describe('bank email parsers', () => {
  it.each([
    [
      'Popular purchase',
      email('notificaciones@popularenlinea.com', 'Notificación de Consumo', `
        Estimado (a) JUAN PEREZ
        Gracias por utilizar su VISA PLATINUM, terminada en 1111.
        Monto | Moneda | Fecha | Comercio | Estatus
        RD$1,250.50 | Peso dominicano | 07/02/2026 | SUPERMERCADO CENTRAL | Aprobada`),
      { bank: 'popular', type: 'purchase', amount: '1250.50', currency: 'DOP', date: '2026-02-07', description: 'SUPERMERCADO CENTRAL', last4: '1111' },
    ],
    [
      'Popular withdrawal',
      email('notificaciones@popularenlinea.com', 'Notificación de Retiro', `
        Gracias por utilizar su Tarjeta VISA DEBITO, terminada en 2222.
        Monto | Moneda | Fecha | Cajero Automatico | Estatus
        RD$500.00 | Peso dominicano | 03/10/2026 | CAJERO PLAZA | Aprobada`),
      { type: 'withdrawal', amount: '500.00', date: '2026-10-03', description: 'Retiro CAJERO PLAZA', last4: '2222' },
    ],
    [
      'Popular instant payment sent',
      email('notificaciones@popularenlinea.com', 'Notificaciones Pagos al Instante transferencia enviada', `
        Le informamos que su transacción por pagos al instante fue enviada satisfactoriamente.
        Beneficiario: MARIA GOMEZ
        Cuenta o Producto:******_3333
        Monto: RD$ 10,000.00
        Fecha: 17/8/2026`),
      { type: 'transfer_out', amount: '10000.00', date: '2026-08-17', description: 'Pago al instante a MARIA GOMEZ', last4: null, counterpartLast4: '3333' },
    ],
    [
      'Popular transfer received',
      email('notificaciones@popularenlinea.com', 'Notificación transf recibida via app e IB', `
        Le informamos los detalles de la transacción de transferencia recibida en su cuenta terminada en 4444 :
        Monto | Fecha | Canal
        RD 2,000.00 | 15/8/2026
        | APP POPULAR`),
      { type: 'transfer_in', amount: '2000.00', currency: 'DOP', date: '2026-08-15', last4: '4444' },
    ],
    [
      'Popular declined purchase',
      email('notificaciones@popularenlinea.com', 'Notificación de Consumo', `
        Gracias por utilizar su VISA, terminada en 1111.
        Monto | Moneda | Fecha | Comercio | Estatus
        RD$99.00 | Peso dominicano | 07/02/2026 | TIENDA | Declinada`),
      null,
    ],
    [
      'BHD card purchase',
      email('alertas@bhd.com.do', 'BHD Notificación de Transacciones', `
        Mastercard Platinum # 5555
        Detalle de Transacciones
        Fecha
        Moneda
        Monto
        Comercio
        Estado
        Tipo
        30/07/2026 11:23 pm
        US
        $25.00
        TIENDA ONLINE
        Aprobada
        Compra`),
      { bank: 'bhd', type: 'purchase', amount: '25.00', currency: 'USD', date: '2026-07-30', description: 'TIENDA ONLINE', last4: '5555' },
    ],
    [
      'BHD transfer between own products',
      email('alertas@bhd.com.do', 'Transacciones entre mis productos', `
        Producto origen:
        DO00BCBH000000000XXXXXXX6666
        Producto destino:
        XXXXXXXXXXXX5555
        Descripción:
        Monto:
        RD$ 7,000.00
        Beneficiario:
        JUAN PEREZ
        Fecha y hora de la transacción:
        02/10/2026 - 12:27 PM`),
      { type: 'transfer_out', amount: '7000.00', date: '2026-10-02', description: 'Transferencia a JUAN PEREZ', last4: '6666', counterpartLast4: '5555' },
    ],
    [
      'Banreservas payroll',
      email('notificaciones@banreservas.com', 'Notificaciones Banreservas', `
        Notificación Pago Nómina
        Monto:
        DOP$ 50,000.00
        Cuenta:
        Cuenta de Ahorros •••• 7777
        Fecha de transacción:
        09/10/2026 01:10 PM`),
      { bank: 'banreservas', type: 'payroll', amount: '50000.00', date: '2026-10-09', last4: '7777' },
    ],
    [
      'Banreservas transfer with concept and fees',
      email('notificacionestubancoapp@banreservas.com', 'Recibo de la transacción', `
        ¡Transacción realizada!
        Monto:
        DOP 3,000.00
        alquiler
        Transacción:
        Transferencia a Tercero
        Origen:
        JUAN PEREZ, Cuenta de ahorro DOP ** - 7777
        Destino:
        PEDRO DIAZ, Cuenta de ahorro DOP ** - 8888
        Fecha de transacción:
        9 de Octubre de 2026 - 8:57 AM
        Comisión:
        DOP 100.00
        Impuestos:
        12.00`),
      { type: 'transfer_out', amount: '3000.00', date: '2026-10-09', description: 'alquiler', last4: '7777', counterpartLast4: '8888', fees: '112.00' },
    ],
    [
      'Santa Cruz transfer received',
      email('notificaciones@bsc.com.do', 'Banco Santa Cruz', `
        TRANSFERENCIA RECIBIDA
        Monto: USD 1,000.00
        Terminal de cuenta: 9999
        Fecha y hora: 22/9/2026 12:09:46
        Banco remitente: BANCO EJEMPLO
        Remitente: JUAN PEREZ`),
      { bank: 'santacruz', type: 'transfer_in', amount: '1000.00', currency: 'USD', date: '2026-09-22', description: 'Transferencia de JUAN PEREZ (BANCO EJEMPLO)', last4: '9999' },
    ],
    [
      'Santa Cruz purchase',
      email('notificaciones@bsc.com.do', 'Notificación, Banco Santa Cruz', `
        NOTIFICACIÓN DE consumo
        Te notificamos que desde tu tarjeta de Crédito Platino terminada en 1212 fue realizada la siguiente transacción:
        Monto: RD$ 300.00
        Lugar de transacción: CAFETERIA EJEMPLO DO
        Fecha y hora: 18/10/2026 01:23:17
        Estado: Aprobada`),
      { type: 'purchase', amount: '300.00', currency: 'DOP', date: '2026-10-18', description: 'CAFETERIA EJEMPLO DO', last4: '1212' },
    ],
    [
      'Santa Cruz merchandise return',
      email('notificaciones@bsc.com.do', 'Notificación, Banco Santa Cruz', `
        NOTIFICACIÓN DE Retorno Mercancia
        Te notificamos que desde tu tarjeta de Crédito Platino terminada en 1212 fue realizada la siguiente transacción:
        Monto: USD 8.21
        Lugar de transacción: TIENDA ONLINE US
        Fecha y hora: 14/10/2026 10:56:57
        Estado: Aprobada`),
      { type: 'refund', amount: '8.21', currency: 'USD', date: '2026-10-14', description: 'TIENDA ONLINE US', last4: '1212' },
    ],
    [
      'Santa Cruz notification of an unknown kind',
      email('notificaciones@bsc.com.do', 'Notificación, Banco Santa Cruz', `
        NOTIFICACIÓN DE cambio de PIN
        Monto: RD$ 0.01
        Fecha y hora: 14/10/2026 10:56:57
        Estado: Aprobada`),
      null,
    ],
    [
      'Scotiabank card purchase (date from the email)',
      email('alerts@scotiabank.com', 'Credit Card used', `
        There was an authorization for $40.00 DOP at FARMACIA-123 on your Scotiabank Credit Card ***1313 at 04:31 pm AST .`, '2026-06-19T02:00:00.000Z'),
      { bank: 'scotiabank', type: 'purchase', amount: '40.00', currency: 'DOP', date: '2026-06-18', description: 'FARMACIA-123', last4: '1313' },
    ],
    [
      'Scotiabank card payment',
      email('alerts@scotiabank.com', 'Payment received', `We received a payment to your Scotiabank Credit Card ***1313 for $5,000.00 DOP at 11:07 pm AST .`),
      { type: 'card_payment', amount: '5000.00', currency: 'DOP', last4: '1313' },
    ],
    [
      'Scotiabank instant payment received',
      email('alertas@scotiabank.com', 'Pago al Instante recibido', `Ha recibido un crédito a su cuenta ***1414 por un Pago al Instante realizado desde Banco Ejemplo por valor de $2,500.00 DOP.`),
      { type: 'transfer_in', amount: '2500.00', currency: 'DOP', description: 'Pago al Instante desde Banco Ejemplo', last4: '1414' },
    ],
    [
      'Scotiabank transfer without currency',
      email('alerts@scotiabank.com', 'Transfer to a recipient', `A transfer was made for $1,011.08 from account ***1414 at 02:36 pm AST.`),
      { type: 'transfer_out', amount: '1011.08', currency: null, last4: '1414' },
    ],
    [
      'Wise money received',
      email('noreply@wise.com', 'Money received from ACME LLC', `
        Hello Juan,
        You received 1,500 USD from ACME LLC.
        Payment details
        Reference:
        Invoice 7
        Transfer Number:
        #123`),
      { bank: 'wise', type: 'transfer_in', amount: '1500.00', currency: 'USD', description: 'ACME LLC - Invoice 7', last4: null },
    ],
    [
      'Wise withdrawal in another currency',
      email('noreply@wise.com', 'You withdrew money at Cajero Roma', `You withdrew 40 EUR at Cajero Roma. And you used 46.83 USD from your account.`),
      { type: 'withdrawal', amount: '46.83', currency: 'USD', description: 'Retiro 40 EUR en Cajero Roma' },
    ],
    [
      'Wise transfer sent to yourself',
      email('noreply@wise.com', "Your money's been sent (#42)", `4,000.50 USD is on its way to you.`),
      { type: 'transfer_out', amount: '4000.50', currency: 'USD', description: 'Envío Wise #42' },
    ],
    ['Other sender', email('news@tienda.com', 'Oferta', 'Monto: RD$ 100.00 Fecha: 01/01/2026'), null],
    ['Bank promotion', email('notificaciones@bsc.com.do', 'Nuevas tarjetas', 'Conoce nuestras tarjetas'), null],
  ])('%s', (_name, input, expected) => {
    const parsed = parseBankEmail(input);
    if (expected === null) expect(parsed).toBeNull();
    else expect(parsed).toMatchObject(expected);
  });
});

describe('email text', () => {
  it('turns table layouts into lines and cells, decoding double-escaped entities', () => {
    const html = `<html><head><style>p{}</style></head><body><span style="display:none">&#847; &zwnj;</span>
      <p>Descripci&amp;oacute;n:</p><table><tr><td>RD$1.00</td><td>Peso</td></tr></table></body></html>`;
    expect(htmlToText(html)).toBe('Descripción:\nRD$1.00 | Peso');
  });

  it('reads dates written in numbers or words', () => {
    expect(parseDate('03 de Octubre 2026 - 09:23 AM')).toBe('2026-10-03');
    expect(parseDate('9 de octubre de 2026')).toBe('2026-10-09');
    expect(parseDate('17/8/2026')).toBe('2026-08-17');
  });

  it('reads a MIME message', async () => {
    const raw = [
      'From: Alertas <alertas@bhd.com.do>',
      'Subject: =?UTF-8?Q?Transacci=C3=B3n?=',
      'Date: Fri, 02 Oct 2026 16:27:14 +0000',
      'Message-ID: <abc@bhd>',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<p>Monto:</p><p>RD$ 7,000.00</p>',
    ].join('\r\n');
    const parsed = await readEmail(raw);
    expect(parsed).toMatchObject({ messageId: '<abc@bhd>', from: 'alertas@bhd.com.do', subject: 'Transacción', text: 'Monto:\nRD$ 7,000.00' });
  });
});
