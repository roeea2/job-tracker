import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '..', 'data');
const DB_PATH   = join(DATA_DIR, 'jobs.db');

mkdirSync(DATA_DIR, { recursive: true });

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`PRAGMA journal_mode=WAL`);
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      linkedin_id TEXT    UNIQUE,
      title       TEXT    NOT NULL,
      company     TEXT    NOT NULL,
      location    TEXT,
      url         TEXT    NOT NULL,
      description TEXT,
      seniority   TEXT,
      role_type   TEXT,
      match_score INTEGER DEFAULT 0,
      status      TEXT    DEFAULT 'new',
      cv_html     TEXT,
      cv_notes    TEXT,
      scraped_at  TEXT    DEFAULT (datetime('now')),
      applied_at  TEXT,
      notes       TEXT
    );

    CREATE TABLE IF NOT EXISTS scrape_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at     TEXT DEFAULT (datetime('now')),
      jobs_found INTEGER DEFAULT 0,
      jobs_new   INTEGER DEFAULT 0
    );
  `);
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export function upsertJob(job) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM jobs WHERE linkedin_id = ?').get(job.linkedin_id);
  if (existing) return { id: existing.id, isNew: false };

  const result = db.prepare(`
    INSERT INTO jobs (linkedin_id, title, company, location, url, description, seniority, role_type, match_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.linkedin_id, job.title, job.company, job.location,
    job.url, job.description, job.seniority, job.role_type, job.match_score
  );
  return { id: result.lastInsertRowid, isNew: true };
}

export function getAllJobs() {
  return getDb().prepare(`
    SELECT id, linkedin_id, title, company, location, url, description,
           seniority, role_type, match_score, status, cv_notes, scraped_at, applied_at, notes,
           CASE WHEN cv_html IS NOT NULL AND cv_html != '' THEN 1 ELSE 0 END as has_cv
    FROM jobs ORDER BY match_score DESC, scraped_at DESC
  `).all();
}

export function getJobById(id) {
  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

export function updateJobStatus(id, status) {
  const db = getDb();
  if (status === 'applied') {
    db.prepare('UPDATE jobs SET status = ?, applied_at = COALESCE(applied_at, datetime(\'now\')) WHERE id = ?').run(status, id);
  } else {
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
  }
}

export function updateJobNotes(id, notes) {
  getDb().prepare('UPDATE jobs SET notes = ? WHERE id = ?').run(notes, id);
}

export function saveCustomizedCv(id, cv_html, cv_notes) {
  getDb().prepare('UPDATE jobs SET cv_html = ?, cv_notes = ? WHERE id = ?').run(cv_html, cv_notes, id);
}

export function logScrapeRun(jobs_found, jobs_new) {
  getDb().prepare('INSERT INTO scrape_log (jobs_found, jobs_new) VALUES (?, ?)').run(jobs_found, jobs_new);
}

export function getStats() {
  const db = getDb();
  const q = (sql) => db.prepare(sql).get().c;
  return {
    total:     q("SELECT COUNT(*) as c FROM jobs"),
    new:       q("SELECT COUNT(*) as c FROM jobs WHERE status='new'"),
    applied:   q("SELECT COUNT(*) as c FROM jobs WHERE status='applied'"),
    interview: q("SELECT COUNT(*) as c FROM jobs WHERE status='interview'"),
    offer:     q("SELECT COUNT(*) as c FROM jobs WHERE status='offer'"),
    with_cv:   q("SELECT COUNT(*) as c FROM jobs WHERE cv_html IS NOT NULL AND cv_html != ''"),
  };
}
