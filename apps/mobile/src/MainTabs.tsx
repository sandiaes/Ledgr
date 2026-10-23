import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ComponentProps } from 'react';
import { AllocationScreen } from './allocation/AllocationScreen';
import { DashboardScreen } from './dashboard/DashboardScreen';
import type { RootStackParams } from './navigation';
import { PerformanceScreen } from './performance/PerformanceScreen';
import { AssetTransactionsScreen } from './positions/AssetTransactionsScreen';
import { BrokerDetailScreen } from './positions/BrokerDetailScreen';
import { ClosedPositionsScreen } from './positions/ClosedPositionsScreen';
import { PositionDetailScreen } from './positions/PositionDetailScreen';
import { PositionsScreen } from './positions/PositionsScreen';
import { MoreScreen } from './screens/MoreScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { EyeButton } from './ui/EyeButton';
import { colors } from './ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParams>();
const icon =
  (name: IconName) =>
  ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );

const NewTransactionScreen = () => <PlaceholderScreen title="New transaction" />;
const ActivityScreen = () => <PlaceholderScreen title="Activity" />;

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background },
};
const eye = () => <EyeButton />;

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.accent, headerRight: eye }}>
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
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator screenOptions={{ headerRight: eye }}>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
