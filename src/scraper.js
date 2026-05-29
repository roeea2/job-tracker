import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { upsertJob, logScrapeRun } from './db.js';
import { search as searchConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SEARCHES      = searchConfig.searches;
const SENIOR_SIGNALS = searchConfig.seniorSignals;
const ROLE_SIGNALS   = searchConfig.roleSignals;
const DOMAIN_SIGNALS = searchConfig.domainSignals;

function scoreJob(title, description) {
  const combined = (title + ' ' + (description || '')).toLowerCase();
  let score = 0;

  if (SENIOR_SIGNALS.some(s => combined.includes(s))) score += 40;

  // Role signals — each matched role type adds points
  const roleScores = { customer_success: 20, ai_engineering: 15, product: 15, support: 10 };
  for (const [type, signals] of Object.entries(ROLE_SIGNALS)) {
    if (signals.some(s => combined.includes(s))) score += roleScores[type] ?? 10;
  }

  // Domain signals
  if (DOMAIN_SIGNALS.some(s => combined.includes(s))) score += 5;

  return Math.min(score, 100);
}

function detectSeniority(title) {
  const t = title.toLowerCase();
  if (t.includes('chief') || t.includes('cco') || t.includes('cpo') || t.includes('cto')) return 'C-Level';
  if (t.includes('evp') || t.includes('svp') || t.includes('vp') || t.includes('vice president')) return 'VP';
  if (t.includes('director')) return 'Director';
  if (t.includes('head of')) return 'Head Of';
  return 'Senior';
}

async function saveCookies(context) {
  const cookies = await context.cookies();
  writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log('  Cookies saved.');
}

async function loadCookies(context) {
  if (!existsSync(COOKIES_PATH)) return false;
  const cookies = JSON.parse(readFileSync(COOKIES_PATH, 'utf-8'));
  await context.addCookies(cookies);
  return true;
}

async function isLoggedIn(page) {
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    return page.url().includes('/feed') || page.url().includes('/in/');
  } catch {
    return false;
  }
}

async function scrapeJobDetails(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const description = await page.evaluate(() => {
      const el = document.querySelector('.jobs-description-content__text, .description__text, [class*="description"]');
      return el ? el.innerText.trim().slice(0, 3000) : '';
    });
    return description;
  } catch {
    return '';
  }
}

async function runSearch(page, search) {
  const { keywords, role_type } = search;
  const jobs = [];

  // LinkedIn jobs search URL — Israel, all experience levels, past month
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(searchConfig.location)}&f_TPR=r2592000&sortBy=R`;

  console.log(`\n  Searching: "${keywords}"`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Scroll to load more results
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1000);
  }

  const cards = await page.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll(
      '.jobs-search-results__list-item, li[data-occludable-job-id], .job-search-card, .base-card'
    );

    items.forEach(item => {
      // Title
      const titleEl = item.querySelector(
        '.job-card-list__title--link, .job-card-list__title, .base-search-card__title, a[aria-label]'
      );
      // Company
      const companyEl = item.querySelector(
        '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .base-search-card__subtitle, .job-card-list__company-name'
      );
      // Location
      const locationEl = item.querySelector(
        '.job-card-container__metadata-item--workplace-type, .job-card-container__metadata-item, .job-search-card__location, .artdeco-entity-lockup__caption'
      );
      // Link
      const linkEl = item.querySelector('a[href*="/jobs/view/"]') || item.querySelector('a[href*="linkedin.com/jobs"]');

      if (!linkEl) return;

      const href = linkEl.href || linkEl.getAttribute('href') || '';
      const jobIdMatch = href.match(/\/jobs\/view\/(\d+)/);
      if (!jobIdMatch) return;

      // Clean title — strip " with verification" and aria-label noise
      let title = (titleEl?.innerText || titleEl?.textContent || titleEl?.getAttribute('aria-label') || '').trim();
      title = title.replace(/\s+with verification$/i, '').trim();
      if (!title) return;

      results.push({
        title,
        company:     (companyEl?.innerText || companyEl?.textContent || '').trim(),
        location:    (locationEl?.innerText || locationEl?.textContent || '').trim(),
        url:         'https://www.linkedin.com/jobs/view/' + jobIdMatch[1] + '/',
        linkedin_id: jobIdMatch[1],
      });
    });

    return results;
  });

  console.log(`    Found ${cards.length} cards`);

  for (const card of cards.slice(0, 10)) {
    if (!card.title || !card.url) continue;

    const seniority = detectSeniority(card.title);
    const description = await scrapeJobDetails(page, card.url);
    const match_score = scoreJob(card.title, description);

    jobs.push({
      ...card,
      description,
      seniority,
      role_type,
      match_score,
    });

    await page.waitForTimeout(1500 + Math.random() * 1000);
  }

  return jobs;
}

export async function runScraper() {
  console.log('\n=== LinkedIn Job Scraper Starting ===\n');

  // Dedicated scraper Chrome profile — isolated from your running Chrome, no conflict.
  // First run: you log in manually. After that, session is saved in data/chrome-profile.
  const CHROME_PATH   = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const PROFILE_DIR   = join(__dirname, '..', 'data', 'chrome-profile');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: CHROME_PATH,
    headless: false,
    slowMo: 30,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-sync'],
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();

  if (!(await isLoggedIn(page))) {
    console.log('\n  First-time setup: please log in to LinkedIn in the Chrome window that just opened.');
    console.log('  Waiting automatically — will continue once you are logged in...\n');
    await page.goto('https://www.linkedin.com/login');

    // Poll until LinkedIn feed is reached (user logged in)
    let loggedIn = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(3000);
      const url = page.url();
      if (url.includes('/feed') || url.includes('/in/') || url.includes('/mynetwork')) {
        loggedIn = true;
        break;
      }
      process.stdout.write(`  Still waiting for login... (${(i + 1) * 3}s)\n`);
    }

    if (!loggedIn) {
      await context.close();
      throw new Error('LinkedIn login timed out after 3 minutes. Please try again.');
    }
    console.log('  Login detected! Session saved. Future runs will skip this step.\n');
  }

  console.log('  Logged in. Starting job search...\n');

  let totalFound = 0;
  let totalNew = 0;

  for (const search of SEARCHES) {
    try {
      const jobs = await runSearch(page, search);
      for (const job of jobs) {
        totalFound++;
        const { isNew } = upsertJob(job);
        if (isNew) {
          totalNew++;
          console.log(`    + NEW: [${job.seniority}] ${job.title} @ ${job.company} (score: ${job.match_score})`);
        }
      }
    } catch (err) {
      console.error(`  Error in search "${search.keywords}":`, err.message);
    }

    await page.waitForTimeout(3000 + Math.random() * 2000);
  }

  logScrapeRun(totalFound, totalNew);
  await context.close();

  console.log(`\n=== Done. Found ${totalFound} jobs, ${totalNew} new. ===\n`);
  return { totalFound, totalNew };
}

// Run directly: node src/scraper.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runScraper().catch(console.error);
}
