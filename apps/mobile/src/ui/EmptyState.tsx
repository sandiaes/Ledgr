import { StyleSheet, View } from 'react-native';
import { Icon, type IconRole } from './Icon';
import { Button } from './parts';
import { T } from './T';
import { space } from './theme';

/** Nothing to show yet, and what to do about it ("Add your first one with +"). */
export function EmptyState(props: {
  title: string;
  line?: string;
  icon?: IconRole;
  action?: { label: string; onPress(): void };
  testID?: string;
}) {
  return (
    <View style={styles.box} testID={props.testID ?? 'empty-state'}>
      <Icon name={props.icon ?? 'empty'} size={32} tone="faint" />
      <T variant="headline" style={styles.center}>
        {props.title}
      </T>
      {props.line ? (
        <T variant="sub" tone="muted" style={styles.center}>
          {props.line}
        </T>
      ) : null}
      {props.action ? (
        <View style={styles.action}>
          <Button label={props.action.label} onPress={props.action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Something failed to load: where, a code, and how to retry. Never an amount (the code is
 * an HTTP status or a PostgREST code).
 */
export function ErrorState(props: { title: string; code?: string; hint?: string }) {
  return (
    <View style={styles.box} accessibilityRole="alert" testID="error-state">
      <Icon name="error" size={32} tone="faint" />
      <T variant="headline" style={styles.center}>
        {props.title}
      </T>
      {props.code ? (
        <T variant="caption" tone="faint" style={styles.center}>
          {props.code}
        </T>
      ) : null}
      <T variant="sub" tone="muted" style={styles.center}>
        {props.hint ?? 'Pull down to retry'}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  center: { textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: space.sm },
});
