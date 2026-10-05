import type { DeductionCategory, ExpenseNature } from '@mypersonalfinance/shared';
import type { DbOrTx } from '../../db/client';
import { categories, deductionTypes } from '../../db/schema';

export const DEFAULT_CATEGORIES: { name: string; nature: ExpenseNature; color: string; icon: string }[] = [
  { name: 'Vivienda', nature: 'fixed', color: '#6366f1', icon: 'home' },
  { name: 'Servicios', nature: 'fixed', color: '#0ea5e9', icon: 'zap' },
  { name: 'Supermercado', nature: 'variable', color: '#22c55e', icon: 'shopping-cart' },
  { name: 'Restaurantes', nature: 'variable', color: '#f97316', icon: 'utensils' },
  { name: 'Transporte', nature: 'variable', color: '#eab308', icon: 'car' },
  { name: 'Salud', nature: 'variable', color: '#ef4444', icon: 'heart-pulse' },
  { name: 'Educación', nature: 'fixed', color: '#8b5cf6', icon: 'graduation-cap' },
  { name: 'Seguros', nature: 'fixed', color: '#14b8a6', icon: 'shield' },
  { name: 'Suscripciones', nature: 'fixed', color: '#ec4899', icon: 'repeat' },
  { name: 'Préstamos', nature: 'fixed', color: '#64748b', icon: 'landmark' },
  { name: 'Entretenimiento', nature: 'variable', color: '#a855f7', icon: 'film' },
  { name: 'Ropa', nature: 'variable', color: '#f43f5e', icon: 'shirt' },
  { name: 'Cuidado personal', nature: 'variable', color: '#d946ef', icon: 'sparkles' },
  { name: 'Mascotas', nature: 'variable', color: '#84cc16', icon: 'paw-print' },
  { name: 'Regalos', nature: 'variable', color: '#fb7185', icon: 'gift' },
  { name: 'Viajes', nature: 'variable', color: '#06b6d4', icon: 'plane' },
  { name: 'Otros', nature: 'variable', color: '#94a3b8', icon: 'circle' },
];

export const DEFAULT_DEDUCTION_TYPES: { name: string; category: DeductionCategory }[] = [
  { name: 'ISR', category: 'income_tax' },
  { name: 'AFP', category: 'pension' },
  { name: 'SFS', category: 'health' },
  { name: 'Seguro complementario', category: 'health' },
  { name: 'Préstamo / Cooperativa', category: 'loan' },
  { name: 'Otro descuento', category: 'other' },
];

export const seedHouseholdDefaults = async (db: DbOrTx, householdId: string) => {
  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((c) => ({
      householdId,
      name: c.name,
      defaultNature: c.nature,
      color: c.color,
      icon: c.icon,
    })),
  );
  await db.insert(deductionTypes).values(DEFAULT_DEDUCTION_TYPES.map((d) => ({ householdId, ...d })));
};
