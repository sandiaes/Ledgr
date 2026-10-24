import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { T } from './T';
import { space } from './theme';
import { useStyles } from './ThemeProvider';
import type { Colors } from './theme';

const part = (content: ReactNode, variant: 'headline' | 'sub', tone: 'text' | 'muted') =>
  typeof content === 'string' ? (
    <T variant={variant} tone={tone} numberOfLines={1}>
      {content}
    </T>
  ) : (
    content
  );

/**
 * The one row: a primary line and a secondary line on the left, a primary and a secondary
 * figure right-aligned on the right, an optional leading icon or badge and a trailing
 * chevron; a hairline below (unless `last`) and a pressed state; at least 56 dp tall
 * (docs/design.md §6.6). Strings are styled; elements (an `Amount`) are placed as they are.
 */
export function ListRow(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
  leading?: ReactNode;
  /** A full-width line under the row (a breakdown, the details of an expanded row). */
  footer?: ReactNode;
  onPress?: () => void;
  /** A forward chevron after the figures (implied by `onPress`). */
  chevron?: boolean;
  /** No divider below. */
  last?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useStyles(makeStyles);
  const body = (
    <>
      <View style={styles.main}>
        {props.leading ? <View style={styles.leading}>{props.leading}</View> : null}
        <View style={styles.left}>
          {part(props.title, 'headline', 'text')}
          {props.subtitle ? part(props.subtitle, 'sub', 'muted') : null}
        </View>
        {props.right || props.rightSub ? (
          <View style={styles.right}>
            {props.right ? part(props.right, 'headline', 'text') : null}
            {props.rightSub ? part(props.rightSub, 'sub', 'muted') : null}
          </View>
        ) : null}
        {props.chevron || props.onPress ? <Icon name="forward" size={18} tone="faint" /> : null}
      </View>
      {props.footer ? <View style={styles.footer}>{props.footer}</View> : null}
    </>
  );
  const rowStyle = [styles.row, props.last ? null : styles.divider, props.style];
  if (!props.onPress) {
    return (
      <View style={rowStyle} testID={props.testID} accessibilityLabel={props.accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      style={({ pressed }) => [rowStyle, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: { minHeight: 56, justifyContent: 'center', paddingVertical: space.md },
    main: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    footer: { marginTop: space.sm },
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    pressed: { backgroundColor: colors.pressed },
    leading: { alignItems: 'center', justifyContent: 'center' },
    left: { flex: 1, gap: space.hairline },
    right: { alignItems: 'flex-end', gap: space.hairline },
  });
