import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { getAllJobs, getJobById, updateJobStatus, updateJobNotes, getStats } from './db.js';
import { serverPort, baseHtmlPath } from './config.js';
import { customizeCV, analyzeJob } from './cv-customizer.js';
import { cvPdfPath } from './pdf-generator.js';
import { runScraper } from './scraper.js';
import { enrichJobs } from './enrich.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = serverPort;

app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// ── Jobs ─────────────────────────────────────────────────────────────────────

app.get('/api/jobs', (req, res) => {
  try { res.json(getAllJobs()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJobById(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Not found' });

  // Tell the client whether a PDF file exists on disk
  const pdfExists = existsSync(cvPdfPath(job.id));
  res.json({ ...job, pdf_ready: pdfExists });
});

app.patch('/api/jobs/:id/status', (req, res) => {
  const { status } = req.body;
  const valid = ['new', 'researching', 'applied', 'interview', 'offer', 'rejected', 'pass'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  updateJobStatus(Number(req.params.id), status);
  res.json({ ok: true });
});

app.patch('/api/jobs/:id/notes', (req, res) => {
  updateJobNotes(Number(req.params.id), req.body.notes);
  res.json({ ok: true });
});

// ── CV ────────────────────────────────────────────────────────────────────────

// Analyze job vs current CV — returns signals, gaps, and questions
app.post('/api/jobs/:id/analyze', async (req, res) => {
  try {
    const analysis = await analyzeJob(Number(req.params.id));
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate customized CV — optionally accepts answers from the Q&A flow
app.post('/api/jobs/:id/customize-cv', async (req, res) => {
  try {
    const answers = req.body.answers || [];
    const result = await customizeCV(Number(req.params.id), answers);
    res.json({ ok: true, cv_notes: result.cv_notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customized CV as HTML (for iframe preview)
app.get('/api/jobs/:id/cv', (req, res) => {
  const job = getJobById(Number(req.params.id));
  if (!job?.cv_html) return res.status(404).send('No customized CV yet');
  res.setHeader('Content-Type', 'text/html');
  res.send(job.cv_html);
});

// Customized CV as PDF (for download + upload to LinkedIn)
app.get('/api/jobs/:id/cv.pdf', (req, res) => {
  const id = Number(req.params.id);
  const pdfPath = cvPdfPath(id);
  if (!existsSync(pdfPath)) return res.status(404).json({ error: 'PDF not generated yet' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Roee_Aizman_CV_${id}.pdf"`);
  res.send(readFileSync(pdfPath));
});

// Base CV HTML for comparison
app.get('/base-cv', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(readFileSync(baseHtmlPath, 'utf-8'));
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  try { res.json(getStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Automation ────────────────────────────────────────────────────────────────

// Kick off scraper → enrich → auto-generate CVs for score >= 50
app.post('/api/scrape', async (req, res) => {
  res.json({ ok: true, message: 'Pipeline started. Scrape → enrich → generate CVs for top matches.' });
  try {
    await runScraper();
    console.log('\n  Auto-enriching new jobs...');
    await enrichJobs();
    console.log('\n  Auto-generating CVs for high-score jobs...');
    await autoGenerateCVs();
  } catch (err) {
    console.error('Pipeline error:', err.message);
  }
});

// Enrich only (fill missing company + description)
app.post('/api/enrich', async (req, res) => {
  res.json({ ok: true, message: 'Enrichment started.' });
  try { await enrichJobs(); }
  catch (err) { console.error('Enrich error:', err.message); }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Job Tracker dashboard → http://localhost:${PORT}\n`);
});

// Auto-generate CVs for jobs with score >= 50 that don't have one yet
async function autoGenerateCVs() {
  const jobs = getAllJobs().filter(j => j.match_score >= 50 && !j.has_cv);
  console.log(`  Generating CVs for ${jobs.length} high-score jobs...`);
  for (const job of jobs) {
    try {
      console.log(`    Customizing: ${job.title} @ ${job.company}`);
      await customizeCV(job.id);
    } catch (err) {
      console.error(`    Error for job ${job.id}: ${err.message}`);
    }
  }
  console.log('  Auto CV generation complete.\n');
}
