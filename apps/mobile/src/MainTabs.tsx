import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator, type DrawerContentComponentProps } from '@react-navigation/drawer';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useWindowDimensions } from 'react-native';
import { ActivityScreen } from './activity/ActivityScreen';
import { TransactionDetailScreen } from './activity/TransactionDetailScreen';
import { AllocationScreen } from './allocation/AllocationScreen';
import { CalculatorScreen } from './calculator/CalculatorScreen';
import { CertificadosScreen } from './certificados/CertificadosScreen';
import { FactorUpdateScreen } from './certificados/FactorUpdateScreen';
import { DashboardScreen } from './dashboard/DashboardScreen';
import { DrawerPanel } from './drawer/DrawerPanel';
import { HeaderStateProvider } from './header/HeaderState';
import { PortfolioSummaryProvider } from './header/PortfolioSummary';
import { MenuFrame, withBackFrame } from './header/ScreenFrame';
import { TabBar } from './nav/TabBar';
import type { RootStackParams } from './navigation';
import { PerformanceScreen } from './performance/PerformanceScreen';
import { AssetTransactionsScreen } from './positions/AssetTransactionsScreen';
import { BrokerDetailScreen } from './positions/BrokerDetailScreen';
import { PositionDetailScreen } from './positions/PositionDetailScreen';
import { PositionsScreen } from './positions/PositionsScreen';
import { EditTransactionScreen } from './transactions/EditTransactionScreen';
import { NewTransactionScreen } from './transactions/NewTransactionScreen';
import { radius } from './ui/theme';
import { useTheme } from './ui/ThemeProvider';

const Tab = createBottomTabNavigator();
const Drawer = createDrawerNavigator();
const Stack = createNativeStackNavigator<RootStackParams>();

const DRAWER_MAX_WIDTH = 320;

// Pushed screens get the shared header in back mode and an in-content title.
const PositionDetail = withBackFrame(PositionDetailScreen, 'Position');
const AssetTransactions = withBackFrame(AssetTransactionsScreen, 'Transactions');
const BrokerDetail = withBackFrame(BrokerDetailScreen, 'Broker');
const Allocation = withBackFrame(AllocationScreen, 'Allocation');
const Performance = withBackFrame(PerformanceScreen, 'Performance');
const TransactionDetail = withBackFrame(TransactionDetailScreen, 'Transaction');
const EditTransaction = withBackFrame(EditTransactionScreen, 'Edit transaction');
const Certificados = withBackFrame(CertificadosScreen, 'Certificados');
const FactorUpdate = withBackFrame(FactorUpdateScreen, 'Monthly factors');

const renderTabBar = (props: Parameters<typeof TabBar>[0]) => <TabBar {...props} />;
const renderDrawer = (props: DrawerContentComponentProps) => (
  <DrawerPanel closeDrawer={() => props.navigation.closeDrawer()} />
);

function Tabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      tabBar={renderTabBar}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Positions" component={PositionsScreen} />
      <Tab.Screen name="New" component={NewTransactionScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Calculator" component={CalculatorScreen} />
    </Tab.Navigator>
  );
}

/** The header above the five tabs; this is the drawer's one screen. */
function Layout() {
  return (
    <MenuFrame>
      <Tabs />
    </MenuFrame>
  );
}

/** The side drawer (scrim, backdrop tap, swipe and Android back close it) around the layout. */
function MainDrawer() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  return (
    <Drawer.Navigator
      drawerContent={renderDrawer}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        overlayColor: colors.scrim,
        drawerStyle: {
          width: Math.min(DRAWER_MAX_WIDTH, width * 0.85),
          backgroundColor: colors.raised,
          borderTopRightRadius: radius.lg,
          borderBottomRightRadius: radius.lg,
        },
      }}
    >
      <Drawer.Screen name="Layout" component={Layout} />
    </Drawer.Navigator>
  );
}

/**
 * Stack → drawer → header + tabs, with the detail screens pushed above the drawer
 * (docs/app-plan.md §1, docs/design.md §6). The portfolio summary and the header's expanded
 * state live above the navigators, shared by every screen.
 */
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
    <HeaderStateProvider>
      <PortfolioSummaryProvider>
        <NavigationContainer theme={theme}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="Tabs" component={MainDrawer} />
            <Stack.Screen name="PositionDetail" component={PositionDetail} />
            <Stack.Screen name="AssetTransactions" component={AssetTransactions} />
            <Stack.Screen name="BrokerDetail" component={BrokerDetail} />
            <Stack.Screen name="Allocation" component={Allocation} />
            <Stack.Screen name="Performance" component={Performance} />
            <Stack.Screen name="TransactionDetail" component={TransactionDetail} />
            <Stack.Screen name="EditTransaction" component={EditTransaction} />
            <Stack.Screen name="Certificados" component={Certificados} />
            <Stack.Screen name="FactorUpdate" component={FactorUpdate} />
          </Stack.Navigator>
        </NavigationContainer>
      </PortfolioSummaryProvider>
    </HeaderStateProvider>
  );
}
