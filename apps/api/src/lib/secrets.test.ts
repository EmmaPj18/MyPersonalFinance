import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secrets';

const secret = 'x'.repeat(40);

describe('stored secrets', () => {
  it('round-trips and never stores the plain text', () => {
    const stored = encryptSecret('abcd efgh ijkl mnop', secret);
    expect(stored).not.toContain('abcd');
    expect(encryptSecret('abcd efgh ijkl mnop', secret)).not.toBe(stored);
    expect(decryptSecret(stored, secret)).toBe('abcd efgh ijkl mnop');
  });

  it('fails with another key', () => {
    expect(() => decryptSecret(encryptSecret('pw', secret), 'y'.repeat(40))).toThrow();
  });
});
