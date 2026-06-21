#!/usr/bin/env node
/**
 * Скрипт автоматического подбора изображений для вопросов викторины.
 *
 * Для каждого вопроса без картинки берёт imageSearchQuery (или правильный ответ),
 * ищет изображение в Wikipedia/Wikimedia Commons и СКАЧИВАЕТ ТОЛЬКО PD/CC0
 * (Public Domain / CC0) — чтобы не тащить за собой обязательную атрибуцию
 * (вариант А, см. docs). Лицензия проверяется через imageinfo.extmetadata.
 * Если точной PD/CC0-картинки нет — пробует приблизительный CC0-поиск по теме,
 * иначе пишет вопрос в отчёт (not_found / license_blocked).
 *
 * Скачанное сразу ужимается в WebP (scripts/optimize-images.js), оригинал
 * уезжает в scripts/images-raw/ — в public/ попадает только лёгкий .webp.
 *
 * Запуск: node scripts/fetch-images.js
 *   только новые:    node scripts/fetch-images.js --skip-existing
 *   первые N:        node scripts/fetch-images.js --limit 5   (или --limit=5)
 *   конкретные id:   node scripts/fetch-images.js q_001 q_002
 *
 * Отчёт: scripts/image-fetch-report.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { optimizeImage } from './optimize-images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public', 'assets', 'images');
const QUESTIONS_FILE = path.join(ROOT, 'public', 'questions.json');
const REPORT_FILE = path.join(__dirname, 'image-fetch-report.json');

const THUMB_SIZE = 800;
const CONCURRENCY = 4; // одновременных вопросов в работе (бережём API от 429)
const USER_AGENT = 'BigQuiz-ImageFetcher/1.0 (quiz illustrations; PD/CC0 only)';

let skipExisting = false;

// ---------- утилиты ----------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Параллельная обработка с ограничением одновременных задач. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function apiFetch(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 429) {
      if (attempt < retries) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error('HTTP 429');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

async function downloadFile(url, destPath, retries = 4) {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'image/webp,image/jpeg,image/png,image/*,*/*',
    'Accept-Language': 'ru,en;q=0.9',
    'Referer': 'https://commons.wikimedia.org/',
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      if (attempt < retries) { await sleep(15000); continue; }
      throw new Error('HTTP 429');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return;
  }
}

function extFromUrl(url) {
  const match = url.match(/\.(jpe?g|png|webp|gif|svg)/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

const normTitle = (s) => (s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const stripHtml = (s) => (s ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');

// ---------- лицензионный гейт (вариант А: только PD/CC0) ----------

/** true только для Public Domain / CC0; неизвестную лицензию отклоняем (safe default). */
function isPublicDomainOrCC0(extmeta) {
  if (!extmeta) return false;
  const code = (extmeta.License?.value || '').toLowerCase().trim();
  const shortName = (extmeta.LicenseShortName?.value || '').trim();
  const PD_CODES = new Set(['pd', 'cc0', 'cc-publicdomain', 'cc-pd-mark']);
  if (PD_CODES.has(code) || code.startsWith('pd-')) return true;
  if (/public domain/i.test(shortName)) return true;
  if (/^cc0/i.test(shortName)) return true;
  if (/^no restrictions$/i.test(shortName)) return true;
  return false;
}

/**
 * Батч-запрос лицензий и URL для списка File:-заголовков (до 50 за раз).
 * Лицензию берём из Commons — авторитетного источника прав; файлы, локальные для
 * ru-wiki (часто несвободные), на Commons не найдутся → автоматически отклонятся.
 * @returns {Promise<Map<string,{thumbUrl,license,author,allowed}>>} ключ — normTitle(File:…)
 */
async function fetchFileInfo(fileTitles) {
  const out = new Map();
  if (!fileTitles.length) return out;
  const titles = fileTitles.map(encodeURIComponent).join('|');
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json`
    + `&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=${THUMB_SIZE}&titles=${titles}`;
  const data = await apiFetch(url);
  for (const page of Object.values(data?.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const ext = info.extmetadata || {};
    out.set(normTitle(page.title), {
      thumbUrl: info.thumburl || info.url || null,
      license: ext.LicenseShortName?.value || ext.License?.value || 'unknown',
      author: stripHtml(ext.Artist?.value) || 'unknown',
      allowed: isPublicDomainOrCC0(ext),
    });
  }
  return out;
}

/**
 * Из списка File:-кандидатов (в порядке убывания точности) выбирает первый PD/CC0.
 * @returns {Promise<{chosen:?object, blocked:Array<{file,license}>}>}
 */
async function pickAllowed(fileTitles) {
  if (!fileTitles.length) return { chosen: null, blocked: [] };
  const info = await fetchFileInfo(fileTitles);
  const blocked = [];
  for (const file of fileTitles) {
    const entry = info.get(normTitle(file));
    if (!entry) continue;
    if (entry.allowed && entry.thumbUrl) return { chosen: { file, ...entry }, blocked };
    blocked.push({ file, license: entry.license });
  }
  return { chosen: null, blocked };
}

// ---------- резолв кандидатов в File:-заголовки ----------

/** Главная картинка статьи → File:<имя> (без скачивания). */
async function resolvePageImage(title, lang = 'ru') {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json`
    + `&prop=pageimages&piprop=name&titles=${encodeURIComponent(title)}`;
  const data = await apiFetch(url);
  for (const page of Object.values(data?.query?.pages ?? {})) {
    if (page.pageimage) return `File:${page.pageimage}`;
  }
  return null;
}

/** opensearch → похожие статьи → File:-заголовок первой с картинкой. */
async function resolveViaSearch(term, lang = 'ru') {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&format=json`
    + `&limit=3&search=${encodeURIComponent(term)}`;
  const data = await apiFetch(url);
  for (const title of data?.[1] ?? []) {
    const file = await resolvePageImage(title, lang);
    if (file) return file;
  }
  return null;
}

/** Commons search (namespace 6) → массив File:-заголовков. */
async function searchCommonsFiles(term, limit = 5) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json`
    + `&list=search&srnamespace=6&srlimit=${limit}&srsearch=${encodeURIComponent(term)}`;
  const data = await apiFetch(url);
  return (data?.query?.search ?? [])
    .map((r) => r.title)
    .filter((t) => /^File:/i.test(t));
}

/** Точные кандидаты по запросу (статья ru/en + поиск + Commons), в порядке точности. */
async function collectPreciseCandidates(searchQuery) {
  const files = [];
  const add = (f) => { if (f && !files.includes(f)) files.push(f); };
  const steps = [
    () => resolvePageImage(searchQuery, 'ru'),
    () => resolvePageImage(searchQuery, 'en'),
    () => resolveViaSearch(searchQuery, 'ru'),
    () => resolveViaSearch(searchQuery, 'en'),
  ];
  for (const step of steps) {
    try { add(await step()); } catch { /* следующая стратегия */ }
  }
  try { (await searchCommonsFiles(searchQuery, 5)).forEach(add); } catch { /* ignore */ }
  return files.slice(0, 10);
}

// ---------- основная логика ----------

async function processQuestion(question) {
  const id = question.id;
  const searchQuery = question.imageSearchQuery
    || question.answers[question.correctAnswerIndex];
  const fallbackQuery = question.question.slice(0, 60);

  const extensions = ['jpg', 'jpeg', 'png', 'webp'];
  const existingFile = extensions
    .map((ext) => path.join(IMAGES_DIR, `${id}.${ext}`))
    .find((p) => fs.existsSync(p));
  if (existingFile && skipExisting) {
    console.log(`  [skip] ${id} — уже есть ${path.basename(existingFile)}`);
    return { id, status: 'skipped' };
  }

  console.log(`  [поиск] ${id}: "${searchQuery}"`);

  // Раунд 1 — точные кандидаты.
  const precise = await collectPreciseCandidates(searchQuery);
  let { chosen, blocked } = await pickAllowed(precise);

  // Раунд 2 — приблизительный CC0-поиск по теме, если точной PD/CC0 не нашлось.
  if (!chosen) {
    let approx = [];
    try { approx = await searchCommonsFiles(fallbackQuery, 8); } catch { /* ignore */ }
    const r2 = await pickAllowed(approx);
    if (r2.chosen) chosen = r2.chosen;
    blocked = blocked.concat(r2.blocked);
  }

  if (!chosen) {
    if (blocked.length) {
      console.log(`  [лицензия] ${id} — найдено, но не PD/CC0 (${blocked[0].license})`);
      return { id, status: 'license_blocked', query: searchQuery, rejectedLicense: blocked[0].license };
    }
    console.log(`  [не найдено] ${id}`);
    return { id, status: 'not_found', query: searchQuery };
  }

  const ext = extFromUrl(chosen.thumbUrl);
  const destPath = path.join(IMAGES_DIR, `${id}.${ext}`);
  try {
    await downloadFile(chosen.thumbUrl, destPath);
    // Сразу ужимаем в WebP и уносим оригинал в scripts/images-raw/.
    const { beforeKb, afterKb, webp } = await optimizeImage(destPath);
    console.log(`  [OK] ${webp} (${beforeKb} KB → ${afterKb} KB, ${chosen.license}) ← ${chosen.file}`);
    return { id, status: 'ok', file: webp, license: chosen.license, author: chosen.author };
  } catch (e) {
    console.log(`  [ошибка скачивания] ${id}: ${e.message}`);
    return { id, status: 'error', query: searchQuery, error: e.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let limit = null;
  const targetIds = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--skip-existing') { skipExisting = true; continue; }
    if (a === '--limit') { limit = parseInt(args[++k], 10) || null; continue; }
    if (a.startsWith('--limit=')) { limit = parseInt(a.slice(8), 10) || null; continue; }
    if (a.startsWith('--')) continue;
    targetIds.push(a);
  }

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const { questions } = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  let toProcess = targetIds.length
    ? questions.filter((q) => targetIds.includes(q.id))
    : questions;
  if (limit) toProcess = toProcess.slice(0, limit);

  console.log(`BigQuiz image fetcher — ${toProcess.length} вопросов (PD/CC0, до ${CONCURRENCY} параллельно)\n`);

  const settled = await mapLimit(toProcess, CONCURRENCY, processQuestion);

  const report = {
    generatedAt: new Date().toISOString(),
    ok: [],
    skipped: [],
    not_found: [],
    license_blocked: [],
    error: [],
  };
  for (const r of settled) {
    if (!r) continue;
    if (r.status === 'ok') report.ok.push({ id: r.id, file: r.file, license: r.license, author: r.author });
    else if (r.status === 'skipped') report.skipped.push(r.id);
    else if (r.status === 'not_found') report.not_found.push({ id: r.id, query: r.query });
    else if (r.status === 'license_blocked') report.license_blocked.push({ id: r.id, query: r.query, rejectedLicense: r.rejectedLicense });
    else if (r.status === 'error') report.error.push({ id: r.id, error: r.error });
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log('\n── Итог ──');
  console.log(`  Скачано (PD/CC0):  ${report.ok.length}`);
  if (report.skipped.length) console.log(`  Пропущено:         ${report.skipped.length}`);
  console.log(`  Не найдено:        ${report.not_found.length}`);
  if (report.not_found.length) console.log(`                     ${report.not_found.map((x) => x.id).join(', ')}`);
  console.log(`  Срезано лицензией: ${report.license_blocked.length}`);
  if (report.license_blocked.length) console.log(`                     ${report.license_blocked.map((x) => x.id).join(', ')}`);
  if (report.error.length) console.log(`  Ошибки:            ${report.error.length}`);
  console.log(`  Отчёт: ${path.relative(ROOT, REPORT_FILE)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
