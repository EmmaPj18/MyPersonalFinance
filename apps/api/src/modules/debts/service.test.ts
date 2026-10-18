import { describe, expect, it } from 'vitest';
import { splitInstallment } from './service';

describe('loan installments', () => {
  it('takes one month of interest on the balance and the rest as principal', () => {
    // 500,000 at 18% annual: 7,500 interest; 15,000 installment -> 7,500 principal.
    expect(splitInstallment('15000', '500000', '18')).toEqual({ interest: '7500.00', principal: '7500.00' });
    expect(splitInstallment('15000', '500000', null)).toEqual({ interest: '0.00', principal: '15000.00' });
    // Interest never exceeds the installment.
    expect(splitInstallment('100', '500000', '18')).toEqual({ interest: '100.00', principal: '0.00' });
  });
});
