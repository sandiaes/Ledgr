import type { Decimal } from '@ledgr/core';
import type { StyleProp, TextStyle } from 'react-native';
import { Amount } from './Amount';

// Thin wrappers over `Amount` for the screens U2 and U3 have not restyled yet (docs/design.md
// §8). They format nothing themselves, so privacy still masks everything they show.

/** An amount in EUR; `colored` is green/red by sign. */
export function Money(props: {
  value: Decimal | null;
  sign?: boolean;
  colored?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return <Amount value={props.value} sign={props.sign} tone={props.colored} style={props.style} />;
}

/** A number of units (shares, coins, certificado units). */
export function Units(props: { value: Decimal | null; style?: StyleProp<TextStyle> }) {
  return <Amount kind="units" value={props.value} style={props.style} />;
}

/** A percentage; masked with the amounts (decision D2). */
export function Pct(props: {
  value: Decimal | null;
  sign?: boolean;
  colored?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Amount
      kind="pct"
      value={props.value}
      sign={props.sign}
      tone={props.colored}
      style={props.style}
    />
  );
}
