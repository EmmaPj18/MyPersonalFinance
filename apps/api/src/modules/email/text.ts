import type { Currency } from '@mypersonalfinance/shared';
import { simpleParser } from 'mailparser';

/** What the bank parsers need from an email. */
export interface EmailContent {
  messageId: string;
  from: string;
  subject: string;
  /** Received at (ISO); some banks don't print the transaction date. */
  receivedAt: string;
  /** Body as text, one line per block, table cells joined with " | ". */
  text: string;
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", iexcl: '¡', iquest: '¿', ordm: 'º', ordf: 'ª', deg: '°',
  euro: '€', middot: '·', bull: '•', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', szlig: 'ß', zwnj: '', zwj: '', shy: '',
};
/** Accented letters: "oacute" -> "ó", "Ntilde" -> "Ñ". */
const MARKS: Record<string, string> = { acute: '́', grave: '̀', uml: '̈', circ: '̂', tilde: '̃', cedil: '̧' };
const accented = (name: string) => {
  const m = name.match(/^([a-zA-Z])(acute|grave|uml|circ|tilde|cedil)$/);
  return m ? (m[1]! + MARKS[m[2]!]).normalize('NFC') : undefined;
};

const decodeEntities = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? accented(e) ?? m;
  });

/** Bank emails are table layouts: keep blocks as lines and cells separated by " | ". */
export const htmlToText = (html: string) =>
  // Some banks escape their entities twice ("&amp;oacute;").
  decodeEntities(decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  ))
    // Invisible preheader padding (zero-width and combining characters).
    .replace(/[ ­͏​-‍⁠﻿]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/^[\s|]+|[\s|]+$/g, '').trim())
    .filter(Boolean)
    .join('\n');

/** Reads a raw .eml (MIME) message. */
export const readEmail = async (source: Buffer | string): Promise<EmailContent> => {
  const mail = await simpleParser(source);
  const from = mail.from?.value.map((a) => a.address ?? '').join(', ') ?? '';
  const html = typeof mail.html === 'string' ? mail.html : '';
  return {
    messageId: mail.messageId ?? `${from}|${mail.subject ?? ''}|${mail.date?.toISOString() ?? ''}`,
    from: from.toLowerCase(),
    subject: mail.subject ?? '',
    receivedAt: (mail.date ?? new Date()).toISOString(),
    text: html ? htmlToText(html) : (mail.text ?? ''),
  };
};

/** "RD$ 1,234.56", "$400.00", "4,800", "DOP$ 104,892.00" -> "1234.56" */
export const parseAmount = (raw: string): string | null => {
  const m = raw.match(/\d[\d,]*(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
};

/** Currency from a code, symbol or name; null when it can't be told. */
export const parseCurrency = (raw: string | undefined | null): Currency | null => {
  if (!raw) return null;
  const s = raw.toUpperCase();
  if (/US\$|USD|\bUS\b|D[OÓ]LAR/.test(s)) return 'USD';
  if (/EUR|€/.test(s)) return 'EUR';
  if (/RD\$?|DOP|\bRD\b|PESO/.test(s)) return 'DOP';
  return null;
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad = (n: number | string) => String(n).padStart(2, '0');

/** "07/02/2026", "17/8/2026 12:09", "03 de Octubre 2026", "9 de Octubre de 2026" -> ISO date (day first). */
export const parseDate = (raw: string): string | null => {
  const numeric = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (numeric) {
    const [, d, m, y] = numeric;
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${y}-${pad(m!)}-${pad(d!)}`;
  }
  const named = raw.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de\s+|del\s+)?(\d{4})/i);
  if (named) {
    const month = MONTHS.indexOf(named[2]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')) + 1;
    if (month) return `${named[3]}-${pad(month)}-${pad(named[1]!)}`;
  }
  return null;
};

/** Local date (Santo Domingo, UTC-4) of an instant, for emails without a printed date. */
export const localDate = (iso: string) => new Date(new Date(iso).getTime() - 4 * 3600_000).toISOString().slice(0, 10);

/** Value after "Label:" on the same line, or on the next line when the label stands alone. */
export const field = (text: string, label: RegExp): string | null => {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(new RegExp(`^${label.source}\\s*:?\\s*\\|?\\s*(.*)$`, label.flags.replace('g', '')));
    if (!m) continue;
    const value = m[1]!.replace(/^\|\s*/, '').trim();
    if (value) return value;
    const next = lines[i + 1]?.replace(/^\|\s*/, '').trim();
    return next || null;
  }
  return null;
};

/** Last 4 digits of a masked product ("***1234", "•••• 5678", "DO00...XXXX9012"). */
export const last4 = (raw: string | null | undefined) => raw?.match(/(\d{4})\D*$/)?.[1] ?? null;
