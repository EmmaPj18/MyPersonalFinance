import ExcelJS from 'exceljs';
import { gte } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { marketRates } from '../src/db/schema';
import { runFxSync } from '../src/jobs/fx';
import { FxResolver } from '../src/lib/fx';
import { parseBcrdWorkbook, parseInfodolar } from '../src/modules/fx-rates/providers';
import { registerUser, setupApp } from './helpers';

const ctx = setupApp();

// Market rates are global: everything here is dated 2099 and removed afterwards.
afterAll(async () => {
  await ctx.app.db.delete(marketRates).where(gte(marketRates.date, '2099-01-01'));
});

const bcrdWorkbook = async (rows: [number, string, number, number, number][]) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Diaria');
  ws.addRow(['Tasas de Cambio del dólar de Referencia del Mercado Spot']);
  ws.addRow([]);
  ws.addRow(['Año', 'Mes', 'Día', 'Compra', 'Venta']);
  for (const r of rows) ws.addRow(r);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
};

const infodolarHtml = (rows: [string, string, string][]) => `
  <table class="cotizaciones" id="DolarPromedio"><tr>
    <td class="colNombre"><span class="nombre">Promedio InfoDolar</span></td>
    <td class="colCompraVenta">$59.91 <span class="variacionCompraVenta">($0.02)</span></td>
    <td class="colCompraVenta">$61.83</td>
  </tr></table>
  <table class="cotizaciones" id="Dolar">
    ${rows
      .map(
        ([name, buy, sell]) => `<tr><td class="colNombre"><a href="#"><img alt="x"/></a><span class="nombre">${name}</span></td>
        <td class="colCompraVenta" data-order="${buy}">${buy}<span class="variacionCompraVenta"></span></td>
        <td class="colCompraVenta">${sell}<span class="variacionCompraVenta"></span></td></tr>`,
      )
      .join('')}
  </table>`;

describe('market rate providers', () => {
  it('parses the BCRD daily sheet', async () => {
    const quotes = await parseBcrdWorkbook(
      await bcrdWorkbook([
        [2026, 'Oct', 15, 61.2578, 61.7717],
        [2026, 'Oct', 16, 61.3649, 61.8322],
      ]),
      '2026-10-16',
    );
    expect(quotes).toEqual([
      { source: 'bcrd', entity: '', date: '2026-10-16', fromCurrency: 'USD', toCurrency: 'DOP', buy: '61.3649', sell: '61.8322', mid: '61.598550' },
    ]);
  });

  it('parses Infodolar entities and skips missing prices', () => {
    const quotes = parseInfodolar(
      infodolarHtml([
        ['Banreservas', '$60.10', '$61.90'],
        ['Asociación Romana', '$60.20', ''],
      ]),
      'USD',
      '2026-10-17',
    );
    expect(quotes.map((q) => [q.entity, q.buy, q.sell, q.mid])).toEqual([
      ['Promedio InfoDolar', '59.91', '61.83', '60.870000'],
      ['Banreservas', '60.1', '61.9', '61.000000'],
      ['Asociación Romana', '60.2', null, '60.200000'],
    ]);
  });
});

describe('exchange rate resolution', () => {
  it('syncs sources and applies the household preference', async () => {
    const workbook = await bcrdWorkbook([[2099, 'Ene', 5, 60, 62]]);
    const fakeFetch = (async (url: string) => {
      if (url.includes('bancentral')) return new Response(workbook);
      if (url.includes('frankfurter')) return Response.json({ rates: { '2099-01-05': { USD: 1.1 } } });
      if (url.includes('precio-euro')) return new Response(infodolarHtml([['Banreservas', '$66.00', '$70.00']]));
      if (url.includes('infodolar')) return new Response(infodolarHtml([['Banreservas', '$59.00', '$63.00']]));
      return new Response('', { status: 500 });
    }) as typeof fetch;

    const result = await runFxSync(ctx.app.db, fakeFetch, '2099-01-05');
    expect(result).toEqual({ saved: { bcrd: 1, ecb: 1, infodolar: 4 }, errors: [] });

    const me = await registerUser(ctx, 'Tasas');
    const hid = me.me.household.id;
    const rate = async (from: 'USD' | 'EUR', to: 'DOP' | 'USD') =>
      (await FxResolver.load(ctx.app.db, hid)).rate(from, to, '2099-01-10')?.toFixed(4);

    // Default: BCRD mid; EUR→DOP triangulated through ECB EUR→USD.
    expect(await rate('USD', 'DOP')).toBe('61.0000');
    expect(await rate('EUR', 'DOP')).toBe('67.1000');

    await me.ok('PATCH', '/household', { fxSide: 'sell' });
    expect(await rate('USD', 'DOP')).toBe('62.0000');

    expect((await me.patch('/household', { fxSource: 'infodolar' })).status).toBe(400);
    await me.ok('PATCH', '/household', { fxSource: 'infodolar', fxEntity: 'Banreservas' });
    expect(await rate('USD', 'DOP')).toBe('63.0000');
    // Infodolar quotes EUR directly in DOP.
    expect(await rate('EUR', 'DOP')).toBe('70.0000');

    // A manual rate wins on its date.
    await me.ok('PUT', '/fx-rates', { date: '2099-01-05', fromCurrency: 'USD', toCurrency: 'DOP', rate: 64.5 });
    expect(await rate('USD', 'DOP')).toBe('64.5000');
  });

  it('reports source failures without stopping the others', async () => {
    const failing = (async (url: string) =>
      url.includes('frankfurter') ? Response.json({ rates: {} }) : new Response('', { status: 503 })) as typeof fetch;
    const result = await runFxSync(ctx.app.db, failing, '2099-01-06');
    expect(result.saved.ecb).toBe(0);
    expect(result.errors.some((e: string) => e.startsWith('bcrd:'))).toBe(true);
    expect(result.errors.some((e: string) => e.startsWith('infodolar:'))).toBe(true);
  });
});
