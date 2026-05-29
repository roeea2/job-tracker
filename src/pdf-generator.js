import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CVS_DIR = join(__dirname, '..', 'data', 'cvs');
mkdirSync(CVS_DIR, { recursive: true });

export function cvPdfPath(jobId) {
  return join(CVS_DIR, `job-${jobId}.pdf`);
}

export async function generatePdf(jobId, cvHtml, filenamePrefix = 'CV') {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent(cvHtml, { waitUntil: 'networkidle' });

  const pdfBuffer = await page.pdf({
    format:             'Letter',
    printBackground:    true,
    margin:             { top: '0', right: '0', bottom: '0', left: '0' },
  });

  await browser.close();

  const outPath = cvPdfPath(jobId);
  writeFileSync(outPath, pdfBuffer);
  return outPath;
}
