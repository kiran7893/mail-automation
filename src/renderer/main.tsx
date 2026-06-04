import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installBrowserMock } from './browserMock';
import './styles.css';

installBrowserMock();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
