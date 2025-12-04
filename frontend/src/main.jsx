import React from 'react';
import { createRoot } from 'react-dom/client';
// Mantine removed: using Tailwind + custom primitives
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppShellLayout from './layout/AppShellLayout.jsx';
import ReferralPage from './pages/ReferralPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ChecklistPage from './pages/ChecklistPage.jsx';
import OcrDebugPage from './pages/OcrDebugPage.jsx';
import RulesEditorPage from './pages/RulesEditorPage.jsx';
import BenchmarkPage from './pages/BenchmarkPage.jsx';
import AIAnalysisPage from './pages/AIAnalysisPage.jsx';
import './app.css';
import { NotificationsProvider, ToastBridge } from './ui/primitives.jsx';

createRoot(document.getElementById('root')).render(
  <NotificationsProvider>
    <ToastBridge />
    <BrowserRouter>
      <AppShellLayout>
        <Routes>
          <Route path="/" element={<ReferralPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/checklist" element={<ChecklistPage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          <Route path="/ai-analysis" element={<AIAnalysisPage />} />
          <Route path="/debug/ocr" element={<OcrDebugPage />} />
          <Route path="/admin/rules" element={<RulesEditorPage />} />
        </Routes>
      </AppShellLayout>
    </BrowserRouter>
  </NotificationsProvider>
);
