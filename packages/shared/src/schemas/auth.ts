import { z } from 'zod';
import { PRIVACY_MODES, USER_ROLES } from '../constants';
import { currencySchema, pctSchema } from './common';

export const emailSchema = z
  .email('Email inválido')
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const passwordSchema = z.string().min(8, 'Mínimo 8 caracteres').max(200);
export const nameSchema = z.string().trim().min(1).max(120);

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  defaultCurrency: currencySchema.default('DOP'),
  householdName: z.string().trim().min(1).max(120).optional(),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateMeSchema = z.object({
  name: nameSchema.optional(),
  defaultCurrency: currencySchema.optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const userRoleSchema = z.enum(USER_ROLES);

export const updateHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseCurrency: currencySchema.optional(),
  privacyMode: z.enum(PRIVACY_MODES).optional(),
});
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;

export const updateMemberSchema = z.object({
  /** Only for members without an account (the others edit their own profile). */
  name: nameSchema.optional(),
  role: userRoleSchema.optional(),
  defaultSplitPct: pctSchema.nullable().optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** Member without an account: takes part in the household's shared finances only. */
export const createManagedMemberSchema = z.object({
  name: nameSchema,
  defaultSplitPct: pctSchema.nullable().optional(),
});

/** Invites someone to take over a managed member's account. */
export const claimInvitationSchema = z.object({ email: emailSchema });

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: userRoleSchema.default('member'),
});
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

/** Accepting an invitation: new users send their profile; existing users must be logged in. */
export const acceptInvitationSchema = z.object({
  name: nameSchema.optional(),
  password: passwordSchema.optional(),
  defaultCurrency: currencySchema.optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const transferOwnershipSchema = z.object({ userId: z.uuid() });
