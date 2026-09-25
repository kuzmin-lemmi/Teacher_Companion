import React from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import './fonts.css';
import './styles.css';
import './surfaces.css';
import { isTauri } from '@tauri-apps/api/core';
document.documentElement.dataset.native = String(isTauri());
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>,
);
