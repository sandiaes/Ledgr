import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from './T';
import { space } from './theme';

/**
 * A label on the left, figures on the right: the rows of a figure table (the Dashboard's
 * gain section, a position's figures, a broker's split). `strong` is the row's headline,
 * `sub` a quieter breakdown line.
 */
export function FigureLine(props: {
  label: string;
  children: ReactNode;
  strong?: boolean;
  sub?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.line} testID={props.testID}>
      <T
        variant={props.strong ? 'headline' : 'body'}
        tone={props.sub ? 'muted' : 'text'}
        style={styles.label}
      >
        {props.label}
      </T>
      <View style={styles.value}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: space.xs,
    gap: space.md,
  },
  label: { flexShrink: 1 },
  value: { flexDirection: 'row', gap: space.sm, alignItems: 'baseline', flexShrink: 1 },
});
