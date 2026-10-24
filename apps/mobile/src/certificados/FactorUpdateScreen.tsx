import {
  addMonths,
  factorChange,
  factorUpdateLines,
  parseDecimalInput,
  type Decimal,
  type FactorUpdateLine,
  type IsoDate,
} from '@ledgr/core';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useRefreshAfterWrite, useToday } from '../data/usePortfolio';
import { formatPeriod } from '../format';
import { useServices, type Ledger } from '../services';
import { Amount } from '../ui/Amount';
import { Money, Pct } from '../ui/Money';
import { Banner, Button, Card, Field } from '../ui/parts';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { seriesLabel } from './CertificadosScreen';

type Parsed = { ok: true; value: Decimal } | { ok: false; message: string } | null;

function parseFactor(text: string): Parsed {
  if (text.trim() === '') return null;
  const p = parseDecimalInput(text);
  if (!p.ok) return { ok: false, message: 'Not a number (e.g. 1.10482).' };
  if (!p.value.gt(0)) return { ok: false, message: 'Must be more than 0.' };
  return { ok: true, value: p.value };
}

/**
 * The monthly factor update (docs/app-plan.md §1): the month preselected (this month), one
 * input per held subscription with last month's factor and the change as you type (a
 * decrease is warned about, not blocked). A month already recorded is read-only: factor
 * rows are never changed.
 */
export function FactorUpdateScreen() {
  const styles = useStyles(makeStyles);
  const ledger = useLedger();
  const today = useToday();
  if (ledger.isError) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="error">Could not load the factors ({errorCode(ledger.error)}).</Banner>
      </ScrollView>
    );
  }
  if (!ledger.data) return <Text style={styles.status}>Loading…</Text>;
  return <FactorUpdate ledger={ledger.data} today={today} />;
}

function FactorUpdate({ ledger, today }: { ledger: Ledger; today: IsoDate }) {
  const styles = useStyles(makeStyles);
  const { data: api } = useServices();
  const refresh = useRefreshAfterWrite();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const [month, setMonth] = useState(thisMonth);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [savedMonth, setSavedMonth] = useState<string | null>(null);
  const saving = useRef(false);
  const mutation = useMutation({
    mutationFn: (rows: { subscriptionId: string; factor: Decimal }[]) =>
      api.insertFactors(month, rows),
  });

  const lines = useMemo(
    () =>
      factorUpdateLines({
        transactions: ledger.transactions,
        subscriptions: ledger.ca.subscriptions,
        factors: ledger.ca.factors,
        month,
        today,
      }),
    [ledger, month, today],
  );
  const open = lines.filter((l) => !l.recorded);
  const parsed = open.map((l) => [l, parseFactor(inputs[l.subscriptionId] ?? '')] as const);
  const toSave = parsed.flatMap(([l, p]) =>
    p?.ok ? [{ subscriptionId: l.subscriptionId, factor: p.value }] : [],
  );
  const invalid = parsed.some(([, p]) => p && !p.ok);

  const save = async () => {
    if (saving.current || toSave.length === 0 || invalid) return;
    saving.current = true;
    try {
      await mutation.mutateAsync(toSave);
      await refresh();
      setInputs({});
      setSavedMonth(month);
    } catch {
      // shown below; a retry is safe (a stored month with the same factor counts as saved)
    } finally {
      saving.current = false;
    }
  };

  const step = (months: number) => {
    setMonth(addMonths(month, months));
    setInputs({});
    setSavedMonth(null);
    mutation.reset();
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={styles.month}>
          <Pressable
            onPress={() => step(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            hitSlop={12}
          >
            <Text style={styles.arrow}>‹</Text>
          </Pressable>
          <Text style={styles.monthText}>{formatPeriod(month.slice(0, 7))}</Text>
          <Pressable
            onPress={() => step(1)}
            disabled={month >= thisMonth}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            accessibilityState={{ disabled: month >= thisMonth }}
            hitSlop={12}
          >
            <Text style={[styles.arrow, month >= thisMonth && styles.off]}>›</Text>
          </Pressable>
        </View>
        <Text style={styles.muted}>
          The value of one unit as AforroNet shows it, in force from the 1st of the month.
        </Text>
      </Card>

      {savedMonth === month ? <Banner tone="warning">Factors saved.</Banner> : null}
      {lines.length === 0 ? (
        <Card>
          <Text style={styles.muted}>No certificados held.</Text>
        </Card>
      ) : null}
      {lines.map((l) => (
        <FactorInput
          key={l.subscriptionId}
          line={l}
          series={seriesLabel(ledger, l.seriesId)}
          text={inputs[l.subscriptionId] ?? ''}
          onChange={(t) => setInputs((i) => ({ ...i, [l.subscriptionId]: t }))}
        />
      ))}

      {mutation.error ? (
        <Banner tone="error">
          Not saved ({errorCode(mutation.error)}). Tap Save to try again.
        </Banner>
      ) : null}
      {open.length > 0 ? (
        <View style={styles.buttons}>
          <Button
            label={toSave.length > 1 ? `Save ${toSave.length} factors` : 'Save factor'}
            onPress={() => void save()}
            disabled={toSave.length === 0 || invalid}
            busy={mutation.isPending}
          />
          <Text style={styles.note}>Snapshots pick this up in tomorrow’s daily run.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function FactorInput(props: {
  line: FactorUpdateLine;
  series: string;
  text: string;
  onChange(text: string): void;
}) {
  const styles = useStyles(makeStyles);
  const { line } = props;
  const label = `${props.series} · subscribed ${formatPeriod(line.subscribedOn.slice(0, 7))}`;
  const previous = line.previous;
  const parsed = parseFactor(props.text);
  const next = line.recorded?.factor ?? (parsed?.ok ? parsed.value : null);
  const change = next
    ? factorChange({ previous: previous?.factor ?? null, next, units: line.units })
    : null;
  return (
    <Card testID="factor-line">
      <Text style={styles.title}>{label}</Text>
      <View style={styles.inline}>
        <Text style={styles.muted}>
          {previous ? `Last: ${formatPeriod(previous.month.slice(0, 7))}` : 'No earlier factor'}
        </Text>
        {previous ? (
          <Amount value={previous.factor} currency="EUR" dp={5} style={styles.muted} />
        ) : null}
      </View>
      {line.recorded ? (
        <View style={styles.inline}>
          <Text style={styles.value}>Recorded:</Text>
          <Amount value={line.recorded.factor} currency="EUR" dp={5} style={styles.value} />
          <Text style={styles.muted}>(read-only)</Text>
        </View>
      ) : (
        <Field
          label={`Factor for ${label}`}
          value={props.text}
          onChangeText={props.onChange}
          keyboardType="decimal-pad"
          placeholder="0.00000"
          error={parsed && !parsed.ok ? parsed.message : undefined}
        />
      )}
      {change?.valueEur ? (
        <View style={styles.inline} testID="factor-change">
          <Text style={styles.muted}>Change vs last month, from factor:</Text>
          <Money value={change.valueEur} sign colored style={styles.value} />
          <Pct value={change.pct} sign style={styles.value} />
        </View>
      ) : null}
      {change?.decreased ? (
        <Text style={styles.warning}>Lower than last month: check it (it can still be saved).</Text>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { paddingTop: space.md, paddingBottom: space.xl },
    status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
    month: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: space.xs,
    },
    monthText: { fontSize: 17, fontWeight: '700', color: colors.text },
    arrow: { fontSize: 28, color: colors.accent, paddingHorizontal: space.md },
    off: { color: colors.border },
    title: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: space.xs },
    inline: {
      flexDirection: 'row',
      gap: 4,
      alignItems: 'baseline',
      flexWrap: 'wrap',
      marginBottom: space.xs,
    },
    muted: { fontSize: 12, color: colors.muted },
    value: { fontSize: 14, color: colors.text },
    warning: { fontSize: 13, color: colors.warningText },
    note: { fontSize: 12, color: colors.muted, marginTop: space.sm, textAlign: 'center' },
    buttons: { marginHorizontal: space.lg },
  });
