import React from 'react';
import { createRoot } from 'react-dom/client';
// Mantine removed: using Tailwind + custom primitives
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppShellLayout from './layout/AppShellLayout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ReferralPage from './pages/ReferralPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ChecklistPage from './pages/ChecklistPage.jsx';
import AIAnalysisPage from './pages/AIAnalysisPage.jsx';
import './app.css';
import { NotificationsProvider, ToastBridge } from './ui/primitives.jsx';

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <NotificationsProvider>
      <ToastBridge />
      <BrowserRouter>
        <AppShellLayout>
          <Routes>
            <Route path="/" element={<ReferralPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/checklist" element={<ChecklistPage />} />
            <Route path="/ai-analysis" element={<AIAnalysisPage />} />
          </Routes>
        </AppShellLayout>
      </BrowserRouter>
    </NotificationsProvider>
  </ErrorBoundary>
);
