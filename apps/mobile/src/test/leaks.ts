/**
 * An amount that leaked: digits next to a currency symbol or code, in the pt-PT order
 * ("1.500,00 €", "412,37 USD") or the old one ("€1,500.00"). With privacy on, no text on any
 * screen may match.
 */
export const AMOUNT_TEXT = /\d[\d.,]*[\s\u00A0]?(€|USD|GBP|CHF)|(€|\$|£)[\s\u00A0]?\d/;
