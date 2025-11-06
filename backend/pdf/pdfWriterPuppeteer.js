// Minimal Puppeteer-based HTML -> PDF writer
// Usage: const buffer = await pdfWriter(html, { format: 'Letter' })

export async function pdfWriter(html, options = {}) {
  const puppeteer = await import('puppeteer');
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  // Allow binding to a system Chrome if Chromium wasn't downloaded
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Allow disabling no-sandbox flags if explicitly requested
  if (process.env.PUPPETEER_ENABLE_SANDBOX === '1') {
    launchOpts.args = (launchOpts.args || []).filter(a => !a.includes('no-sandbox'));
  }
  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
  } catch (e) {
    // Re-throw with clearer guidance so the caller can report a helpful message
    const hint = process.env.PUPPETEER_EXECUTABLE_PATH
      ? `Using system Chrome at ${process.env.PUPPETEER_EXECUTABLE_PATH}`
      : 'Set PUPPETEER_EXECUTABLE_PATH to your system Chrome if Chromium is unavailable';
    throw new Error(`puppeteer_launch_failed: ${e?.message || e}. Hint: ${hint}`);
  }
  try {
    const page = await browser.newPage();
    await page.setContent(String(html || ''), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: options.format || 'Letter',
      printBackground: true,
      margin: options.margin || { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
    });
    return pdf;
  } finally {
    try { await browser.close(); } catch {}
  }
}
