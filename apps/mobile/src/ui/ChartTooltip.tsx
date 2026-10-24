import { StyleSheet, View } from 'react-native';
import { T, type Tone } from './T';
import { radius, space, weight, type Colors } from './theme';
import { useStyles } from './ThemeProvider';

/**
 * The box shown while scrubbing a chart: a date and one or more lines. The lines are
 * strings the chart made with `useMaskedText`, so they are already masked when privacy is on.
 */
export function ChartTooltip(props: {
  date: string;
  lines: readonly { text: string; tone?: Tone; strong?: boolean }[];
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.box} testID="chart-tooltip">
      <T variant="caption" tone="muted" figure>
        {props.date}
      </T>
      {props.lines.map((l, i) => (
        <T
          key={i}
          variant={l.strong ? 'sub' : 'caption'}
          tone={l.tone ?? 'muted'}
          figure
          style={l.strong ? styles.strong : undefined}
        >
          {l.text}
        </T>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    box: {
      backgroundColor: colors.chart.tooltipBg,
      borderRadius: radius.sm,
      padding: space.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.chart.tooltipBorder,
    },
    strong: { fontWeight: weight.semibold },
  });
