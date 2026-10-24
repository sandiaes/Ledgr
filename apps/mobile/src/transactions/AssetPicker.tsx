import type { AssetRecord } from '@ledgr/client';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../positions/PositionRowView';
import { Button, Field } from '../ui/parts';
import { space, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';

const MAX_SHOWN = 8;

/** "price pending": no price symbol yet, so no closes (valued at its trade price, #25). */
export const pricePending = (a: AssetRecord) => a.priceSource === 'manual';

/** Search over ticker, name and ISIN among the assets offered; "Add asset" at the bottom. */
export function AssetPicker(props: {
  assets: readonly AssetRecord[];
  selected: AssetRecord | null;
  onSelect(assetId: string): void;
  /** Not offered for a sale (you cannot sell what is not in the ledger). */
  onAddAsset?: () => void;
  error?: string;
  /** Shown when there is nothing to pick (e.g. nothing held to sell). */
  emptyText: string;
}) {
  const styles = useStyles(makeStyles);
  const [query, setQuery] = useState('');
  // Searching when asked to, or while nothing is picked (an asset just added appears in the
  // ledger a moment after its save resolves).
  const [changing, setChanging] = useState(false);
  const open = changing || props.selected === null;
  const setOpen = setChanging;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = props.assets.filter(
      (a) =>
        q === '' ||
        a.ticker?.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.isin?.toLowerCase().includes(q),
    );
    return [...list].sort((a, b) => (a.ticker ?? a.name).localeCompare(b.ticker ?? b.name));
  }, [props.assets, query]);

  if (props.selected && !open) {
    const a = props.selected;
    return (
      <View style={styles.block}>
        <Text style={styles.label}>Asset</Text>
        <View style={styles.selected}>
          <View style={styles.flex}>
            <Text style={styles.ticker}>
              {a.ticker || a.name} {pricePending(a) ? <Badge text="price pending" /> : null}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              {a.name}
              {a.isin ? ` · ${a.isin}` : ''}
            </Text>
          </View>
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.link}>Change</Text>
          </Pressable>
        </View>
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <Field
        label="Asset"
        value={query}
        onChangeText={setQuery}
        placeholder="Search ticker, name or ISIN"
        autoCapitalize="none"
        error={props.error}
      />
      {props.assets.length === 0 ? <Text style={styles.muted}>{props.emptyText}</Text> : null}
      {matches.slice(0, MAX_SHOWN).map((a) => (
        <Pressable
          key={a.id}
          onPress={() => {
            props.onSelect(a.id);
            setOpen(false);
            setQuery('');
          }}
          accessibilityRole="button"
          accessibilityLabel={`Pick ${a.ticker || a.name}`}
          style={styles.option}
        >
          <Text style={styles.ticker}>
            {a.ticker || a.name} {pricePending(a) ? <Badge text="price pending" /> : null}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {a.name}
            {a.isin ? ` · ${a.isin}` : ''}
          </Text>
        </Pressable>
      ))}
      {matches.length > MAX_SHOWN ? (
        <Text style={styles.muted}>{matches.length - MAX_SHOWN} more: keep typing.</Text>
      ) : null}
      {props.onAddAsset ? (
        <Button label="Add asset" kind="plain" onPress={props.onAddAsset} />
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    block: { marginBottom: space.md },
    label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
    selected: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    flex: { flex: 1 },
    ticker: { fontSize: 15, fontWeight: '600', color: colors.text },
    muted: { fontSize: 12, color: colors.muted },
    link: { color: colors.accent, fontWeight: '600' },
    error: { fontSize: 13, color: colors.loss, marginTop: 4 },
    option: {
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
  });
