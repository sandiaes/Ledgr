import type { AssetRecord } from '@ledgr/client';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '../positions/PositionRowView';
import { Button, Field } from '../ui/parts';
import { T } from '../ui/T';
import { space, TOUCH_TARGET, type Colors } from '../ui/theme';
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
        <T variant="overline" tone="muted" style={styles.label}>
          Asset
        </T>
        <View style={styles.selected}>
          <View style={styles.flex}>
            <T variant="headline">
              {a.ticker || a.name} {pricePending(a) ? <Badge text="price pending" /> : null}
            </T>
            <T variant="sub" tone="muted" numberOfLines={1}>
              {a.name}
              {a.isin ? ` · ${a.isin}` : ''}
            </T>
          </View>
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Change asset"
            style={styles.change}
          >
            <T variant="headline" tone="accent">
              Change
            </T>
          </Pressable>
        </View>
        {props.error ? (
          <T variant="sub" tone="loss" style={styles.error}>
            {props.error}
          </T>
        ) : null}
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
      {props.assets.length === 0 ? (
        <T variant="sub" tone="muted">
          {props.emptyText}
        </T>
      ) : null}
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
          <T variant="headline">
            {a.ticker || a.name} {pricePending(a) ? <Badge text="price pending" /> : null}
          </T>
          <T variant="sub" tone="muted" numberOfLines={1}>
            {a.name}
            {a.isin ? ` · ${a.isin}` : ''}
          </T>
        </Pressable>
      ))}
      {matches.length > MAX_SHOWN ? (
        <T variant="sub" tone="muted">
          {matches.length - MAX_SHOWN} more: keep typing.
        </T>
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
    label: { marginBottom: space.xs },
    selected: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    flex: { flex: 1 },
    error: { marginTop: space.xs },
    change: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
    option: {
      minHeight: 48,
      justifyContent: 'center',
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
  });
