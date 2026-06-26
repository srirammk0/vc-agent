import fs from 'fs/promises';
import path from 'path';
import { ScoredStartup } from './types.js';

const BRAIN_DIR = path.join(process.cwd(), 'brain');

export async function getSeenUrls(): Promise<Set<string>> {
  try {
    const data = await fs.readFile(path.join(BRAIN_DIR, 'seen-urls.md'), 'utf-8');
    return new Set(data.split('\n').map(l => l.trim()).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

export async function addSeenUrls(urls: string[]): Promise<void> {
  const cleanUrls = urls.map(u => u.trim()).filter(Boolean);
  if (cleanUrls.length === 0) return;
  
  const content = cleanUrls.join('\n') + '\n';
  await fs.appendFile(path.join(BRAIN_DIR, 'seen-urls.md'), content);
}

export async function getShortlistContext(): Promise<string> {
  try {
    return await fs.readFile(path.join(BRAIN_DIR, 'shortlist.md'), 'utf-8');
  } catch (e) {
    return '';
  }
}

export async function addPassedCompany(company: ScoredStartup): Promise<void> {
  const card = `---
Name: ${company.company_name}
URL: ${company.url || 'N/A'}
Score: ${company.overall_score}
One-Liner: ${company.one_liner}
Why Interesting: ${company.why_interesting}
---`;

  const filePath = path.join(BRAIN_DIR, 'shortlist.md');
  await fs.appendFile(filePath, card + '\n\n');
  
  if (company.url) {
    await addSeenUrls([company.url]);
  }
}

export async function addRejectedCompany(url: string, score: number, reason: string): Promise<void> {
  if (url) {
    await addSeenUrls([url]);
  }
  const date = new Date().toISOString();
  const entry = `${url} | ${score} | ${reason} | ${date}\n`;
  await fs.appendFile(path.join(BRAIN_DIR, 'rejected.md'), entry);
}

export async function logRun(triggerSource: string, companiesFound: number, outcome: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} | ${triggerSource} | ${companiesFound} | ${outcome}\n`;
  await fs.appendFile(path.join(BRAIN_DIR, 'run-log.md'), entry);
}

export async function getRecentLogs(): Promise<string> {
  try {
    const data = await fs.readFile(path.join(BRAIN_DIR, 'run-log.md'), 'utf-8');
    const lines = data.split('\n').filter(Boolean);
    const today = new Date().toISOString().split('T')[0];
    return lines.filter(l => l.startsWith(today)).join('\n');
  } catch (e) {
    return '';
  }
}

export async function getSignals(): Promise<string> {
  try {
    return await fs.readFile(path.join(BRAIN_DIR, 'signals.md'), 'utf-8');
  } catch (e) {
    return '';
  }
}

export async function updateSignal(source: string, summary: string): Promise<void> {
  let currentSignals = '';
  try {
    currentSignals = await fs.readFile(path.join(BRAIN_DIR, 'signals.md'), 'utf-8');
  } catch (e) {}

  const lines = currentSignals.split('\n').filter(Boolean);
  const newLines = lines.filter(l => !l.startsWith(source + ' |'));
  
  const timestamp = new Date().toISOString();
  newLines.push(`${source} | ${timestamp} | ${summary}`);
  
  await fs.writeFile(path.join(BRAIN_DIR, 'signals.md'), newLines.join('\n') + '\n');
}
