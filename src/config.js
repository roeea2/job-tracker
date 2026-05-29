import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'tracker.config.json');

const raw = JSON.parse(readFileSync(configPath, 'utf-8'));

export const profile    = raw.profile;
export const search     = raw.search;
export const cvConfig   = raw.cv;
export const serverPort = raw.server?.port ?? 3737;

// Resolve baseHtmlPath relative to the config file location
export const baseHtmlPath = resolve(join(__dirname, '..'), cvConfig.baseHtmlPath);
