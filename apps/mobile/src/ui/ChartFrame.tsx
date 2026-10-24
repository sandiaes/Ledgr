import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from './T';
import { space } from './theme';

/**
 * Wraps a chart: a fixed height (so loading and empty states do not make the screen jump),
 * the range control under it, then a summary line and a one-line legend (docs/design.md
 * §6.9). With `empty` the chart is replaced by a message of the same height.
 */
export function ChartFrame(props: {
  height: number;
  children: ReactNode;
  empty?: boolean;
  emptyText?: string;
  controls?: ReactNode;
  summary?: ReactNode;
  legend?: ReactNode;
  testID?: string;
}) {
  return (
    <View testID={props.testID}>
      <View style={{ height: props.height, justifyContent: 'center' }}>
        {props.empty ? (
          <T variant="sub" tone="muted" style={styles.empty}>
            {props.emptyText ?? 'Not enough history for a chart yet'}
          </T>
        ) : (
          props.children
        )}
      </View>
      {props.controls ? <View style={styles.controls}>{props.controls}</View> : null}
      {props.summary}
      {props.legend ? <View style={styles.legend}>{props.legend}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center' },
  controls: { marginTop: space.md },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
});
