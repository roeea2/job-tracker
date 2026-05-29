/**
 * Re-visits every job in the DB that is missing company name or description
 * and fills them in from the LinkedIn job page.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, getAllJobs } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = join(__dirname, '..', 'data', 'chrome-profile');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function extractJobPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(4000);

    // Page title format: "Job Title | Company Name | LinkedIn"
    const pageTitle = await page.title();
    const titleParts = pageTitle.split(' | ');
    const company = titleParts.length >= 2 ? titleParts[titleParts.length - 2].trim() : '';

    // Description — look broadly for the largest text block on the page
    const description = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('div, section, article'));
      let best = '';
      for (const el of candidates) {
        const text = (el.innerText || '').trim();
        // Job descriptions are usually 200-3000 chars, avoid nav/header noise
        if (text.length > best.length && text.length > 200 && text.length < 8000) {
          // Must contain job-like keywords to avoid picking up nav
          if (/responsibilities|requirements|qualifications|experience|about|role|join|team/i.test(text)) {
            best = text;
          }
        }
      }
      return best.slice(0, 3000);
    });

    return { company, description };
  } catch (err) {
    console.error(`  Error fetching ${url}: ${err.message}`);
    return { company: '', description: '' };
  }
}

async function cleanTitle(title) {
  // Remove " with verification" suffix LinkedIn appends
  return title.replace(/\s+with verification$/i, '').trim();
}

export async function enrichJobs() {
  const jobs = getAllJobs();
  const toEnrich = jobs.filter(j => !j.company || !j.description);

  if (!toEnrich.length) {
    console.log('All jobs already enriched.');
    return;
  }

  console.log(`\nEnriching ${toEnrich.length} jobs with missing company/description...\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: CHROME_PATH,
    headless: false,
    slowMo: 30,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-sync'],
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  const db = getDb();

  for (const job of toEnrich) {
    process.stdout.write(`  [${toEnrich.indexOf(job) + 1}/${toEnrich.length}] ${job.title.slice(0, 50)}... `);
    const { company, description } = await extractJobPage(page, job.url);
    const cleanedTitle = await cleanTitle(job.title);

    db.prepare(`UPDATE jobs SET company = ?, description = ?, title = ? WHERE id = ?`)
      .run(company || job.company || 'Unknown', description || job.description || '', cleanedTitle, job.id);

    console.log(company ? `✓ ${company}` : '(no company found)');
    await page.waitForTimeout(1500 + Math.random() * 1000);
  }

  await context.close();
  console.log('\nEnrichment complete.\n');
}

// Run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  enrichJobs().catch(console.error);
}
