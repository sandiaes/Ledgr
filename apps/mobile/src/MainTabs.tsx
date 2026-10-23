import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import type { ComponentProps } from 'react';
import { DashboardScreen } from './dashboard/DashboardScreen';
import { MoreScreen } from './screens/MoreScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { EyeButton } from './ui/EyeButton';
import { colors } from './ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const Tab = createBottomTabNavigator();
const icon =
  (name: IconName) =>
  ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );

const PositionsScreen = () => <PlaceholderScreen title="Positions" />;
const NewTransactionScreen = () => <PlaceholderScreen title="New transaction" />;
const ActivityScreen = () => <PlaceholderScreen title="Activity" />;

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background },
};

export function MainTabs() {
  return (
    <NavigationContainer theme={theme}>
      <Tab.Navigator
        screenOptions={{
          tabBarActiveTintColor: colors.accent,
          headerRight: () => <EyeButton />,
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
    </NavigationContainer>
  );
}
