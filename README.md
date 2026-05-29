```
██████╗  ██████╗ ███████╗███████╗ █████╗ ██╗
██╔══██╗██╔═══██╗██╔════╝██╔════╝██╔══██╗██║
██████╔╝██║   ██║█████╗  █████╗  ███████║██║
██╔══██╗██║   ██║██╔══╝  ██╔══╝  ██╔══██║██║
██║  ██║╚██████╔╝███████╗███████╗██║  ██║██║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝
         Job Tracker — by Roee Aizman
```

# 🎯 Job Tracker

**AI-powered LinkedIn job search + CV customizer + local dashboard**

Stop sending the same CV to every job. This tool scrapes LinkedIn for senior opportunities that match your profile, rewrites your CV with Claude AI to fit each specific role, and tracks everything in a clean local dashboard — so when you're ready to apply, your tailored PDF is already waiting.

---

## What It Does

| Step | What happens |
|------|-------------|
| 🔍 **Scrape** | Playwright opens Chrome, logs into LinkedIn, and runs your configured searches across Israel (or any location) |
| 🏷️ **Enrich** | Re-visits each job page to extract company name and full description |
| 🤖 **Customize CV** | Claude rewrites your CV bullets and summary to match each job — without fabricating experience or changing dates |
| 📄 **Generate PDF** | Playwright renders the tailored HTML CV to a print-ready PDF |
| 📊 **Dashboard** | A local web app at `http://localhost:3737` shows all jobs with status tracking, CV preview, and one-click apply |

---

## Dashboard Preview

```
┌─────────────────────────────────────────────────────────────────────┐
│  RoeeAI Job Tracker          [Refresh] [Enrich Jobs] [Run Scraper]  │
├──────┬────────┬──────────┬──────────┬──────────┬────────────────────┤
│  45  │   45   │    0     │    0     │    0     │        10          │
│ Total│  New   │ Applied  │Interview │  Offer   │      With CV       │
├──────┴────────┴──────────┴──────────┴──────────┴────────────────────┤
│ [All] [New] [Researching] [Applied] [Interview] [Offer] [Rejected]  │
│                                              🔍 Search title, co... │
├────────────────────────┬──────────┬──────────┬───────┬──────────────┤
│ Role                   │ Seniority│  Status  │ Match │     CV       │
├────────────────────────┼──────────┼──────────┼───────┼──────────────┤
│ Director PM, AI @ NiCE │ Director │ [New  ▾] │ ████70│ ✓ Ready      │
│ Dir. CS Ops @ DealHub  │ Director │ [New  ▾] │ ████60│ ✓ Ready      │
│ VP Ops & CS @ Ship4wd  │    VP    │ [New  ▾] │ ████60│ ✓ Ready      │
└────────────────────────┴──────────┴──────────┴───────┴──────────────┘
```

Click **View** on any job to open the detail modal — see the tailored CV in an iframe, download the PDF, and open the LinkedIn application page.

---

## Requirements

- **Node.js 22+** (uses built-in `node:sqlite`)
- **Google Chrome** installed at `/Applications/Google Chrome.app` (macOS) or configurable path
- **Anthropic API key** — [get one here](https://console.anthropic.com)
- A LinkedIn account

> Windows/Linux users: update `chromePath` in `tracker.config.json` to your Chrome executable path.

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/roeea2/job-tracker.git
cd job-tracker
npm install
npx playwright install chromium
```

### 2. Set your API key

```bash
cp .env.example .env
# Edit .env and add your Anthropic API key
```

### 3. Add your CV

Place your resume as an HTML file in the project root (or point `baseHtmlPath` in `tracker.config.json` to your existing file).

If you only have a PDF, use the [build-resume Claude Code skill](https://github.com/roeea2/RoeeCV/blob/main/skill/build-resume.md) to generate a styled HTML version first.

### 4. Configure your search

Edit `tracker.config.json`:

```json
{
  "profile": {
    "name": "Your Name",
    "location": "Tel Aviv, Israel"
  },
  "search": {
    "location": "Israel",
    "searches": [
      { "keywords": "head of customer success", "role_type": "customer_success" },
      { "keywords": "director AI engineering",  "role_type": "ai_engineering" }
    ]
  },
  "cv": {
    "baseHtmlPath": "./my-resume.html"
  }
}
```

See [tracker.config.json](tracker.config.json) for the full schema with all options.

### 5. Start the dashboard

```bash
npm start
# → http://localhost:3737
```

### 6. Run your first scrape

Click **Run Scraper** in the dashboard — a Chrome window will open.

**First time only:** log in to LinkedIn in that window. The session is saved in `data/chrome-profile/` so you never need to log in again.

The full pipeline runs automatically:
1. Scrapes LinkedIn with your configured searches
2. Enriches each job with company name + description
3. Auto-generates tailored CVs for all jobs scoring ≥ `minScore`

---

## Configuration Reference

### tracker.config.json

```json
{
  "profile": {
    "name":     "Your Full Name",
    "email":    "you@example.com",
    "phone":    "+1-555-0100",
    "location": "Your City, Country",
    "linkedin": "linkedin.com/in/yourhandle"
  },

  "search": {
    "location":  "Israel",
    "minScore":  50,
    "searches": [
      { "keywords": "head of customer success", "role_type": "customer_success" },
      { "keywords": "director customer success","role_type": "customer_success" },
      { "keywords": "director AI engineering",  "role_type": "ai_engineering"  },
      { "keywords": "head of product",          "role_type": "product"         }
    ],
    "seniorSignals": ["head of", "director", "vp", "chief", "cco", "cpo"],
    "roleSignals": {
      "customer_success": ["customer success", "customer experience"],
      "ai_engineering":   ["ai", "artificial intelligence"],
      "product":          ["product manager", "product management"],
      "support":          ["support", "technical support"]
    },
    "domainSignals": ["saas", "b2b", "startup"]
  },

  "cv": {
    "baseHtmlPath":     "./my-resume.html",
    "model":            "claude-opus-4-7",
    "pdfFilenamePrefix":"Your_Name_CV"
  },

  "server": {
    "port": 3737
  }
}
```

### Match Score Logic

Each job is scored 0–100:
- **+40** — title contains a senior signal (head of, director, VP, chief…)
- **+10–20** — role type keyword match (customer success, AI, product, support)
- **+5** — domain signal match (SaaS, B2B, startup…)

Jobs scoring ≥ `minScore` get CVs auto-generated after each scrape.

---

## Project Structure

```
job-tracker/
├── src/
│   ├── config.js          # Loads tracker.config.json
│   ├── db.js              # SQLite via node:sqlite (no compilation)
│   ├── scraper.js         # Playwright LinkedIn scraper
│   ├── enrich.js          # Fills missing company names + descriptions
│   ├── cv-customizer.js   # Claude API CV tailoring
│   ├── pdf-generator.js   # Playwright HTML → PDF
│   └── server.js          # Express dashboard + REST API
├── public/
│   └── index.html         # Single-page dashboard (vanilla JS)
├── skill/
│   └── job-tracker.md     # Claude Code skill for one-command setup
├── tracker.config.json    # Your search + profile configuration
├── .env.example           # API key template
└── package.json
```

---

## npm Scripts

| Command | What it does |
|---------|-------------|
| `npm start` | Start the dashboard server |
| `npm run dev` | Start with file-watching (auto-restart on changes) |
| `npm run scrape` | Run the LinkedIn scraper standalone |
| `npm run enrich` | Re-fetch company names + descriptions for existing jobs |

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/jobs` | All jobs (with has_cv, pdf_ready flags) |
| GET | `/api/jobs/:id` | Full job record |
| PATCH | `/api/jobs/:id/status` | Update status |
| PATCH | `/api/jobs/:id/notes` | Save notes |
| POST | `/api/jobs/:id/customize-cv` | Generate tailored CV + PDF via Claude |
| GET | `/api/jobs/:id/cv` | Serve customized CV HTML |
| GET | `/api/jobs/:id/cv.pdf` | Download customized CV PDF |
| GET | `/api/stats` | Job counts by status |
| GET | `/base-cv` | Serve base resume HTML |
| POST | `/api/scrape` | Run full pipeline (scrape → enrich → generate CVs) |
| POST | `/api/enrich` | Enrich missing company/description only |

---

## Job Statuses

`new` → `researching` → `applied` → `interview` → `offer`

or → `rejected` / `pass`

---

## How CV Customization Works

Claude reads your base CV HTML and the job description, then:

- ✅ Rewrites bullet points to mirror the job's language and priorities
- ✅ Updates the professional summary to match the role type
- ✅ Reorders core competencies to lead with the most relevant skills
- ✅ Adjusts the header subtitle to fit the specific role

- ❌ Never changes company names, job titles, or date ranges
- ❌ Never fabricates experience or invents roles
- ❌ Never changes the HTML structure or CSS

The customized HTML is stored in the database and rendered in the dashboard iframe. The PDF is generated via headless Chrome (Playwright) and saved to `data/cvs/job-{id}.pdf`.

---

## Privacy & Security

- Your API key lives in `.env` which is gitignored — it never leaves your machine
- The SQLite database and Chrome profile are in `data/` which is gitignored
- Generated CVs (PDFs + HTML) are in `data/cvs/` — also gitignored
- LinkedIn session cookies are stored in `data/chrome-profile/` — not committed

---

## Claude Code Skill

This project ships with a [Claude Code skill](skill/job-tracker.md) that lets anyone set up their own instance with a single command:

```
/job-tracker path/to/my-resume.pdf
```

Claude will read the CV, ask a few questions about target roles and location, and scaffold the full system configured for that person.

---

## Built With

- [Playwright](https://playwright.dev) — browser automation for scraping and PDF generation
- [Claude API](https://anthropic.com) — AI-powered CV customization
- [Express](https://expressjs.com) — dashboard web server
- [node:sqlite](https://nodejs.org/api/sqlite.html) — built-in SQLite (Node 22+, no native compilation)

---

## License

MIT — built by [Roee Aizman](https://linkedin.com/in/roeea)
