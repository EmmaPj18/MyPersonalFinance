import { z } from 'zod';
import { CURRENCIES, SCOPES } from '../constants';

export const uuidSchema = z.uuid();
export const currencySchema = z.enum(CURRENCIES);
export const scopeSchema = z.enum(SCOPES);

/** Positive money amount as string or number, normalized to a "1234.56" string. */
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Monto inválido (máx. 2 decimales)'));

/** Percentage 0-100 with up to 2 decimals. */
export const pctSchema = z.coerce.number().min(0).max(100);

/** ISO date "YYYY-MM-DD". */
export const isoDateSchema = z.iso.date();

/** Month as "YYYY-MM". */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido (YYYY-MM)');

export const splitInputSchema = z.object({
  userId: uuidSchema,
  sharePct: pctSchema,
});
export type SplitInput = z.infer<typeof splitInputSchema>;

export const idParamsSchema = z.object({ id: uuidSchema });
