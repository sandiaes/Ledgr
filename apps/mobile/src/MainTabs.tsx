import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ComponentProps } from 'react';
import { ActivityScreen } from './activity/ActivityScreen';
import { TransactionDetailScreen } from './activity/TransactionDetailScreen';
import { AllocationScreen } from './allocation/AllocationScreen';
import { CertificadosScreen } from './certificados/CertificadosScreen';
import { FactorUpdateScreen } from './certificados/FactorUpdateScreen';
import { DashboardScreen } from './dashboard/DashboardScreen';
import type { RootStackParams } from './navigation';
import { PerformanceScreen } from './performance/PerformanceScreen';
import { AssetTransactionsScreen } from './positions/AssetTransactionsScreen';
import { BrokerDetailScreen } from './positions/BrokerDetailScreen';
import { ClosedPositionsScreen } from './positions/ClosedPositionsScreen';
import { PositionDetailScreen } from './positions/PositionDetailScreen';
import { PositionsScreen } from './positions/PositionsScreen';
import { MoreScreen } from './screens/MoreScreen';
import { SettingsScreen } from './settings/SettingsScreen';
import { EditTransactionScreen } from './transactions/EditTransactionScreen';
import { NewTransactionScreen } from './transactions/NewTransactionScreen';
import { EyeButton } from './ui/EyeButton';
import { useTheme } from './ui/ThemeProvider';

type IconName = ComponentProps<typeof Ionicons>['name'];
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParams>();
const icon =
  (name: IconName) =>
  ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );

const eye = () => <EyeButton />;

function Tabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerRight: eye,
        tabBarActiveTintColor: colors.tabBar.active,
        tabBarInactiveTintColor: colors.tabBar.inactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar.background,
          borderTopColor: colors.tabBar.border,
        },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: icon('home-outline') }}
      />
      <Tab.Screen
        name="Positions"
        component={PositionsScreen}
        options={{ tabBarIcon: icon('list-outline') }}
      />
      <Tab.Screen
        name="New"
        component={NewTransactionScreen}
        options={{
          title: 'New transaction',
          tabBarLabel: 'New',
          tabBarIcon: icon('add-circle-outline'),
        }}
      />
      <Tab.Screen
        name="Activity"
        component={ActivityScreen}
        options={{ tabBarIcon: icon('time-outline') }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{ tabBarIcon: icon('ellipsis-horizontal'), headerRight: undefined }}
      />
    </Tab.Navigator>
  );
}

/** The tabs, with the detail screens stacked above them (docs/app-plan.md §1). */
export function MainTabs() {
  const { colors, scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        screenOptions={{
          headerRight: eye,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="Tabs"
          component={Tabs}
          options={{ headerShown: false, headerRight: undefined }}
        />
        <Stack.Screen
          name="PositionDetail"
          component={PositionDetailScreen}
          options={{ title: 'Position' }}
        />
        <Stack.Screen
          name="AssetTransactions"
          component={AssetTransactionsScreen}
          options={{ title: 'Transactions' }}
        />
        <Stack.Screen
          name="BrokerDetail"
          component={BrokerDetailScreen}
          options={{ title: 'Broker' }}
        />
        <Stack.Screen name="Allocation" component={AllocationScreen} />
        <Stack.Screen name="Performance" component={PerformanceScreen} />
        <Stack.Screen
          name="ClosedPositions"
          component={ClosedPositionsScreen}
          options={{ title: 'Closed positions' }}
        />
        <Stack.Screen
          name="TransactionDetail"
          component={TransactionDetailScreen}
          options={{ title: 'Transaction' }}
        />
        <Stack.Screen
          name="EditTransaction"
          component={EditTransactionScreen}
          options={{ title: 'Edit transaction' }}
        />
        <Stack.Screen name="Certificados" component={CertificadosScreen} />
        <Stack.Screen
          name="FactorUpdate"
          component={FactorUpdateScreen}
          options={{ title: 'Monthly factors' }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ headerRight: undefined }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
