// Moves around the app the way a person does, for the screen tests.
import { fireEvent, screen, within } from '@testing-library/react-native';

/** The menu button in the header. */
export const openDrawer = () => fireEvent.press(screen.getByLabelText('Open menu'));

/** Certificados live in the drawer. */
export async function goToCertificados() {
  await openDrawer();
  const drawer = await screen.findByTestId('drawer-panel');
  await fireEvent.press(within(drawer).getByText('Certificados'));
}

/** The raised round button in the middle of the tab bar. */
export const goToNew = () => fireEvent.press(screen.getByTestId('new-transaction-button'));
