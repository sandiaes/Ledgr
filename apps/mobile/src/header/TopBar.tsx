import type { Decimal } from '@ledgr/core';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatTime } from '../format';
import { useHideValues } from '../settings/SettingsProvider';
import { Amount } from '../ui/Amount';
import { Icon } from '../ui/Icon';
import { excludesCertificados } from '../ui/Scope';
import { Skeleton } from '../ui/Skeleton';
import { T } from '../ui/T';
import { HEADER_HEIGHT, space, TOUCH_TARGET, type Colors } from '../ui/theme';
import { useStyles } from '../ui/ThemeProvider';
import { useReduceMotion } from '../ui/useReduceMotion';
import { useHeaderState } from './HeaderState';
import { useHeaderFigures, type HeaderFigures } from './PortfolioSummary';

/** Android scales fonts with the system setting; the slim header stops at this. */
const MAX_FONT_SCALE = 1.3;

/** The privacy switch: the same setting as "Hide amounts" in the drawer. */
function EyeButton() {
  const [hidden, toggle] = useHideValues();
  return (
    <IconButton
      icon={hidden ? 'eyeOff' : 'eye'}
      label={hidden ? 'Show values' : 'Hide values'}
      onPress={toggle}
    />
  );
}

function IconButton(props: {
  icon: 'menu' | 'back' | 'eye' | 'eyeOff';
  label: string;
  onPress(): void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={styles.iconButton}
    >
      <Icon name={props.icon} />
    </Pressable>
  );
}

/** The "Excluding certificados" line, small and in the warning colour. */
function ScopeLine({ figures }: { figures: HeaderFigures }) {
  const styles = useStyles(makeStyles);
  if (figures.status !== 'ready' || !excludesCertificados(figures.excludeTypes)) return null;
  return (
    <T variant="caption" tone="warning" style={styles.scope} testID="header-scope-note">
      Excluding certificados
    </T>
  );
}

/**
 * The collapsed bar, 56 dp below the status bar: a menu or back button on the left, the
 * portfolio value in the centre (tap it to expand or collapse the panel) and the privacy
 * eye on the right.
 */
export function HeaderBar(props: { mode: 'menu' | 'back'; onLeading(): void }) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { expanded, toggle } = useHeaderState();
  const figures = useHeaderFigures();

  let value;
  if (figures.status === 'loading') value = <Skeleton width={120} height={24} />;
  else if (figures.status === 'ready')
    value = (
      <Amount
        value={figures.valueEur}
        variant="title2"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      />
    );
  else
    value = (
      <T variant="title2" figure>
        —
      </T>
    );

  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + HEADER_HEIGHT }]}>
      <IconButton
        icon={props.mode === 'menu' ? 'menu' : 'back'}
        label={props.mode === 'menu' ? 'Open menu' : 'Back'}
        onPress={props.onLeading}
      />
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded ? 'Portfolio value, hide details' : 'Portfolio value, show details'
        }
        style={styles.center}
        testID="header-value"
      >
        <View style={styles.valueRow}>
          {value}
          <Icon name={expanded ? 'collapse' : 'expand'} size={16} tone="muted" />
        </View>
        <ScopeLine figures={figures} />
      </Pressable>
      <EyeButton />
    </View>
  );
}

function Figure(props: { label: string; eur: Decimal | null; pct: Decimal | null }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.figure}>
      <T variant="overline" tone="muted">
        {props.label}
      </T>
      <Amount
        value={props.eur}
        sign
        tone
        variant="headline"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      />
      <Amount
        kind="pct"
        value={props.pct}
        sign
        tone
        variant="sub"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      />
    </View>
  );
}

function PanelBody({ figures }: { figures: HeaderFigures }) {
  const styles = useStyles(makeStyles);
  if (figures.status === 'loading') {
    return (
      <View style={styles.body}>
        <Skeleton width="50%" height={40} />
        <Skeleton height={64} />
      </View>
    );
  }
  if (figures.status === 'error') {
    return (
      <View style={styles.body}>
        <T variant="sub" tone="muted">
          Could not load the figures ({figures.code}).
        </T>
      </View>
    );
  }
  if (figures.status === 'unvalued') {
    const year = figures.today.slice(0, 4);
    return (
      <View style={styles.body}>
        <T variant="sub" tone="muted">
          No exchange rate for {figures.currencies.join(', ')} on {formatDate(figures.date, year)}:
          the figures cannot be shown until the next rate is stored.
        </T>
      </View>
    );
  }
  return (
    <View style={styles.body}>
      <View>
        <T variant="overline" tone="muted">
          Portfolio value
        </T>
        <Amount
          value={figures.valueEur}
          variant="display"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
        />
      </View>
      <View style={styles.figures}>
        <Figure label="Today's result" eur={figures.dayEur} pct={figures.dayPct} />
        <Figure label="Total result" eur={figures.totalEur} pct={figures.totalPct} />
      </View>
      <T variant="caption" tone={excludesCertificados(figures.excludeTypes) ? 'warning' : 'faint'}>
        {excludesCertificados(figures.excludeTypes) ? 'Excluding certificados · ' : ''}as of{' '}
        {formatTime(figures.asOf)}
      </T>
    </View>
  );
}

/**
 * The expanded details, sliding down over the screen from under the bar. An overlay, not a
 * push: nothing below it re-lays out, so scroll positions stay. It animates `transform` and
 * `opacity` for 180 ms and jumps when the phone has "Remove animations" on.
 */
export function HeaderPanel() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { expanded } = useHeaderState();
  const figures = useHeaderFigures();
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(expanded);
  const [height, setHeight] = useState(240);

  useEffect(() => {
    if (expanded) setMounted(true);
  }, [expanded]);

  useEffect(() => {
    const target = expanded ? 1 : 0;
    if (reduce) {
      progress.setValue(target);
      if (!expanded) setMounted(false);
      return;
    }
    if (!mounted) return;
    const run = Animated.timing(progress, {
      toValue: target,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished && !expanded) setMounted(false);
    });
    return () => run.stop();
  }, [expanded, mounted, reduce, progress]);

  if (!mounted) return null;
  return (
    <Animated.View
      testID="header-panel"
      pointerEvents={expanded ? 'auto' : 'none'}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={[
        styles.panel,
        { top: insets.top + HEADER_HEIGHT },
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] }) },
          ],
        },
      ]}
    >
      <PanelBody figures={figures} />
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      paddingHorizontal: space.xs,
    },
    iconButton: {
      width: TOUCH_TARGET,
      height: TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: TOUCH_TARGET },
    valueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    scope: { marginTop: -space.hairline },
    // Over the screen, under the bar: `top` is set from the safe-area inset.
    panel: {
      position: 'absolute',
      left: 0,
      right: 0,
      backgroundColor: colors.raised,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      zIndex: 10,
    },
    body: { padding: space.lg, gap: space.lg },
    figures: { flexDirection: 'row', gap: space.lg },
    figure: { flex: 1, gap: space.hairline },
  });
