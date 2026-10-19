import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MfaSetup } from './auth/MfaSetup';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MfaSetup />
  </StrictMode>,
);
