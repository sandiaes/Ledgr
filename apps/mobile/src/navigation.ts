import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/** The screens above the tabs (docs/app-plan.md §1). */
export type RootStackParams = {
  Tabs: undefined;
  PositionDetail: { assetId: string };
  AssetTransactions: { assetId: string };
  BrokerDetail: { accountId: string };
  Allocation: undefined;
  Performance: undefined;
  ClosedPositions: undefined;
  TransactionDetail: { id: string };
  EditTransaction: { id: string };
  Certificados: undefined;
  FactorUpdate: undefined;
  Settings: undefined;
};

export const useRootNavigation = () => useNavigation<NativeStackNavigationProp<RootStackParams>>();

export const useRootRoute = <K extends keyof RootStackParams>() =>
  useRoute<RouteProp<RootStackParams, K>>();
