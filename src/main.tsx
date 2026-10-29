import React from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import './fonts.css';
import './styles.css';
import './surfaces.css';
import './desk.css';
import './mobile.css';
import { isDesktop, isMobile } from './desktop';
import { watchInsets } from './insets';
// Прозрачное окно-виджет — только в приложении на компьютере.
document.documentElement.dataset.native = String(isDesktop());
document.documentElement.dataset.mobile = String(isMobile());
// Windows 7 и 8 (NT 6.x): окно там непрозрачное (src-tauri/tauri.win7.conf.json),
// поэтому виджет заливается фоном темы, а не белым.
document.documentElement.dataset.opaque = String(/Windows NT 6\./.test(navigator.userAgent));
watchInsets();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>,
);
