import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from './T';
import { space } from './theme';

/**
 * A titled group on a screen: an overline title, an optional action on its right (a link or
 * a segmented control), the content, and space after. No background, border or shadow
 * (docs/design.md §6.5).
 */
export function Section(props: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.section} testID={props.testID}>
      {props.title || props.action ? (
        <View style={styles.head}>
          {props.title ? (
            <T variant="overline" tone="muted" accessibilityRole="header" style={styles.title}>
              {props.title}
            </T>
          ) : null}
          {props.action}
        </View>
      ) : null}
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: space.lg, marginBottom: space.xl },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
    columnGap: space.md,
    rowGap: space.sm,
    flexWrap: 'wrap',
  },
  title: { flexShrink: 1 },
});
