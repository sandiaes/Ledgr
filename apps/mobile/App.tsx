import { AppRoot } from './src/AppRoot';
import { StartupErrorScreen } from './src/auth/screens';
import { appEnv, checkConfig } from './src/config';
import { createDeviceServices } from './src/deviceServices';
import type { Services } from './src/services';

// Checked before any Supabase client exists: a secret key never gets used.
const config = checkConfig(appEnv());
let services: Services | null = null;

export default function App() {
  if (!config.ok) return <StartupErrorScreen problem={config.problem} />;
  services ??= createDeviceServices(config);
  return <AppRoot services={services} />;
}
