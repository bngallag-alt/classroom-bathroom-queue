import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';
import './button-overrides.css';
import './schedule.css';
import './setup.css';

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    const shouldUpdate = window.confirm(
      'An app update is ready. Reload now? Your current queue and active timer are stored locally and will be preserved.',
    );
    if (shouldUpdate) void updateServiceWorker(true);
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
