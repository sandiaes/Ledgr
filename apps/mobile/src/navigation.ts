import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/**
 * The screens above the drawer and tabs (docs/app-plan.md §1). `Tabs` is the drawer with the
 * header and the five tabs; every other route is a pushed detail screen.
 */
export type RootStackParams = {
  Tabs: undefined;
  PositionDetail: { assetId: string };
  AssetTransactions: { assetId: string };
  BrokerDetail: { accountId: string };
  Allocation: undefined;
  Performance: undefined;
  TransactionDetail: { id: string };
  EditTransaction: { id: string };
  Certificados: undefined;
  FactorUpdate: undefined;
};

export const useRootNavigation = () => useNavigation<NativeStackNavigationProp<RootStackParams>>();

export const useRootRoute = <K extends keyof RootStackParams>() =>
  useRoute<RouteProp<RootStackParams, K>>();
