// The only file in the app that may contain colour values (`pnpm check` enforces it, see
// `noHardCodedColors.test.ts`). Everything else asks the theme for a token.

export interface Colors {
  background: string;
  /** Cards, list rows, dialogs. */
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  /** Text and icons on an `accent` fill. */
  onAccent: string;
  gain: string;
  loss: string;
  /** Text and icons on a `loss` fill. */
  onLoss: string;
  warningBg: string;
  warningText: string;
  errorBg: string;
  /** Value line / price line in charts. */
  value: string;
  /** Net invested line in charts. */
  invested: string;
  contributions: string;
  /** Allocation donut, by asset type. */
  types: { stock: string; etf: string; crypto: string; certificado_aforro: string };
  /** Allocation by broker, currency or asset, in rank order. */
  palette: readonly string[];
  chart: {
    axis: string;
    /** The pointer line while scrubbing. */
    pointer: string;
    tooltipBg: string;
    tooltipBorder: string;
  };
  tabBar: { background: string; border: string; active: string; inactive: string };
  input: { background: string; border: string; text: string; placeholder: string };
  modal: { backdrop: string; surface: string };
  /** Track and thumb of a Switch. */
  switch: { trackOff: string; trackOn: string; thumbOff: string; thumbOn: string };
}

export const lightColors: Colors = {
  background: '#f4f5f7',
  surface: '#ffffff',
  text: '#16181d',
  muted: '#5b6472',
  border: '#e5e7eb',
  accent: '#2f5bd3',
  onAccent: '#ffffff',
  gain: '#0f7a44',
  loss: '#c62828',
  onLoss: '#ffffff',
  warningBg: '#fff6db',
  warningText: '#7a5600',
  errorBg: '#fdecec',
  value: '#2f5bd3',
  invested: '#6b7585',
  contributions: '#6b7585',
  types: { stock: '#2f5bd3', etf: '#0f7a44', crypto: '#b86e00', certificado_aforro: '#8e44ad' },
  palette: [
    '#2f5bd3',
    '#0f7a44',
    '#b86e00',
    '#8e44ad',
    '#c62828',
    '#00797f',
    '#6d4c41',
    '#ad1457',
    '#558b2f',
    '#3949ab',
  ],
  chart: {
    axis: '#c4c9d2',
    pointer: '#5b6472',
    tooltipBg: '#ffffff',
    tooltipBorder: '#c4c9d2',
  },
  tabBar: { background: '#ffffff', border: '#e5e7eb', active: '#2f5bd3', inactive: '#5b6472' },
  input: { background: '#ffffff', border: '#9aa3b2', text: '#16181d', placeholder: '#5b6472' },
  modal: { backdrop: 'rgba(0,0,0,0.4)', surface: '#ffffff' },
  switch: { trackOff: '#c4c9d2', trackOn: '#9db5f0', thumbOff: '#f4f5f7', thumbOn: '#2f5bd3' },
};

export const darkColors: Colors = {
  background: '#0e1014',
  surface: '#181b21',
  text: '#eceef2',
  muted: '#9ca5b4',
  border: '#2c313a',
  accent: '#7ea3ff',
  onAccent: '#0e1014',
  gain: '#4cc38a',
  loss: '#ff7a70',
  onLoss: '#0e1014',
  warningBg: '#3a2f10',
  warningText: '#f5d58a',
  errorBg: '#3d1b1b',
  value: '#7ea3ff',
  invested: '#8c96a6',
  contributions: '#8c96a6',
  types: { stock: '#7ea3ff', etf: '#4cc38a', crypto: '#f0a63a', certificado_aforro: '#c58be0' },
  palette: [
    '#7ea3ff',
    '#4cc38a',
    '#f0a63a',
    '#c58be0',
    '#ff7a70',
    '#4fc3cc',
    '#c9a28f',
    '#f06ea8',
    '#9ccc65',
    '#9fa8f5',
  ],
  chart: {
    axis: '#444b57',
    pointer: '#9ca5b4',
    tooltipBg: '#232830',
    tooltipBorder: '#444b57',
  },
  tabBar: { background: '#181b21', border: '#2c313a', active: '#7ea3ff', inactive: '#9ca5b4' },
  input: { background: '#181b21', border: '#5b6472', text: '#eceef2', placeholder: '#9ca5b4' },
  modal: { backdrop: 'rgba(0,0,0,0.65)', surface: '#232830' },
  switch: { trackOff: '#444b57', trackOn: '#3d5fb0', thumbOff: '#9ca5b4', thumbOn: '#7ea3ff' },
};

export type Scheme = 'light' | 'dark';
export const themes: Record<Scheme, Colors> = { light: lightColors, dark: darkColors };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
