// Deprecated legacy Analytics component. Mantine version now lives at pages/AnalyticsPage.jsx
// This stub preserves backward compatibility for old imports like `import Analytics from './Analytics'`.
import AnalyticsPage from './pages/AnalyticsPage.jsx';
// Temporary shim: will be removed once all imports updated.
if (import.meta?.env?.MODE === 'development') {
	// eslint-disable-next-line no-console
	console.warn('[deprecated] Import AnalyticsPage from pages/AnalyticsPage.jsx instead of root Analytics.jsx');
}
export default AnalyticsPage;
