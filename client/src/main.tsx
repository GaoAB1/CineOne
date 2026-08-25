/**
 * React 入口：挂载 App + ThemeProvider + AuthProvider。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import 'remixicon/fonts/remixicon.css';
import './styles/tokens.css';
import './styles/global.css';
import App from './App';
import { ThemeProvider } from './stores/ThemeContext';
import { AuthProvider } from './stores/AuthContext';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('未找到 #root 挂载点');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
