import {
  certificadoSubscriptions,
  createCaFactorLookup,
  type CertificadoSubscriptionView,
} from '@ledgr/core';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorCode } from '../auth/errors';
import { useLedger, useToday } from '../data/usePortfolio';
import { formatPeriod } from '../format';
import { useRootNavigation } from '../navigation';
import { Badge } from '../positions/PositionRowView';
import type { Ledger } from '../services';
import { brokerLabel, useNames } from '../ui/labels';
import { Amount, Money, Units } from '../ui/Money';
import { Banner, Button, Card, Line } from '../ui/parts';
import { colors, space } from '../ui/theme';

/** "Série E" for a subscription's series (its code when the name is not known). */
export const seriesLabel = (ledger: Ledger, seriesId: string) => {
  const s = ledger.ca.series.find((x) => x.id === seriesId);
  return s ? s.name || `Série ${s.code}` : 'Certificado';
};

/**
 * The certificado subscriptions held today (docs/kpis.md §8): units, latest factor and its
 * month, value from factor, gain and the factor's age, red when over 35 days.
 */
export function CertificadosScreen() {
  const ledger = useLedger();
  const today = useToday();
  const navigation = useRootNavigation();
  const names = useNames(ledger.data ?? null);
  const subs = useMemo(() => {
    if (!ledger.data) return null;
    try {
      return certificadoSubscriptions({
        transactions: ledger.data.transactions,
        asOf: today,
        ca: {
          subscriptions: ledger.data.ca.subscriptions,
          factors: createCaFactorLookup(ledger.data.ca.factors),
        },
      });
    } catch (e) {
      return { error: errorCode(e) };
    }
  }, [ledger.data, today]);

  let body;
  if (ledger.isError) {
    body = (
      <Banner tone="error">Could not load the certificados ({errorCode(ledger.error)}).</Banner>
    );
  } else if (!ledger.data || !subs) {
    body = <Text style={styles.status}>Loading…</Text>;
  } else if ('error' in subs) {
    body = <Banner tone="error">The certificados could not be valued ({subs.error}).</Banner>;
  } else {
    const data = ledger.data;
    const stale = subs.filter((s) => s.stale).length;
    body = (
      <>
        {stale > 0 ? (
          <Banner tone="warning">
            {stale === 1 ? '1 subscription has' : `${stale} subscriptions have`} a factor more than
            35 days old: enter this month’s factors.
          </Banner>
        ) : null}
        {subs.length === 0 ? (
          <Card>
            <Text style={styles.muted}>No certificados held.</Text>
          </Card>
        ) : (
          subs.map((s) => (
            <Subscription
              key={s.subscriptionId}
              s={s}
              series={seriesLabel(data, s.seriesId)}
              broker={brokerLabel(names, s.accountId)}
            />
          ))
        )}
        <View style={styles.buttons}>
          <Button
            label="Update factors"
            onPress={() => navigation.navigate('FactorUpdate')}
            disabled={subs.length === 0}
          />
        </View>
      </>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={ledger.isRefetching} onRefresh={() => void ledger.refetch()} />
      }
    >
      {body}
    </ScrollView>
  );
}

function Subscription(props: { s: CertificadoSubscriptionView; series: string; broker: string }) {
  const { s } = props;
  return (
    <Card testID="ca-row">
      <Line
        label={`${props.series} · subscribed ${formatPeriod(s.subscribedOn.slice(0, 7))}`}
        strong
      >
        <Money value={s.valueEur} style={styles.strong} />
      </Line>
      <Text style={styles.muted}>{props.broker} · value from factor</Text>
      <Line label="Units held">
        <Units value={s.units} style={styles.value} />
      </Line>
      <Line
        label={
          s.factorMonth ? `Factor of ${formatPeriod(s.factorMonth.slice(0, 7))}` : 'No factor yet'
        }
      >
        <Amount value={s.unitValueEur} currency="EUR" dp={5} style={styles.value} />
      </Line>
      <Line label="Gain">
        <Money value={s.gainEur} sign colored style={styles.value} />
      </Line>
      <View style={styles.age}>
        <Text style={styles.muted}>
          {s.factorMonth
            ? `Factor ${s.ageDays} days old`
            : `Subscription price, ${s.ageDays} days old`}
        </Text>
        {s.stale ? <Badge text="over 35 days" tone="danger" /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.md, paddingBottom: space.xl },
  status: { textAlign: 'center', color: colors.muted, marginTop: space.xl },
  muted: { fontSize: 12, color: colors.muted, marginBottom: space.xs },
  value: { fontSize: 14, color: colors.text },
  strong: { fontSize: 15, fontWeight: '700', color: colors.text },
  age: { flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: space.xs },
  buttons: { marginHorizontal: space.lg },
});
