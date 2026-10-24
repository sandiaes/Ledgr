import { dec, localDate } from '@ledgr/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Appearance, StyleSheet, useColorScheme, type TextStyle } from 'react-native';
import { AppRoot } from '../AppRoot';
import { TIME_ZONE } from '../data/usePortfolio';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../settings/settings';
import { fakeAuth, fakeData, fakeServices, portfolioLedger } from '../test/fakes';
import { Money } from './Money';
import { resolveScheme } from './ThemeProvider';
import { themes } from './theme';

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
  BarChart: () => null,
}));
const mockStatusBar = jest.fn();
jest.mock('expo-status-bar', () => ({
  StatusBar: (p: { style: string }) => {
    mockStatusBar(p.style);
    return null;
  },
}));
const mockNavBar = jest.fn();
jest.mock('expo-navigation-bar', () => ({
  NavigationBar: (p: { style: string }) => {
    mockNavBar(p.style);
    return null;
  },
}));

const today = localDate(new Date(), TIME_ZONE);
const systemScheme = useColorScheme as unknown as jest.Mock;

function services(settings: Partial<Settings> = {}) {
  const { auth } = fakeAuth({ level: 'aal2' });
  const s = fakeServices({ auth, data: fakeData(portfolioLedger(today)), settings });
  return s;
}

const colorOf = (text: string): string | undefined =>
  (StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle | undefined)?.color as
    string | undefined;
const lastCall = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1]?.[0];

async function openSettings(s: ReturnType<typeof services>) {
  const view = await render(<AppRoot services={s} />);
  await screen.findByText('Total value');
  await fireEvent.press(screen.getByText('More'));
  await fireEvent.press(await screen.findByText('Settings'));
  await screen.findByText('Appearance');
  return view;
}

beforeEach(() => {
  systemScheme.mockReturnValue('light');
  mockStatusBar.mockClear();
  mockNavBar.mockClear();
});

describe('Appearance setting', () => {
  it('defaults to System and reads an unknown stored value as System', () => {
    expect(DEFAULT_SETTINGS.appearance).toBe('system');
    expect(parseSettings({ appearance: 'sepia' }).appearance).toBe('system');
    expect(parseSettings({ appearance: 'dark' }).appearance).toBe('dark');
  });

  it('resolves a fixed choice, or the phone for System', () => {
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('light');
  });

  it('is saved when chosen and applied at once', async () => {
    const s = services();
    await openSettings(s);
    expect(colorOf('Appearance')).toBe(themes.light.muted);
    await fireEvent.press(screen.getByText('Dark'));
    expect(colorOf('Appearance')).toBe(themes.dark.muted);
    expect(s.settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ appearance: 'dark' }),
    );
    expect(lastCall(mockStatusBar)).toBe('light');
    expect(lastCall(mockNavBar)).toBe('dark');
    await fireEvent.press(screen.getByText('Light'));
    expect(colorOf('Appearance')).toBe(themes.light.muted);
    expect(lastCall(mockStatusBar)).toBe('dark');
  });

  it('is applied from the first render after a restart, without the other theme', async () => {
    systemScheme.mockReturnValue('light');
    await render(<AppRoot services={services({ appearance: 'dark' })} />);
    await screen.findByText('Total value');
    expect(mockStatusBar.mock.calls.every(([style]) => style === 'light')).toBe(true);
    expect(colorOf('Total value')).toBe(themes.dark.muted);
  });

  it('System follows the phone, including a change while the app is open', async () => {
    const s = services();
    const view = await openSettings(s);
    expect(colorOf('Appearance')).toBe(themes.light.muted);
    systemScheme.mockReturnValue('dark');
    await act(async () => view.rerender(<AppRoot services={s} />));
    expect(colorOf('Appearance')).toBe(themes.dark.muted);
    expect(lastCall(mockStatusBar)).toBe('light');
    // A fixed choice ignores the phone.
    await fireEvent.press(screen.getByText('Light'));
    expect(colorOf('Appearance')).toBe(themes.light.muted);
  });

  it('hands the choice to the native side (dialogs, keyboard)', async () => {
    const spy = jest.spyOn(Appearance, 'setColorScheme');
    const s = services();
    await openSettings(s);
    await fireEvent.press(screen.getByText('Dark'));
    expect(spy).toHaveBeenLastCalledWith('dark');
    await fireEvent.press(screen.getByText('System'));
    expect(spy).toHaveBeenLastCalledWith('unspecified');
    spy.mockRestore();
  });
});

describe('theme tokens', () => {
  // WCAG 2.x relative luminance and contrast ratio.
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  describe.each(['light', 'dark'] as const)('%s', (name) => {
    const c = themes[name];
    const grounds = { background: c.background, surface: c.surface };

    it.each(Object.entries(grounds))(
      'text, muted, gain, loss and accent read on %s (AA)',
      (_n, bg) => {
        for (const fg of [c.text, c.muted, c.gain, c.loss, c.accent]) {
          expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    it('text on filled and tinted areas reads (AA)', () => {
      expect(ratio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.onLoss, c.loss)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.warningText, c.warningBg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.loss, c.errorBg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.input.text, c.input.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.input.placeholder, c.input.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.tabBar.inactive, c.tabBar.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.muted, c.chart.tooltipBg)).toBeGreaterThanOrEqual(4.5);
    });

    it('chart colours stand out from the surface (3:1)', () => {
      const chart = [
        c.value,
        c.invested,
        c.contributions,
        c.gain,
        c.loss,
        ...Object.values(c.types),
        ...c.palette,
      ];
      for (const fg of chart) expect(ratio(fg, c.surface)).toBeGreaterThanOrEqual(3);
    });
  });

  it('keeps the +/- sign on coloured gains and losses, so colour is never the only cue', async () => {
    await render(
      <>
        <Money value={dec('12.5')} sign colored />
        <Money value={dec('-12.5')} sign colored />
      </>,
    );
    const [gain, loss] = screen.getAllByTestId('money');
    expect(String(gain!.props.children)).toMatch(/^\+/);
    expect(String(loss!.props.children)).toMatch(/^[-−]/);
  });
});
