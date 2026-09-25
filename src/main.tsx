import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow-condensed/latin-900.css';
import { ConferenceProvider } from '@/lib/ConferenceContext';
import App from '@/ui/App';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import '@/ui/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><ConferenceProvider><App /></ConferenceProvider></ErrorBoundary></React.StrictMode>,
);
