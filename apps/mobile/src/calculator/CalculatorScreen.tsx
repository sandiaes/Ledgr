import {
  Decimal,
  RETURN_WARNING_RANGE,
  buildProjection,
  parseProjectionForm,
  projectGrowth,
  returnOutsideWarningRange,
  type ContributionTiming,
  type ProjectionDefaults,
  type ProjectionField,
  type ProjectionRow,
  type ProjectionView,
  type ReturnChoice,
} from '@ledgr/core';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePortfolio } from '../data/usePortfolio';
import { formatDate } from '../format';
import { useHideValues } from '../settings/SettingsProvider';
import { Amount, MASK } from '../ui/Amount';
import { Button, Field, Line } from '../ui/parts';
import { PortfolioScreen } from '../ui/PortfolioScreen';
import { Section } from '../ui/Section';
import { SegmentedControl } from '../ui/SegmentedControl';
import { IncludeCertificadosSwitch } from '../ui/Scope';
import { T } from '../ui/T';
import { radius, space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { GrowthChart } from './GrowthChart';
import { problemText } from './messages';

type ReturnMode = 'xirr' | 'twr' | 'custom';

/**
 * What the owner has changed. A field that is absent follows the defaults of the current asset
 * scope (docs/kpis.md §11.4); a field that is present keeps what was typed. "Reset to my
 * values" empties it. Nothing is saved: leaving the screen forgets it.
 */
interface Edits {
  startingValue?: string;
  monthlyContribution?: string;
  years?: string;
  extraMonths?: string;
  inflationPct?: string;
  timing?: ContributionTiming;
  returnMode?: ReturnMode;
  customReturn?: string;
}

const DEFAULT_YEARS = '10';
const DEFAULT_EXTRA_MONTHS = '0';
const DEFAULT_INFLATION = '0';

/** Display text of a default: half-up, at 2 decimals; the projection runs on this text. */
const fixed = (value: Decimal) => value.toFixed(2, Decimal.ROUND_HALF_UP);

/** The return in use: the owner's pick when it exists, else the default source, else custom. */
function returnMode(picked: ReturnMode | undefined, defaults: ProjectionDefaults): ReturnMode {
  if (picked === 'custom') return 'custom';
  if (picked && defaults[picked]) return picked;
  return defaults.defaultSource ?? 'custom';
}

/** Projects growth from the app's defaults and what the owner has typed over them. */
export function CalculatorScreen() {
  const styles = useStyles(makeStyles);
  const state = usePortfolio(buildProjection);
  // Held here, not in the calculator, so a scope with nothing in it does not forget the edits.
  const [edits, setEdits] = useState<Edits>({});
  return (
    <View style={styles.flex}>
      <View style={styles.scope}>
        <IncludeCertificadosSwitch />
      </View>
      <PortfolioScreen state={state} what="calculator">
        {(view) => <Calculator view={view} edits={edits} setEdits={setEdits} />}
      </PortfolioScreen>
    </View>
  );
}

function Calculator(props: {
  view: ProjectionView;
  edits: Edits;
  setEdits(update: (current: Edits) => Edits): void;
}) {
  const styles = useStyles(makeStyles);
  const [hidden] = useHideValues();
  const { view, edits } = props;
  const { defaults } = view;
  const change = (patch: Partial<Edits>) => props.setEdits((current) => ({ ...current, ...patch }));

  const mode = returnMode(edits.returnMode, defaults);
  const source = mode === 'custom' ? null : defaults[mode];
  const returnText =
    mode === 'custom'
      ? (edits.customReturn ?? '')
      : fixed((source as ReturnChoice).rate.times(100));
  const text = {
    startingValue: edits.startingValue ?? fixed(defaults.startingValueEur),
    monthlyContribution: edits.monthlyContribution ?? fixed(defaults.purchases.contributionEur),
    years: edits.years ?? DEFAULT_YEARS,
    extraMonths: edits.extraMonths ?? DEFAULT_EXTRA_MONTHS,
    annualReturnPct: returnText,
    inflationPct: edits.inflationPct ?? DEFAULT_INFLATION,
    timing: edits.timing ?? 'end',
  } as const;

  const key = JSON.stringify(text);
  const result = useMemo(() => {
    const parsed = parseProjectionForm(text);
    return parsed.ok ? { ok: true as const, projection: projectGrowth(parsed.input) } : parsed;
    // `text` is rebuilt every render; its content is the key.
  }, [key]);
  const errors = result.ok ? {} : result.errors;
  const error = (field: ProjectionField) => {
    const problem = errors[field];
    return problem ? problemText(field, problem) : undefined;
  };

  const sources: { value: ReturnMode; label: string }[] = [
    ...(defaults.xirr ? [{ value: 'xirr' as const, label: 'XIRR' }] : []),
    ...(defaults.twr ? [{ value: 'twr' as const, label: 'TWR (annualized)' }] : []),
    { value: 'custom', label: 'Custom' },
  ];
  const purchases = defaults.purchases;
  const contributionHint = purchases.averageEur.isNegative()
    ? 'You sold more than you bought over the period, so the default is 0.'
    : `Average net purchases (buys minus sells) per month over the last ${
        purchases.months === 12
          ? '12 months'
          : `${purchases.months} month${purchases.months === 1 ? '' : 's'}`
      }.`;

  return (
    <>
      <Section title="Your numbers">
        <Field
          label="Starting value (€)"
          hint={hidden ? 'Values are hidden.' : 'Your portfolio value now.'}
          keyboardType="decimal-pad"
          value={hidden ? MASK : text.startingValue}
          editable={!hidden}
          onChangeText={(startingValue) => change({ startingValue })}
          error={error('startingValue')}
        />
        <View style={styles.pair}>
          <View style={styles.half}>
            <Field
              label="Years"
              keyboardType="number-pad"
              value={text.years}
              onChangeText={(years) => change({ years })}
              error={error('years')}
            />
          </View>
          <View style={styles.half}>
            <Field
              label="Extra months"
              keyboardType="number-pad"
              value={text.extraMonths}
              onChangeText={(extraMonths) => change({ extraMonths })}
              error={error('extraMonths')}
            />
          </View>
        </View>
        <Field
          label="Expected annual return (%)"
          hint="The effective annual rate (the yearly result, not a monthly rate times 12)."
          keyboardType="numeric"
          value={hidden ? MASK : returnText}
          editable={!hidden}
          onChangeText={(customReturn) => change({ returnMode: 'custom', customReturn })}
          error={error('annualReturn')}
        />
        <SegmentedControl
          options={sources}
          value={mode}
          onChange={(picked) =>
            change(
              picked === 'custom'
                ? { returnMode: 'custom', customReturn: edits.customReturn ?? returnText }
                : { returnMode: picked },
            )
          }
        />
        <ReturnSource source={source} defaults={defaults} today={view.today} />
        <Field
          label="Monthly contribution (€)"
          hint={hidden ? 'Values are hidden.' : contributionHint}
          keyboardType="decimal-pad"
          value={hidden ? MASK : text.monthlyContribution}
          editable={!hidden}
          onChangeText={(monthlyContribution) => change({ monthlyContribution })}
          error={error('monthlyContribution')}
        />
        <SegmentedControl
          options={[
            { value: 'end', label: 'End of month' },
            { value: 'start', label: 'Start of month' },
          ]}
          value={text.timing}
          onChange={(timing) => change({ timing })}
        />
        <Field
          label="Annual inflation (%)"
          hint="Optional. Above 0 adds the ending value in today's money."
          keyboardType="decimal-pad"
          value={text.inflationPct}
          onChangeText={(inflationPct) => change({ inflationPct })}
          error={error('inflation')}
        />
        <Button
          label="Reset to my values"
          kind="plain"
          onPress={() => props.setEdits(() => ({}))}
        />
      </Section>

      {result.ok ? (
        <>
          <Section title="Result" testID="projection-result">
            <T variant="sub" tone="muted">
              Ending value
            </T>
            <Amount value={result.projection.endingValue} variant="title1" style={styles.hero} />
            <Line label="Total contributed">
              <Amount value={result.projection.totalContributed} variant="body" />
            </Line>
            <Line label="Total growth">
              <Amount value={result.projection.totalGrowth} sign tone variant="body" />
            </Line>
            <Line label="Growth share of ending value">
              <Amount kind="pct" value={result.projection.growthShare} variant="body" />
            </Line>
            {result.projection.endingValueReal ? (
              <Line label="Ending value in today's money">
                <Amount value={result.projection.endingValueReal} variant="body" />
              </Line>
            ) : null}
          </Section>
          {result.projection.rows.length > 0 ? (
            <>
              <Section title="Contributed and growth, by year">
                <GrowthChart rows={result.projection.rows} />
              </Section>
              <Section title="Year by year">
                {result.projection.rows.map((r) => (
                  <YearRow key={r.months} row={r} />
                ))}
              </Section>
            </>
          ) : null}
        </>
      ) : (
        <Section>
          <T variant="sub" tone="muted">
            Fix the fields above to see the projection.
          </T>
        </Section>
      )}
      <T variant="caption" tone="muted" style={styles.footnote}>
        A projection from the numbers above, not a forecast: real returns are not constant.
      </T>
    </>
  );
}

/** Which number the return comes from, and over what period. */
function ReturnSource(props: {
  source: ReturnChoice | null;
  defaults: ProjectionDefaults;
  today: string;
}) {
  const styles = useStyles(makeStyles);
  const { source } = props;
  const year = props.today.slice(0, 4);
  if (!source) {
    return (
      <T variant="caption" tone="muted" style={styles.note} testID="return-source">
        {props.defaults.defaultSource === null
          ? 'No return could be computed from your history yet (the annualized TWR needs a year of history). Enter the return you expect.'
          : 'Your own figure.'}
      </T>
    );
  }
  const name = source.source === 'xirr' ? 'XIRR since start' : 'TWR since start, annualized';
  const warn = returnOutsideWarningRange(source.rate);
  return (
    <>
      <T variant="caption" tone="muted" style={styles.note} testID="return-source">
        {name}: <Amount kind="pct" value={source.rate} /> a year, from{' '}
        {formatDate(source.from, year)} to {formatDate(source.to, year)} ({source.days} days).
        {source.shortHistory
          ? ' Less than a year of history: this is a short period turned into an annual rate.'
          : ''}
      </T>
      {warn ? (
        <T variant="caption" tone="warning" style={styles.warning} testID="return-warning">
          This return is outside {RETURN_WARNING_RANGE.minPct}% to +{RETURN_WARNING_RANGE.maxPct}% a
          year. Check it before relying on the projection.
        </T>
      ) : null}
    </>
  );
}

const rowLabel = (r: ProjectionRow) => {
  const months = r.months % 12;
  const years = `${r.years} year${r.years === 1 ? '' : 's'}`;
  return `After ${r.years === 0 ? `${months} months` : months === 0 ? years : `${years} ${months} months`}`;
};

function YearRow({ row }: { row: ProjectionRow }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row} testID="projection-row">
      <View style={styles.rowHead}>
        <T variant="headline">{rowLabel(row)}</T>
        <Amount value={row.balance} variant="headline" />
      </View>
      <View style={styles.figures}>
        <T variant="caption" tone="muted">
          contributed
        </T>
        <Amount value={row.contributed} variant="caption" />
        <T variant="caption" tone="muted">
          · growth
        </T>
        <Amount value={row.growth} sign tone variant="caption" />
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    scope: { paddingTop: space.md },
    pair: { flexDirection: 'row', gap: space.md },
    half: { flex: 1 },
    hero: { marginBottom: space.md },
    note: { marginBottom: space.md },
    warning: {
      backgroundColor: colors.warningBg,
      padding: space.sm,
      borderRadius: radius.sm,
      overflow: 'hidden',
      marginBottom: space.md,
    },
    footnote: { marginHorizontal: space.lg, marginBottom: space.xl },
    row: {
      minHeight: 56,
      justifyContent: 'center',
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    figures: { flexDirection: 'row', gap: space.xs, alignItems: 'baseline', flexWrap: 'wrap' },
  });
