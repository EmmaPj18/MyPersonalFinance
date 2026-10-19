import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** Key for stored credentials, derived from the session secret (no extra configuration). */
const keyFrom = (secret: string) => Buffer.from(hkdfSync('sha256', secret, 'mypersonalfinance', 'stored-credentials', 32));

/** AES-256-GCM; the result is "iv.tag.ciphertext" in base64url. */
export const encryptSecret = (plain: string, secret: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
};

export const decryptSecret = (stored: string, secret: string) => {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Credencial inválida');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
};
