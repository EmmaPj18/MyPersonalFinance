import type { Currency, FxSource } from '@mypersonalfinance/shared';
import * as cheerio from 'cheerio';
import ExcelJS from 'exceljs';

/** A quote from a public source: 1 unit of `fromCurrency` = `mid` (buy/sell when known) of `toCurrency`. */
export interface MarketQuote {
  source: FxSource;
  entity: string;
  date: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  buy: string | null;
  sell: string | null;
  mid: string;
}

export type Fetcher = typeof fetch;

const USER_AGENT = 'MyPersonalFinance/1.0 (presupuesto personal; tasas de referencia)';
const get = async (fetcher: Fetcher, url: string) => {
  const res = await fetcher(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
};

const mid = (buy: number | null, sell: number | null) => {
  const values = [buy, sell].filter((v): v is number => v !== null && v > 0);
  return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(6) : null;
};

// ---------------------------------------------------------------- Banco Central (official USD/DOP)

export const BCRD_USD_URL =
  'https://cdn.bancentral.gov.do/documents/estadisticas/mercado-cambiario/documents/TASA_DOLAR_REFERENCIA_MC.xlsx';
const SPANISH_MONTHS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

/** Parses the BCRD "Diaria" sheet: Año | Mes | Día | Compra | Venta (reference spot rate). */
export const parseBcrdWorkbook = async (data: ArrayBuffer, since = '0000-00-00'): Promise<MarketQuote[]> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const sheet = wb.getWorksheet('Diaria') ?? wb.worksheets[0];
  if (!sheet) throw new Error('BCRD: hoja no encontrada');
  const quotes: MarketQuote[] = [];
  sheet.eachRow((row) => {
    const [, year, monthName, day, buy, sell] = row.values as unknown[];
    const month = SPANISH_MONTHS[String(monthName ?? '').trim().toLowerCase().replace('.', '').slice(0, 3)];
    if (typeof year !== 'number' || !month || typeof day !== 'number') return;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date < since) return;
    const b = typeof buy === 'number' ? buy : null;
    const s = typeof sell === 'number' ? sell : null;
    const m = mid(b, s);
    if (!m) return;
    quotes.push({ source: 'bcrd', entity: '', date, fromCurrency: 'USD', toCurrency: 'DOP', buy: b?.toString() ?? null, sell: s?.toString() ?? null, mid: m });
  });
  return quotes;
};

export const fetchBcrd = async (fetcher: Fetcher, since: string) =>
  parseBcrdWorkbook(await (await get(fetcher, BCRD_USD_URL)).arrayBuffer(), since);

// ---------------------------------------------------------------- European Central Bank (EUR/USD)

/** EUR→USD daily reference rates from the ECB, via the Frankfurter API (no key needed). */
export const fetchEcb = async (fetcher: Fetcher, since: string, until: string): Promise<MarketQuote[]> => {
  const res = await get(fetcher, `https://api.frankfurter.dev/v1/${since}..${until}?base=EUR&symbols=USD`);
  const body = (await res.json()) as { rates?: Record<string, { USD?: number }> };
  return Object.entries(body.rates ?? {})
    .filter(([, r]) => r.USD)
    .map(([date, r]) => ({ source: 'ecb', entity: '', date, fromCurrency: 'EUR', toCurrency: 'USD', buy: null, sell: null, mid: String(r.USD) }));
};

// ---------------------------------------------------------------- open.er-api.com (fallback)

/** Today's mid-market USD→DOP and USD→EUR, used only when the official sources fail. */
export const fetchErApi = async (fetcher: Fetcher, today: string): Promise<MarketQuote[]> => {
  const res = await get(fetcher, 'https://open.er-api.com/v6/latest/USD');
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (body.result !== 'success' || !body.rates) throw new Error('er-api: respuesta inválida');
  const quotes: MarketQuote[] = [];
  for (const to of ['DOP', 'EUR'] as const) {
    const rate = body.rates[to];
    if (rate) quotes.push({ source: 'erapi', entity: '', date: today, fromCurrency: 'USD', toCurrency: to, buy: null, sell: null, mid: String(rate) });
  }
  return quotes;
};

// ---------------------------------------------------------------- Infodolar (rates per bank / exchange house)

export const INFODOLAR_PAGES: { url: string; currency: Currency }[] = [
  { url: 'https://www.infodolar.com.do/', currency: 'USD' },
  { url: 'https://www.infodolar.com.do/precio-euro.aspx', currency: 'EUR' },
];
export const INFODOLAR_AVERAGE = 'Promedio InfoDolar';

const parseAmount = (text: string) => {
  const n = Number(text.replace(/RD\$|\$|,/g, '').trim().split(/\s/)[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Parses an Infodolar page (no API available): every `table.cotizaciones` row has the entity
 * name, buy and sell. The page has no stable contract, so anything unexpected is skipped.
 */
export const parseInfodolar = (html: string, currency: Currency, date: string): MarketQuote[] => {
  const $ = cheerio.load(html);
  const quotes = new Map<string, MarketQuote>();
  $('table.cotizaciones tr').each((_, tr) => {
    const name = $(tr).find('.nombre').first().text().trim();
    const prices = $(tr).find('td.colCompraVenta');
    if (!name || prices.length < 2) return;
    const buy = parseAmount($(prices[0]).clone().children().remove().end().text());
    const sell = parseAmount($(prices[1]).clone().children().remove().end().text());
    const m = mid(buy, sell);
    if (!m || quotes.has(name)) return;
    quotes.set(name, {
      source: 'infodolar',
      entity: name,
      date,
      fromCurrency: currency,
      toCurrency: 'DOP',
      buy: buy?.toString() ?? null,
      sell: sell?.toString() ?? null,
      mid: m,
    });
  });
  return [...quotes.values()];
};

export const fetchInfodolar = async (fetcher: Fetcher, today: string) => {
  const quotes: MarketQuote[] = [];
  for (const page of INFODOLAR_PAGES) {
    quotes.push(...parseInfodolar(await (await get(fetcher, page.url)).text(), page.currency, today));
  }
  return quotes;
};
