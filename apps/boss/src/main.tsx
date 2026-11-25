import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// iPhone home-screen app (standalone, translucent status bar): iOS can report a layout height that is
// short by the status-bar inset, so `height: 100%` ends ~59px above the bottom and the tab bar floats.
// In standalone portrait the app always owns the whole screen, so size it to the screen instead.
// navigator.standalone exists only on iOS; Android PWAs/APK keep using innerHeight (their screen.height includes system bars).
const standalone = (navigator as { standalone?: boolean }).standalone === true;
function fitHeight() {
  const portrait = innerHeight > innerWidth;
  const h = standalone && portrait ? Math.max(innerHeight, screen.height) : innerHeight;
  document.documentElement.style.setProperty('--app-h', `${h}px`);
}
fitHeight();
addEventListener('resize', fitHeight);
addEventListener('orientationchange', () => setTimeout(fitHeight, 300));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service workers need a secure context (HTTPS or localhost); on plain LAN HTTP the app still works without it.
if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
