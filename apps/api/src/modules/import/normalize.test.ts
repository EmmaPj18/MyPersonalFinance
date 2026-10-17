import { describe, expect, it } from 'vitest';
import { normalizeRows, parseAmount, parseDate, suggestMapping } from './normalize';

describe('import normalization', () => {
  it('parses amounts in the formats banks use', () => {
    expect(parseAmount('1,234.56')?.toFixed(2)).toBe('1234.56');
    expect(parseAmount('1.234,56')?.toFixed(2)).toBe('1234.56');
    expect(parseAmount('RD$ 2,500')?.toFixed(2)).toBe('2500.00');
    expect(parseAmount('45,5')?.toFixed(2)).toBe('45.50');
    expect(parseAmount('(45.00)')?.toFixed(2)).toBe('-45.00');
    expect(parseAmount('-1.000.000')?.toFixed(2)).toBe('-1000000.00');
    expect(parseAmount('abc')).toBeNull();
  });

  it('parses dates (day first by default)', () => {
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('2026-10-05T14:30:00')).toBe('2026-10-05');
    expect(parseDate('05/10/2026')).toBe('2026-10-05');
    expect(parseDate('5-10-26')).toBe('2026-10-05');
    expect(parseDate('10/25/2026')).toBe('2026-10-25');
    expect(parseDate('10/05/2026', 'mdy')).toBe('2026-10-05');
    expect(parseDate('46300')).toBe('2026-10-05');
    expect(parseDate('31/02/2026')).toBeNull();
  });

  it('suggests the column mapping from headers', () => {
    expect(suggestMapping(['Fecha Transacción', 'Descripción', 'Débito', 'Crédito', 'Balance'])).toEqual({
      date: 'Fecha Transacción',
      description: 'Descripción',
      debit: 'Débito',
      credit: 'Crédito',
    });
    expect(suggestMapping(['Fecha', 'Descripción', 'Monto', 'Moneda', 'Categoría', 'Tipo', 'De', 'Cuenta'])).toMatchObject({
      amount: 'Monto',
      currency: 'Moneda',
      category: 'Categoría',
      type: 'Tipo',
      owner: 'De',
      account: 'Cuenta',
    });
  });

  it('normalizes rows with debit/credit columns or a signed amount', () => {
    const split = normalizeRows(
      [
        { F: '01/10/2026', D: 'SUPERMERCADO NACIONAL', Deb: '1,500.00', Cred: '' },
        { F: '02/10/2026', D: 'NOMINA', Deb: '', Cred: '50,000.00' },
        { F: 'x', D: 'mala', Deb: '1', Cred: '' },
        { F: '', D: '', Deb: '', Cred: '' },
      ],
      { columns: { date: 'F', description: 'D', debit: 'Deb', credit: 'Cred' }, amountSign: 'negative-is-debit', dateFormat: 'auto' },
      'DOP',
    );
    expect(split.items.map((i) => [i.date, i.amount, i.direction])).toEqual([
      ['2026-10-01', '1500.00', 'debit'],
      ['2026-10-02', '50000.00', 'credit'],
    ]);
    expect(split.errors).toEqual([{ row: 3, message: 'Fecha no reconocida: "x"' }]);

    const signed = normalizeRows(
      [
        { Fecha: '2026-10-03', Monto: '-25.99', Moneda: 'USD' },
        { Fecha: '2026-10-04', Monto: '100', Moneda: '' },
      ],
      { columns: { date: 'Fecha', amount: 'Monto', currency: 'Moneda' }, amountSign: 'negative-is-debit', dateFormat: 'auto' },
      'DOP',
    );
    expect(signed.items.map((i) => [i.amount, i.direction, i.currency])).toEqual([
      ['25.99', 'debit', 'USD'],
      ['100.00', 'credit', 'DOP'],
    ]);
  });

  it('uses the Tipo column of our template', () => {
    const { items } = normalizeRows(
      [{ Fecha: '05/10/2026', Descripción: 'Colmado', Monto: '350', Tipo: 'Gasto', Categoría: 'Supermercado', De: 'Hogar' }],
      { columns: { date: 'Fecha', description: 'Descripción', amount: 'Monto', type: 'Tipo', category: 'Categoría', owner: 'De' }, amountSign: 'negative-is-debit', dateFormat: 'auto' },
      'DOP',
    );
    expect(items[0]).toMatchObject({ direction: 'debit', amount: '350.00', category: 'Supermercado', owner: 'Hogar' });
  });
});
