import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppProvider } from './contexts/AppContext';
import '@fontsource-variable/geist';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installApiBridge, waitForServer } from './services/apiBridge';

installApiBridge();

const root = document.getElementById('root')!;
root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888;font-size:14px">Starting LumiOS...</div>';

async function boot() {
  try {
    const serverReady = await waitForServer(12000);
    if (!serverReady) {
      root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888"><p>Waiting for LumiOS server...</p></div>';
      const ok = await waitForServer(30000);
      if (!ok) {
        root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#c44"><p>Server unreachable.<br/><small>Check that LumiOS is allowed through your firewall.</small></p></div>';
        return;
      }
    }
    createRoot(root).render(
      <StrictMode>
        <ErrorBoundary>
          <AppProvider>
            <App />
          </AppProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (e: any) {
    root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#c44"><p>Startup error: ' + (e.message || e) + '</p></div>';
  }
}

boot();
