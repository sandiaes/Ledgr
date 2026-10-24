// Must be first: sets up the gesture handler before any screen or the drawer loads.
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
