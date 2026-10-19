import type { Currency } from '@mypersonalfinance/shared';
import { field, last4, localDate, parseAmount, parseCurrency, parseDate, type EmailContent } from './text';

export const BANKS = {
  popular: { name: 'Banco Popular', domains: ['popularenlinea.com', 'bpd.com.do'] },
  bhd: { name: 'Banco BHD', domains: ['bhd.com.do', 'bhdleon.com.do'] },
  banreservas: { name: 'Banreservas', domains: ['banreservas.com', 'banreservas.com.do'] },
  scotiabank: { name: 'Scotiabank', domains: ['scotiabank.com', 'scotiabank.com.do'] },
  santacruz: { name: 'Banco Santa Cruz', domains: ['bsc.com.do'] },
  wise: { name: 'Wise', domains: ['wise.com'] },
} as const;
export type BankId = keyof typeof BANKS;

/** Sender domains to look for in the mailbox. */
export const BANK_DOMAINS = Object.values(BANKS).flatMap((b) => b.domains);

export type EmailTxType =
  /** Card purchase. */
  | 'purchase'
  /** Cash withdrawal (ATM). */
  | 'withdrawal'
  /** Money sent from one of our products. */
  | 'transfer_out'
  /** Money received in one of our products. */
  | 'transfer_in'
  /** Payment received on a credit card. */
  | 'card_payment'
  /** Salary deposit. */
  | 'payroll'
  /** Money returned for a purchase (merchandise return, reversal). */
  | 'refund';

export interface ParsedBankEmail {
  bank: BankId;
  type: EmailTxType;
  amount: string;
  /** Null when the email doesn't say (the account's currency is used). */
  currency: Currency | null;
  date: string;
  description: string;
  /** Last digits of our card/account involved. */
  last4: string | null;
  /** Last digits of the other product, when it may be ours too (transfers). */
  counterpartLast4?: string | null;
  /** Who receives / sends the money: when it's a member, it's a transfer between our accounts. */
  counterpartName?: string | null;
  /** The email itself says the money goes to / comes from the same person (Wise "to you", top-ups). */
  ownTransfer?: boolean;
  /** Bank fees and taxes charged on top of the amount. */
  fees?: string | null;
}

type Parser = (email: EmailContent) => ParsedBankEmail | null;

const flat = (text: string) => text.replace(/\s*\n\s*/g, ' ');
const approved = (status: string | undefined) => !status || /aprobad|approved/i.test(status);
/** Words banks use for money returned to a card. */
const REFUND = /retorno|devoluci|reverso|reversi|reembolso|refund|nota de cr[eé]dito/i;
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/\s*\|\s*/g, ' ').trim();

const popular: Parser = ({ subject, text }) => {
  const f = flat(text);
  // Consumption / withdrawal: "Monto | Moneda | Fecha | Comercio | Estatus" table.
  const row = f.match(/([A-Z$]*\$?\s?[\d,]+\.\d{2})\s*\|\s*([^|]+?)\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\|\s*([^|]+?)\s*\|\s*([^|\s]+)/);
  if (row && /consumo|retiro|devoluci|reverso/i.test(subject)) {
    if (!approved(row[5])) return null;
    const withdrawal = /retiro/i.test(subject) || /cajero/i.test(f);
    return {
      bank: 'popular',
      type: REFUND.test(subject) ? 'refund' : withdrawal ? 'withdrawal' : 'purchase',
      amount: parseAmount(row[1]!)!,
      currency: parseCurrency(row[2]) ?? parseCurrency(row[1]),
      date: parseDate(row[3]!)!,
      description: withdrawal ? `Retiro ${clean(row[4])}` : clean(row[4]),
      last4: f.match(/terminada en (\d{4})/i)?.[1] ?? null,
    };
  }
  // Instant payment sent.
  if (/enviada/i.test(subject) || /fue enviada/i.test(f)) {
    const amount = field(text, /Monto/i);
    const date = field(text, /Fecha/i);
    if (!amount || !date) return null;
    const beneficiary = clean(field(text, /Beneficiario/i));
    return {
      bank: 'popular',
      type: 'transfer_out',
      amount: parseAmount(amount)!,
      currency: parseCurrency(amount) ?? 'DOP',
      date: parseDate(date)!,
      description: beneficiary ? `Pago al instante a ${beneficiary}` : 'Pago al instante',
      last4: null,
      counterpartLast4: last4(field(text, /Cuenta o Producto/i)),
      counterpartName: beneficiary || null,
    };
  }
  // Transfer received: "RD 2,360.00 | 15/8/2026 | APP POPULAR".
  const received = f.match(/(R?D?\$?\s?[A-Z]{0,3}\$?\s?[\d,]+\.\d{2})\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\|?\s*([^|]*?)\s*(?:\||Si necesita|$)/);
  if (received && /recibida/i.test(subject + f)) {
    return {
      bank: 'popular',
      type: 'transfer_in',
      amount: parseAmount(received[1]!)!,
      currency: parseCurrency(received[1]) ?? 'DOP',
      date: parseDate(received[2]!)!,
      description: `Transferencia recibida${received[3] ? ` (${clean(received[3])})` : ''}`,
      last4: f.match(/terminada en (\d{4})/i)?.[1] ?? null,
    };
  }
  return null;
};

const bhd: Parser = ({ text }) => {
  const f = flat(text);
  // Card transaction table: Fecha Moneda Monto Comercio Estado Tipo.
  const card = f.match(
    /Tipo\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*[ap]\.?\s?m\.?)?\s+([A-Z]{2,3})\s+\$?\s?([\d,]+\.\d{2})\s+(.+?)\s+(Aprobada|Declinada|Rechazada|Reversada)\s+(\S+)/i,
  );
  if (card) {
    if (!approved(card[5])) return null;
    const kind = card[6]!.toLowerCase();
    const withdrawal = /retiro|avance/.test(kind);
    return {
      bank: 'bhd',
      type: REFUND.test(kind) ? 'refund' : withdrawal ? 'withdrawal' : 'purchase',
      amount: parseAmount(card[3]!)!,
      currency: parseCurrency(card[2]),
      date: parseDate(card[1]!)!,
      description: withdrawal ? `Retiro ${clean(card[4])}` : clean(card[4]),
      last4: f.match(/#\s?(\d{4})/)?.[1] ?? null,
    };
  }
  // Transfers: origin/destination products.
  const amount = field(text, /Monto/i);
  const origin = field(text, /Producto origen/i);
  if (amount && origin) {
    const description = clean(field(text, /Descripci[oó]n/i));
    const beneficiary = clean(field(text, /Beneficiario/i));
    const date = field(text, /Fecha y hora de la transacci[oó]n/i) ?? '';
    return {
      bank: 'bhd',
      type: 'transfer_out',
      amount: parseAmount(amount)!,
      currency: parseCurrency(amount) ?? 'DOP',
      date: parseDate(date)!,
      description: description && !/^(Monto|Beneficiario)/i.test(description) ? description : `Transferencia a ${beneficiary || 'otro producto'}`,
      last4: last4(origin),
      counterpartLast4: last4(field(text, /Producto destino/i)),
      counterpartName: beneficiary || null,
    };
  }
  return null;
};

const banreservas: Parser = ({ text }) => {
  const amount = field(text, /Monto/i);
  if (!amount) return null;
  const date = parseDate(field(text, /Fecha de transacci[oó]n/i) ?? '');
  if (!date) return null;
  // Payroll deposit.
  if (/n[oó]mina/i.test(text)) {
    return {
      bank: 'banreservas',
      type: 'payroll',
      amount: parseAmount(amount)!,
      currency: parseCurrency(amount) ?? 'DOP',
      date,
      description: 'Pago de nómina',
      last4: last4(field(text, /Cuenta/i)),
    };
  }
  const origin = field(text, /Origen/i);
  if (!origin) return null;
  const destination = field(text, /Destino/i);
  const kind = clean(field(text, /Transacci[oó]n/i));
  // The line after the amount is the concept typed by the user ("#concept#" when empty).
  const lines = text.split('\n');
  const conceptLine = lines[lines.findIndex((l) => /^Monto\s*:?\s*$/i.test(l)) + 2]?.trim() ?? '';
  const concept = /^#|:$/.test(conceptLine) || /^Transacci/i.test(conceptLine) ? '' : conceptLine;
  const fees = [field(text, /Comisi[oó]n/i), field(text, /Impuestos/i)]
    .map((v) => (v && !v.startsWith('#') ? Number(parseAmount(v) ?? 0) : 0))
    .reduce((a, b) => a + b, 0);
  const to = clean(destination?.split(',')[0]);
  return {
    bank: 'banreservas',
    type: 'transfer_out',
    amount: parseAmount(amount)!,
    currency: parseCurrency(amount) ?? 'DOP',
    date,
    description: concept || `${kind || 'Transferencia'}${to ? ` a ${to}` : ''}`,
    last4: last4(origin),
    counterpartLast4: last4(destination),
    counterpartName: to || null,
    fees: fees > 0 ? fees.toFixed(2) : null,
  };
};

const santacruz: Parser = ({ text }) => {
  const amount = field(text, /Monto/i);
  const date = parseDate(field(text, /Fecha y hora/i) ?? '');
  if (!amount || !date) return null;
  if (/TRANSFERENCIA RECIBIDA/i.test(text)) {
    const sender = clean(field(text, /Remitente/i));
    const bank = clean(field(text, /Banco remitente/i));
    return {
      bank: 'santacruz',
      type: 'transfer_in',
      amount: parseAmount(amount)!,
      currency: parseCurrency(amount),
      date,
      description: `Transferencia de ${sender || 'tercero'}${bank ? ` (${bank})` : ''}`,
      last4: last4(field(text, /Terminal de cuenta/i)),
      counterpartName: sender || null,
    };
  }
  // "NOTIFICACIÓN DE consumo", "… DE retiro", "… DE Retorno Mercancia".
  const kind = text.match(/NOTIFICACI[OÓ]N DE ([^\n]+)/i)?.[1]?.trim().toLowerCase();
  if (!kind || !approved(field(text, /Estado/i) ?? undefined)) return null;
  const place = clean(field(text, /Lugar de transacci[oó]n/i));
  const withdrawal = kind.startsWith('retiro');
  const type = REFUND.test(kind) ? 'refund' : withdrawal ? 'withdrawal' : /consumo|compra/.test(kind) ? 'purchase' : null;
  // A kind we don't know isn't guessed as a purchase.
  if (!type) return null;
  return {
    bank: 'santacruz',
    type,
    amount: parseAmount(amount)!,
    currency: parseCurrency(amount),
    date,
    description: withdrawal ? `Retiro ${place}` : place,
    last4: text.match(/terminada en (\d{4})/i)?.[1] ?? null,
  };
};

const scotiabank: Parser = ({ text, receivedAt }) => {
  const f = flat(text);
  const date = localDate(receivedAt);
  const money = (s: string) => ({ amount: parseAmount(s)!, currency: parseCurrency(s) });
  let m = f.match(/authorization for (\$?[\d,]+\.\d{2}\s*[A-Z]{3})\s+at\s+(.+?)\s+on your .*?\*{2,}(\d{4})/i)
    ?? f.match(/autorizaci[oó]n (?:por|de) (\$?[\d,]+\.\d{2}\s*[A-Z]{3})\s+en\s+(.+?)\s+(?:con|en) su .*?\*{2,}(\d{4})/i);
  if (m) return { bank: 'scotiabank', type: 'purchase', ...money(m[1]!), date, description: clean(m[2]), last4: m[3]! };
  m = f.match(/(?:refund|credit) (?:for|of) (\$?[\d,]+\.\d{2}\s*[A-Z]{3})\s+(?:from|at)\s+(.+?)\s+(?:on|to) your .*?\*{2,}(\d{4})/i);
  if (m) return { bank: 'scotiabank', type: 'refund', ...money(m[1]!), date, description: clean(m[2]), last4: m[3]! };
  m = f.match(/payment to your .*?\*{2,}(\d{4}) for (\$?[\d,]+\.\d{2}\s*[A-Z]{0,3})/i) ?? f.match(/pago a su .*?\*{2,}(\d{4}) por (\$?[\d,]+\.\d{2}\s*[A-Z]{0,3})/i);
  if (m) return { bank: 'scotiabank', type: 'card_payment', ...money(m[2]!), date, description: 'Pago a tarjeta de crédito', last4: m[1]! };
  m = f.match(/cr[eé]dito a su cuenta \*{2,}(\d{4}) por (?:un )?(.+?) realizado desde (.+?) por valor de (\$?[\d,]+\.\d{2}\s*[A-Z]{0,3})/i);
  if (m) return { bank: 'scotiabank', type: 'transfer_in', ...money(m[4]!), date, description: `${clean(m[2])} desde ${clean(m[3])}`, last4: m[1]! };
  m = f.match(/transfer was made for (\$?[\d,]+\.\d{2}\s*[A-Z]{0,3}) from account \*{2,}(\d{4})/i)
    ?? f.match(/transferencia (?:por|de) (\$?[\d,]+\.\d{2}\s*[A-Z]{0,3}) desde (?:la )?cuenta \*{2,}(\d{4})/i);
  if (m) return { bank: 'scotiabank', type: 'transfer_out', ...money(m[1]!), date, description: 'Transferencia a tercero', last4: m[2]! };
  return null;
};

const wise: Parser = ({ text, subject, receivedAt }) => {
  const f = flat(text);
  const date = localDate(receivedAt);
  const amountCur = /([\d,]+(?:\.\d{1,2})?)\s+([A-Z]{3})/;
  let m = f.match(new RegExp(`You received ${amountCur.source} from (.+?)\\.`, 'i'));
  if (m) {
    const reference = clean(f.match(/Reference:\s*(.+?)\s+Transfer Number/i)?.[1]);
    return {
      bank: 'wise',
      type: 'transfer_in',
      amount: parseAmount(m[1]!)!,
      currency: parseCurrency(m[2]),
      date,
      description: `${clean(m[3])}${reference ? ` - ${reference}` : ''}`,
      last4: null,
      counterpartName: clean(m[3]),
    };
  }
  m = f.match(new RegExp(`You added ${amountCur.source}`, 'i'));
  if (m) return { bank: 'wise', type: 'transfer_in', amount: parseAmount(m[1]!)!, currency: parseCurrency(m[2]), date, description: 'Recarga de saldo Wise', last4: null, ownTransfer: true };
  m = f.match(new RegExp(`You withdrew ${amountCur.source} at (.+?)\\.(?:.*?you used ${amountCur.source})?`, 'i'));
  if (m) {
    // The account is charged in its own currency when it differs from the cash's.
    const [amount, currency] = m[4] ? [m[4], m[5]] : [m[1], m[2]];
    return {
      bank: 'wise',
      type: 'withdrawal',
      amount: parseAmount(amount!)!,
      currency: parseCurrency(currency),
      date,
      description: `Retiro ${m[1]} ${m[2]} en ${clean(m[3])}`,
      last4: null,
    };
  }
  m = f.match(new RegExp(`You (?:spent|paid) ${amountCur.source} (?:at|to) (.+?)\\.(?:.*?you used ${amountCur.source})?`, 'i'));
  if (m) {
    const [amount, currency] = m[4] ? [m[4], m[5]] : [m[1], m[2]];
    return { bank: 'wise', type: 'purchase', amount: parseAmount(amount!)!, currency: parseCurrency(currency), date, description: clean(m[3]), last4: null };
  }
  m = f.match(new RegExp(`${amountCur.source} is on its way to (.+?)\\.`, 'i'));
  if (m) {
    const to = clean(m[3]);
    const number = subject.match(/#(\d+)/)?.[1];
    return {
      bank: 'wise',
      type: 'transfer_out',
      amount: parseAmount(m[1]!)!,
      currency: parseCurrency(m[2]),
      date,
      description: `Envío Wise${/^you$/i.test(to) ? '' : ` a ${to}`}${number ? ` #${number}` : ''}`,
      last4: null,
      ownTransfer: /^you$/i.test(to),
      counterpartName: /^you$/i.test(to) ? null : to,
    };
  }
  return null;
};

const PARSERS: Record<BankId, Parser> = { popular, bhd, banreservas, scotiabank, santacruz, wise };

export const bankOf = (from: string): BankId | null => {
  const domain = from.split('@').pop()?.toLowerCase() ?? '';
  return (Object.keys(BANKS) as BankId[]).find((id) => BANKS[id].domains.some((d) => domain === d || domain.endsWith(`.${d}`))) ?? null;
};

/**
 * Reads the transaction in a bank notification. Null for emails of other senders, of a kind we
 * don't recognize (promotions, statements…) or of declined transactions.
 */
export const parseBankEmail = (email: EmailContent): ParsedBankEmail | null => {
  const bank = bankOf(email.from);
  if (!bank) return null;
  const result = PARSERS[bank](email);
  return result?.amount && result.date ? result : null;
};
