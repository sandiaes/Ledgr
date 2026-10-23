export const colors = {
  background: '#f4f5f7',
  card: '#ffffff',
  text: '#16181d',
  muted: '#6b7280',
  border: '#e5e7eb',
  accent: '#2f5bd3',
  gain: '#13804a',
  loss: '#c62828',
  warningBg: '#fff6db',
  warningText: '#7a5600',
  errorBg: '#fdecec',
  value: '#2f5bd3',
  invested: '#9aa3b2',
  /** Allocation donut, by asset type. */
  types: { stock: '#2f5bd3', etf: '#13804a', crypto: '#e08a00', certificado_aforro: '#8e44ad' },
  /** Allocation by broker, currency or asset, in rank order. */
  palette: [
    '#2f5bd3',
    '#13804a',
    '#e08a00',
    '#8e44ad',
    '#c62828',
    '#00838f',
    '#6d4c41',
    '#ad1457',
    '#558b2f',
    '#3949ab',
  ],
  contributions: '#9aa3b2',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
