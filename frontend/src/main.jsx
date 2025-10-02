import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, ColorSchemeScript } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppShellLayout from './layout/AppShellLayout.jsx';
import ReferralPage from './pages/ReferralPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ChecklistPage from './pages/ChecklistPage.jsx';
import { LegacyApp } from './App.jsx';
import './app.css';
import theme from './theme.js';

createRoot(document.getElementById('root')).render(
  <MantineProvider defaultColorScheme="dark" theme={theme} withGlobalStyles>
    <ColorSchemeScript />
    <Notifications position="top-right" />
    <BrowserRouter>
      <AppShellLayout>
        <Routes>
          <Route path="/" element={<ReferralPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/checklist" element={<ChecklistPage />} />
          <Route path="/legacy" element={<LegacyApp />} />
        </Routes>
      </AppShellLayout>
    </BrowserRouter>
  </MantineProvider>
);
