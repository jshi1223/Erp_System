import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';

// The classic anti-flicker CSS keeps the WHOLE body (and sidebar/header) visibility:hidden
// until auth-guard.js sets these readiness flags. We don't load auth-guard in React, so we
// set them ourselves — otherwise the page renders but stays invisible (blank white).
const html = document.documentElement;
html.dataset.businessEntityThemeReady = '1'; // un-hides the whole body (the blank-page fix)
html.dataset.businessEntityBrandTextReady = '1';
html.dataset.sidebarReady = '1';
html.dataset.dashboardCardsReady = '1';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* basename '/' — React pages live at the SAME real URLs as the classic ones. */}
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
