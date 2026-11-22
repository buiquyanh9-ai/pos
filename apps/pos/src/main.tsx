import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './hardware'; // registers hardware drivers
import { App } from './App';
import { startSync } from './lib/store';
import './styles.css';
import './screens.css';
import './sale.css';

startSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
