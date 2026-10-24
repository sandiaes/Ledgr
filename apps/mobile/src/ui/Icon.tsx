import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { toneColor, type Tone } from './T';
import { useColors } from './ThemeProvider';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The icon set (docs/design.md §5): Ionicons, outline style, one stroke weight, no brand
 * icons or assets. Screens name an icon by its role.
 */
export const ICONS = {
  menu: 'menu-outline',
  back: 'chevron-back',
  eye: 'eye-outline',
  eyeOff: 'eye-off-outline',
  dashboard: 'grid-outline',
  positions: 'layers-outline',
  add: 'add',
  activity: 'time-outline',
  calculator: 'calculator-outline',
  expand: 'chevron-down',
  collapse: 'chevron-up',
  forward: 'chevron-forward',
  appearance: 'contrast-outline',
  privacy: 'eye-outline',
  newTransaction: 'add-circle-outline',
  security: 'lock-closed-outline',
  data: 'cloud-done-outline',
  certificados: 'document-text-outline',
  signOut: 'log-out-outline',
  empty: 'leaf-outline',
  error: 'cloud-offline-outline',
  noMatch: 'search-outline',
  buy: 'arrow-down',
  sell: 'arrow-up',
  income: 'cash-outline',
  other: 'swap-horizontal',
} as const satisfies Record<string, IconName>;

export type IconRole = keyof typeof ICONS;

export function Icon(props: { name: IconRole; size?: number; tone?: Tone }) {
  const colors = useColors();
  return (
    <Ionicons
      name={ICONS[props.name]}
      size={props.size ?? 24}
      color={toneColor(colors, props.tone ?? 'text')}
    />
  );
}
