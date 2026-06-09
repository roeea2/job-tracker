import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { saveCustomizedCv, getJobById } from './db.js';
import { generatePdf } from './pdf-generator.js';
import { baseHtmlPath, cvConfig, profile } from './config.js';

const client = new Anthropic();

// ── Step 1: Analyze job + gap-check current CV ────────────────────────────────

export async function analyzeJob(jobId) {
  const job = getJobById(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const baseHtml = readFileSync(baseHtmlPath, 'utf-8');

  console.log(`\nAnalyzing: ${job.title} @ ${job.company}`);

  const message = await client.messages.create({
    model: cvConfig.model || 'claude-opus-4-7',
    max_tokens: 2048,
    system: `You are a senior talent acquisition expert and resume coach.
Return ONLY valid JSON — no markdown fences, no extra text.`,
    messages: [{
      role: 'user',
      content: `Analyze this job posting against the candidate's current resume.

JOB:
Title: ${job.title}
Company: ${job.company}
Description:
${job.description || '(No description available — analyze from title only)'}

CANDIDATE RESUME (HTML — read the text content):
${baseHtml}

Return this exact JSON structure:
{
  "signals": [
    "string — top 6 skills/keywords/success signals the hiring manager is looking for"
  ],
  "gaps": [
    {
      "signal": "the signal from above",
      "issue": "specific weakness or missing proof in the current resume",
      "severity": "high | medium | low"
    }
  ],
  "questions": [
    {
      "id": 1,
      "question": "A targeted question to get real information that fills a gap — ask for specific numbers, outcomes, team sizes, technologies, or achievements the resume doesn't currently prove",
      "context": "Why this matters for THIS specific job"
    }
  ]
}

Rules:
- signals: exactly 6, ordered by importance to this specific job
- gaps: only real gaps — if something is already well-proved, skip it
- questions: 2-4 questions maximum, one at a time flow — start with the highest-impact gap
- questions must be answerable with real facts (no "did you ever use X" — ask "what specific outcome did X produce")
- severity high = likely dealbreaker if missing, medium = weakens application, low = nice to have`
    }]
  });

  try {
    return JSON.parse(message.content[0].text);
  } catch {
    throw new Error('Failed to parse analysis response: ' + message.content[0].text.slice(0, 200));
  }
}

// ── Step 2: Generate customized CV using analysis + user answers ──────────────

export async function customizeCV(jobId, answers = []) {
  const job = getJobById(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const baseHtml = readFileSync(baseHtmlPath, 'utf-8');

  console.log(`\nCustomizing CV for: ${job.title} @ ${job.company}`);

  const answersBlock = answers.length
    ? `\nCANDIDATE PROVIDED ADDITIONAL CONTEXT (real facts — use these to strengthen the resume):\n${answers.map((a, i) => `Q${i + 1}: ${a.question}\nA: ${a.answer}`).join('\n\n')}`
    : '';

  const message = await client.messages.create({
    model: cvConfig.model || 'claude-opus-4-7',
    max_tokens: 8192,
    system: 'You are a professional resume writer. Return only valid HTML — no markdown fences, no extra text outside the HTML document.',
    messages: [{
      role: 'user',
      content: `Tailor this HTML resume for the specific job below.

JOB:
Title: ${job.title}
Company: ${job.company}
Seniority: ${job.seniority}
Description:
${job.description || '(No description available)'}
${answersBlock}

THE RESUME HTML:
${baseHtml}

RULES:
- You MAY: rewrite or add bullet points, modify the summary, adjust the header subtitle, reorder competencies
- You MUST NOT: change company names, job titles, date ranges, or invent roles
- If the candidate gave additional context above, weave it naturally into the relevant bullet points as real achievements
- Mirror the job description language naturally — not keyword-stuffed
- Keep the exact same HTML structure and CSS classes
- Make the header subtitle match this role type precisely

Put a short analysis (3-5 bullets on what changed and why) ONLY in an HTML comment at the very top:
<!-- CV_NOTES: ... -->

Return ONLY the complete modified HTML, starting with <!-- CV_NOTES and ending with </html>.`
    }]
  });

  const cv_html = message.content[0].text;

  const notesMatch = cv_html.match(/<!--\s*CV_NOTES:([\s\S]*?)-->/);
  const cv_notes = notesMatch ? notesMatch[1].trim() : 'CV customized for this role.';

  saveCustomizedCv(jobId, cv_html, cv_notes);
  console.log(`  CV saved. Generating PDF...`);

  const prefix = cvConfig.pdfFilenamePrefix || profile.name.replace(/\s+/g, '_');
  await generatePdf(jobId, cv_html, prefix);
  console.log(`  PDF ready.`);

  return { cv_html, cv_notes };
}
