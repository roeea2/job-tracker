# LinkedIn Job Tracker — AI-Powered Job Search & CV Customizer

You are an expert career strategist and full-stack developer. You will help the user set up a complete LinkedIn job tracking system that:
1. Scrapes LinkedIn for senior job opportunities matching their profile
2. Customizes their CV for each job using AI
3. Displays everything in a local dashboard at `http://localhost:3737`

`$ARGUMENTS` may contain a path to their CV (PDF or HTML), a job description to focus on, or both. If no path is given, scan the current directory for a `.pdf` or `.html` file.

---

## Step 1 — Read the User's CV

1. If `$ARGUMENTS` contains a file path, use it. Otherwise:
   ```bash
   find . -maxdepth 2 \( -name "*.pdf" -o -name "resume*.html" -o -name "cv*.html" \) | head -5
   ```
2. Read the file using the Read tool (works for both PDF and HTML).
3. Extract and note:
   - Full name, email, phone, location, LinkedIn URL
   - Every job: company, title, date range, key responsibilities
   - Education, certifications, domain expertise
   - Core skills and technologies

---

## Step 2 — Understand Their Target

Ask the user:
- **Location** to search (e.g. "Israel", "London, UK", "New York, NY")
- **Target roles** — choose from: Customer Success, AI Engineering, Product Management, Technical Support, or let them describe custom roles
- **Seniority** — Director, VP, Head Of, C-Level, or all of the above
- **Minimum match score** to auto-generate CVs for (suggest 50)

If the user says "same as my CV" or "you decide", infer from their most recent title and seniority level.

---

## Step 3 — Set Up the Job Tracker Project

Create the following directory structure in the current working directory:

```
job-tracker/
  src/
    config.js
    db.js
    scraper.js
    enrich.js
    cv-customizer.js
    pdf-generator.js
    server.js
  public/
    index.html
  data/           (created at runtime)
  cvs/            (created at runtime)
  package.json
  tracker.config.json
  .env
  .gitignore
```

### 3a — package.json

```json
{
  "name": "job-tracker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start":  "node --env-file=.env --experimental-sqlite src/server.js",
    "scrape": "node --env-file=.env --experimental-sqlite src/scraper.js",
    "enrich": "node --env-file=.env --experimental-sqlite src/enrich.js",
    "dev":    "node --env-file=.env --experimental-sqlite --watch src/server.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "express": "^4.19.2",
    "playwright": "^1.44.1"
  }
}
```

### 3b — tracker.config.json

Populate this from what you extracted in Steps 1 and 2. The `searches` array should reflect the user's target roles and seniority. The `baseHtmlPath` should point to the user's CV HTML file (generate one if they only have a PDF — see Step 3c).

```json
{
  "profile": {
    "name": "[FULL NAME]",
    "email": "[EMAIL]",
    "phone": "[PHONE]",
    "location": "[LOCATION]",
    "linkedin": "[LINKEDIN URL]"
  },
  "search": {
    "location": "[SEARCH LOCATION e.g. Israel]",
    "minScore": 50,
    "searches": [
      { "keywords": "head of [role]",      "role_type": "[role_type]" },
      { "keywords": "director [role]",     "role_type": "[role_type]" },
      { "keywords": "VP [role]",           "role_type": "[role_type]" }
    ],
    "seniorSignals": ["head of", "director", "vp", "vice president", "chief", "cco", "cpo", "cto", "svp", "evp"],
    "roleSignals": {
      "[role_type_1]": ["[keyword1]", "[keyword2]"],
      "[role_type_2]": ["[keyword1]", "[keyword2]"]
    },
    "domainSignals": ["saas", "b2b", "startup", "scale-up"]
  },
  "cv": {
    "baseHtmlPath": "[relative path to resume HTML]",
    "model": "claude-opus-4-7",
    "pdfFilenamePrefix": "[FirstName_LastName_CV]"
  },
  "server": {
    "port": 3737
  }
}
```

### 3c — Generate HTML CV if user only has PDF

If the user's CV is only in PDF format, run the `/build-resume` skill first to produce a `resume-output.html`, then set `baseHtmlPath` to point to it.

### 3d — .env

```
ANTHROPIC_API_KEY=your-key-here
```

Tell the user to replace `your-key-here` with their Anthropic API key from console.anthropic.com → API Keys.

### 3e — .gitignore

```
.env
data/
node_modules/
```

---

## Step 4 — Write the Source Files

Write each source file to `job-tracker/src/`. The complete, working implementations are below.

### src/config.js
```js
import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(__dirname, '..', 'tracker.config.json'), 'utf-8'));

export const profile    = raw.profile;
export const search     = raw.search;
export const cvConfig   = raw.cv;
export const serverPort = raw.server?.port ?? 3737;
export const baseHtmlPath = resolve(join(__dirname, '..'), raw.cv.baseHtmlPath);
```

### src/db.js
Use `node:sqlite` (built-in, no compilation needed). Schema: `jobs` table with id, linkedin_id, title, company, location, url, description, seniority, role_type, match_score, status (default 'new'), cv_html, cv_notes, scraped_at, applied_at, notes. Plus `scrape_log` table. Implement: `upsertJob`, `getAllJobs`, `getJobById`, `updateJobStatus`, `updateJobNotes`, `saveCustomizedCv`, `logScrapeRun`, `getStats`.

### src/scraper.js
Playwright-based LinkedIn scraper. Uses `chromium.launchPersistentContext` with a dedicated profile at `data/chrome-profile/` and the system Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. On first run: navigates to LinkedIn login, polls until the user logs in (detects `/feed` URL), then continues. Reads `searches` and `location` from config. Scores each job using `seniorSignals`, `roleSignals`, `domainSignals` from config. Extracts company name from page title (`Job Title | Company | LinkedIn`). Saves jobs to DB.

### src/enrich.js
Re-visits jobs missing company name or description. Extracts company from page title. Extracts description by finding the largest text block containing job-like keywords (responsibilities, requirements, qualifications, experience). Cleans "with verification" suffix from titles.

### src/cv-customizer.js
Uses `@anthropic-ai/sdk`. Reads base CV HTML from `baseHtmlPath`. Sends it to Claude with the job description and instructions to tailor bullets/summary without changing companies, titles, or dates. Saves customized HTML to DB. Generates PDF via `pdf-generator.js`.

### src/pdf-generator.js
Uses Playwright headless Chromium. `page.setContent(html)` → `page.pdf({ format: 'Letter', printBackground: true })`. Saves to `data/cvs/job-{id}.pdf`.

### src/server.js
Express on `serverPort` from config. Routes:
- `GET /api/jobs` — list all (no cv_html, has has_cv + pdf_ready flags)
- `GET /api/jobs/:id` — full job + pdf_ready flag
- `PATCH /api/jobs/:id/status` — update status
- `PATCH /api/jobs/:id/notes` — save notes
- `POST /api/jobs/:id/customize-cv` — generate CV via Claude + PDF
- `GET /api/jobs/:id/cv` — serve CV HTML
- `GET /api/jobs/:id/cv.pdf` — serve PDF for download
- `GET /api/stats` — counts by status
- `GET /base-cv` — serve base resume HTML
- `POST /api/scrape` — trigger full pipeline (scrape → enrich → auto-generate CVs for score ≥ minScore)
- `POST /api/enrich` — enrich missing data only

---

## Step 5 — Write the Dashboard

Write `job-tracker/public/index.html` — a single-page dashboard with:

**Layout:**
- Sticky dark navy nav with brand name, "Refresh", "Enrich Jobs", "Run Scraper" buttons
- Stats bar: Total / New / Applied / Interview / Offer / With CV
- Filter pills: All / New / Researching / Applied / Interview / Offer / Rejected + search box
- Table: Role+Company, Seniority badge, Status dropdown, Match score bar (0-100), CV chip (✓ Ready / –), Date Found, View button

**Detail modal (opens on View):**
- Left panel: LinkedIn link, Apply section (Apply on LinkedIn button + Download PDF button, only shown when PDF is ready), Status select, Match score bar, Job description text, Notes textarea
- Right panel: tabs — "Customized CV" (iframe showing the tailored HTML) and "Base CV" (iframe of original)
- Customized CV tab: shows placeholder with "Generate with AI" button when no CV yet; shows CV notes, "Regenerate CV", "View HTML", "Download PDF" buttons when ready

**Status colors:** new=blue, researching=purple, applied=amber, interview=green, offer=dark-green, rejected=red, pass=gray

**Color scheme:** navy `#0d1b2a`, gold `#c4952a`, clean white cards, subtle borders

---

## Step 6 — Install and Launch

Run these commands:

```bash
cd job-tracker
npm install
npx playwright install chromium
npm start
```

Tell the user:
- Dashboard is at **http://localhost:3737**
- Click **"Run Scraper"** — a Chrome window will open, log in to LinkedIn, it will automatically detect login and start scraping
- After scraping completes (~3-5 min), the dashboard fills with jobs, enriched with company names and descriptions
- Jobs scoring ≥ `minScore` get customized CVs generated automatically
- Click **View** on any job → see customized CV → **Download PDF** → **Apply on LinkedIn**

---

## Step 7 — Final Report

Tell the user:
- How many files were created and where
- The URL of the dashboard
- That their LinkedIn session is saved in `data/chrome-profile/` so future scrapes don't need login
- Their API key is in `.env` which is gitignored
- To customize `tracker.config.json` to add more search terms or change target location anytime
- One-liner summary of their top 3 target role types based on their CV
