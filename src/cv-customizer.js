import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { saveCustomizedCv, getJobById } from './db.js';
import { generatePdf } from './pdf-generator.js';
import { baseHtmlPath, cvConfig, profile } from './config.js';

const client = new Anthropic();

export async function customizeCV(jobId) {
  const job = getJobById(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const baseHtml = readFileSync(baseHtmlPath, 'utf-8');
  const candidateName = profile.name;

  console.log(`\nCustomizing CV for: ${job.title} @ ${job.company}`);

  const prompt = `You are a senior resume writer. Tailor the HTML resume below for the specific job posting. Do NOT fabricate experience, change dates, change company names, or invent roles.

JOB DETAILS:
Title: ${job.title}
Company: ${job.company}
Seniority: ${job.seniority}
Role type: ${job.role_type}
Description:
${job.description || '(No description available)'}

THE RESUME HTML:
${baseHtml}

INSTRUCTIONS:
1. Identify the top 5 keywords and requirements from the job description.
2. Modify the resume to highlight the most relevant experience for THIS specific job.
3. You MAY: rewrite or add bullet points to existing jobs, modify the professional summary, adjust the header subtitle, reorder competencies to put the most relevant ones first.
4. You MUST NOT: change company names, job titles, date ranges, or invent new roles/companies.
5. Keep modifications natural — not keyword-stuffed.
6. Keep the exact same HTML structure and CSS classes.
7. Make the header subtitle perfectly match this role type.

Provide a short analysis (3-5 bullets) of what you changed and why, as an HTML comment at the very top: <!-- CV_NOTES: ... -->

Return ONLY the complete modified HTML document, starting with <!-- CV_NOTES and ending with </html>.`;

  const message = await client.messages.create({
    model: cvConfig.model || 'claude-opus-4-7',
    max_tokens: 8192,
    system: 'You are a professional resume writer. Return only valid HTML — no markdown fences, no extra text outside the HTML document.',
    messages: [{ role: 'user', content: prompt }],
  });

  const cv_html = message.content[0].text;

  const notesMatch = cv_html.match(/<!--\s*CV_NOTES:([\s\S]*?)-->/);
  const cv_notes = notesMatch ? notesMatch[1].trim() : 'CV customized for this role.';

  saveCustomizedCv(jobId, cv_html, cv_notes);
  console.log(`  CV saved. Generating PDF...`);

  await generatePdf(jobId, cv_html, cvConfig.pdfFilenamePrefix || candidateName.replace(/\s+/g, '_'));
  console.log(`  PDF ready. Notes: ${cv_notes.slice(0, 120)}...`);

  return { cv_html, cv_notes };
}
