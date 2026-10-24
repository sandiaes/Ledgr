import { Text, type TextProps } from 'react-native';
import { type as textStyles, type Colors, type TextVariant } from './theme';
import { useColors } from './ThemeProvider';

/** The colour of a text, by token (a name, never a colour value). */
export type Tone = 'text' | 'muted' | 'faint' | 'accent' | 'onAccent' | 'gain' | 'loss' | 'warning';

export const toneColor = (colors: Colors, tone: Tone): string =>
  tone === 'warning' ? colors.warningText : colors[tone];

export interface TProps extends TextProps {
  variant?: TextVariant;
  tone?: Tone;
  /** A figure: digits all the same width, so columns line up and values do not jitter. */
  figure?: boolean;
}

/**
 * The one text component: a variant of the type scale (docs/design.md §3) in a tone. No
 * screen sets `fontSize` itself.
 */
export function T({ variant = 'body', tone = 'text', figure, style, ...rest }: TProps) {
  const colors = useColors();
  return (
    <Text
      {...rest}
      style={[
        textStyles[variant],
        { color: toneColor(colors, tone) },
        figure ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}
