// The only file in the app that may contain colour values (`pnpm check` enforces it, see
// `noHardCodedColors.test.ts`). Everything else asks the theme for a token. The values are
// the ones of docs/design.md §2; `theme.test.tsx` checks their contrast.

export interface Colors {
  /** App background (near-black in dark, not pure black). */
  background: string;
  /** Header, tab bar, input fields. */
  surface: string;
  /** Drawer, expanded header, sheets, dialogs, tooltips. */
  raised: string;
  /** Pressed row or button, the track of a segmented control, skeleton base. */
  pressed: string;
  /** Hairline between rows and sections. */
  divider: string;
  text: string;
  /** Secondary text: labels, names under tickers. */
  muted: string;
  /** Tertiary text: "as of", captions, axis labels, disabled. */
  faint: string;
  /** The skeleton highlight (it pulses between `pressed` and this). */
  skeleton: string;
  /** Behind the drawer. */
  scrim: string;
  border: string;
  accent: string;
  /** Selected segment and chip background. */
  accentSoft: string;
  /** Text and icons on an `accent` fill. */
  onAccent: string;
  gain: string;
  loss: string;
  /** Tint behind a gain pill. */
  gainSoft: string;
  /** Tint behind a loss pill. */
  lossSoft: string;
  /** Text and icons on a `loss` fill. */
  onLoss: string;
  warningBg: string;
  warningText: string;
  errorBg: string;
  /** Value line / price line in charts. */
  value: string;
  /** The area under the value line: `color` fading from `startOpacity` to `endOpacity`. */
  valueFill: { color: string; startOpacity: number; endOpacity: number };
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
  background: '#F6F7F9',
  surface: '#FFFFFF',
  raised: '#FFFFFF',
  pressed: '#ECEEF1',
  divider: '#E3E6EA',
  text: '#111418',
  muted: '#56606C',
  faint: '#67707C',
  skeleton: '#E0E3E8',
  scrim: 'rgba(17,20,24,0.4)',
  border: '#E3E6EA',
  accent: '#2E59BF',
  accentSoft: '#E6ECF8',
  onAccent: '#FFFFFF',
  gain: '#11764A',
  loss: '#BF3329',
  gainSoft: '#E5F3EC',
  lossSoft: '#FBE9E7',
  onLoss: '#FFFFFF',
  warningBg: '#FFF4D6',
  warningText: '#7A5600',
  errorBg: '#FBE9E7',
  value: '#2E59BF',
  valueFill: { color: '#2E59BF', startOpacity: 0.12, endOpacity: 0 },
  invested: '#67707C',
  contributions: '#67707C',
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
    axis: '#E3E6EA',
    pointer: '#56606C',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#E3E6EA',
  },
  tabBar: { background: '#FFFFFF', border: '#E3E6EA', active: '#111418', inactive: '#67707C' },
  input: { background: '#FFFFFF', border: '#848D99', text: '#111418', placeholder: '#56606C' },
  modal: { backdrop: 'rgba(17,20,24,0.4)', surface: '#FFFFFF' },
  switch: { trackOff: '#C5CBD3', trackOn: '#A9BCE6', thumbOff: '#F6F7F9', thumbOn: '#2E59BF' },
};

export const darkColors: Colors = {
  background: '#0C0E11',
  surface: '#15181D',
  raised: '#1C2026',
  pressed: '#23282F',
  divider: '#262B32',
  text: '#ECEFF3',
  muted: '#A0A8B4',
  faint: '#858E9A',
  skeleton: '#2C323A',
  scrim: 'rgba(0,0,0,0.6)',
  border: '#2C313A',
  accent: '#8FADE6',
  accentSoft: '#1F2A3D',
  onAccent: '#0C0E11',
  gain: '#5DC28F',
  loss: '#F2827A',
  gainSoft: '#15281F',
  lossSoft: '#2E1A19',
  onLoss: '#0C0E11',
  warningBg: '#2B2514',
  warningText: '#E6C47E',
  errorBg: '#2E1A19',
  value: '#8FADE6',
  valueFill: { color: '#8FADE6', startOpacity: 0.18, endOpacity: 0 },
  invested: '#858E9A',
  contributions: '#858E9A',
  // The old hues, about 15% less saturated so they sit with the accent.
  types: { stock: '#88A7F5', etf: '#55BA8A', crypto: '#E2A348', certificado_aforro: '#C391DA' },
  palette: [
    '#88A7F5',
    '#55BA8A',
    '#E2A348',
    '#C391DA',
    '#F4837B',
    '#58BBC3',
    '#C5A493',
    '#E678A9',
    '#9BC46D',
    '#A5ADEF',
  ],
  chart: {
    axis: '#262B32',
    pointer: '#A0A8B4',
    tooltipBg: '#1C2026',
    tooltipBorder: '#2C313A',
  },
  tabBar: { background: '#15181D', border: '#262B32', active: '#ECEFF3', inactive: '#858E9A' },
  input: { background: '#15181D', border: '#5F6874', text: '#ECEFF3', placeholder: '#A0A8B4' },
  modal: { backdrop: 'rgba(0,0,0,0.6)', surface: '#1C2026' },
  switch: { trackOff: '#3A414B', trackOn: '#3B4F78', thumbOff: '#A0A8B4', thumbOn: '#8FADE6' },
};

export type Scheme = 'light' | 'dark';
export const themes: Record<Scheme, Colors> = { light: lightColors, dark: darkColors };

/** The 4 dp grid. Screen side gutter is `lg`, between sections `xl`. */
export const space = {
  /** The 2 dp of a tight stack (a title over its subtitle); below the 4 dp grid. */
  hairline: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** `pill` for chips, segments and the round "+" button. */
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Touch targets are at least this big (icons are 24 dp with a hit slop up to it). */
export const TOUCH_TARGET = 48;

/** Height of the collapsed header bar, below the status bar. */
export const HEADER_HEIGHT = 56;

/** Font weights (docs/design.md §3): 400 and 600, and 700 for the expanded total. */
export const weight = { regular: '400', semibold: '600', bold: '700' } as const;

/** Text inside an input is 16 sp, a step above `body`, so it never reads tiny (§3). */
export const INPUT_FONT_SIZE = 16;

/** The spacing of the 6-digit code field's digits. */
export const CODE_LETTER_SPACING = 6;

export type TextVariant =
  'display' | 'title1' | 'title2' | 'headline' | 'body' | 'sub' | 'caption' | 'overline';

export interface TextStyleSpec {
  fontSize: number;
  lineHeight: number;
  fontWeight: (typeof weight)[keyof typeof weight];
  letterSpacing?: number;
  textTransform?: 'uppercase';
}

/**
 * Text styles, colour-free (docs/design.md §3). System font (Roboto on Android), nothing to
 * load. Figures also get tabular digits in `T`, so columns line up and values do not jitter.
 */
export const type: Record<TextVariant, TextStyleSpec> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: weight.bold },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: weight.semibold },
  title2: { fontSize: 20, lineHeight: 26, fontWeight: weight.semibold },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: weight.semibold },
  body: { fontSize: 15, lineHeight: 20, fontWeight: weight.regular },
  sub: { fontSize: 13, lineHeight: 18, fontWeight: weight.regular },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: weight.regular },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: weight.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
};
