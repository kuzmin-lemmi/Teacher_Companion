import React from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import './fonts.css';
import './styles.css';
import './surfaces.css';
import { isDesktop, isMobile } from './desktop';
// Прозрачное окно-виджет — только в приложении на компьютере.
document.documentElement.dataset.native = String(isDesktop());
document.documentElement.dataset.mobile = String(isMobile());
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>,
);
