import { describe, expect, it } from 'vitest';
import { parseDecimalInput, unitPriceFromTotal } from './input';
import { d, expectDec } from './test-utils';

const value = (text: string) => {
  const r = parseDecimalInput(text);
  if (!r.ok) throw new Error(`expected a number for ${JSON.stringify(text)}, got ${r.problem}`);
  return r.value;
};
const problem = (text: string) => {
  const r = parseDecimalInput(text);
  return r.ok ? null : r.problem;
};

describe('parseDecimalInput', () => {
  it('reads one comma or one dot as the decimal point', () => {
    expectDec(value('1,5'), '1.5');
    expectDec(value('1.5'), '1.5');
    expectDec(value('1,234'), '1.234'); // one separator is always the decimal point
    expectDec(value(' 7 '), '7');
    expectDec(value('.5'), '0.5');
    expectDec(value(',5'), '0.5');
    expectDec(value('5.'), '5'); // while typing
    expectDec(value('0007'), '7');
  });

  it('parses a leading minus so the form can say "more than 0"; -0 is 0', () => {
    expectDec(value('-1'), '-1');
    expectDec(value('-.5'), '-0.5');
    expect(value('-0').isNegative()).toBe(false);
  });

  it('refuses thousands separators instead of guessing', () => {
    expect(problem('1.234,5')).toBe('separators');
    expect(problem('1,234.5')).toBe('separators');
    expect(problem('1.234.567')).toBe('separators');
    expect(problem('1 234')).toBe('not_a_number');
  });

  it('refuses exponents, signs, hex, letters and empty text', () => {
    for (const t of ['1e3', '1E3', '+1', '0x10', 'abc', '1€', '--1', '-', '.', '∞', 'NaN']) {
      expect(problem(t), t).toBe('not_a_number');
    }
    expect(problem('')).toBe('empty');
    expect(problem('   ')).toBe('empty');
  });

  it('keeps within numeric(38,18): 18 decimals and 20 integer digits', () => {
    expectDec(value('0.000000000000000001'), '1e-18');
    expect(problem('0.0000000000000000001')).toBe('too_many_decimals');
    expectDec(value('99999999999999999999'), '99999999999999999999');
    expect(problem('100000000000000000000')).toBe('too_large');
    expectDec(value('000000000000000000000001'), '1'); // leading zeros do not count
  });
});

describe('unitPriceFromTotal', () => {
  it('total / quantity, half-even to 18 decimals', () => {
    expectDec(unitPriceFromTotal(d('100'), d('3')), '33.333333333333333333');
    expectDec(unitPriceFromTotal(d('200'), d('3')), '66.666666666666666667');
    expectDec(unitPriceFromTotal(d('1237.11'), d('3')), '412.37');
    // ties go to the even digit
    expectDec(unitPriceFromTotal(d('0.000000000000000005'), d('2')), '0.000000000000000002');
    expectDec(unitPriceFromTotal(d('0.000000000000000015'), d('2')), '0.000000000000000008');
  });

  it('refuses a quantity of 0 or less', () => {
    expect(() => unitPriceFromTotal(d('1'), d('0'))).toThrow(RangeError);
    expect(() => unitPriceFromTotal(d('1'), d('-1'))).toThrow(RangeError);
  });
});
