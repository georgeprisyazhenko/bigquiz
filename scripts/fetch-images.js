#!/usr/bin/env node
/**
 * Скрипт автоматического подбора изображений для вопросов викторины.
 *
 * Для каждого вопроса без картинки берёт imageSearchQuery (или правильный ответ)
 * и ищет изображение параллельно в трёх источниках:
 *   1. Wikipedia / Wikimedia Commons — PD/CC0, проверяется через extmetadata
 *   2. Openverse (openverse.org)     — фильтр cc0,pdm на стороне API
 *   3. MET Museum Open Access        — isPublicDomain: true, ключ не нужен
 * Побеждает тот, кто ответит первым. СКАЧИВАЕТ ТОЛЬКО PD/CC0 — без атрибуции.
 * CC-BY/CC-BY-SA и несвободное/неизвестное отклоняется. PDF/DjVu не берём.
 * Если ничего не нашлось — пишет вопрос в отчёт (not_found / license_blocked).
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
const CONCURRENCY = 3; // одновременных вопросов; внутри каждого — 3 источника параллельно
const MIN_REQUEST_GAP_MS = 350; // троттл только для Wikimedia API
const USER_AGENT = 'BigQuiz-ImageFetcher/1.0 (quiz illustrations; PD/CC0 only)';

let skipExisting = false;

// ---------- утилиты ----------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Глобальный троттл: резервирует разнесённые слоты даже для параллельных воркеров,
// чтобы суммарный поток запросов к Wikimedia не упирался в 429.
let nextRequestSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextRequestSlot - now);
  nextRequestSlot = Math.max(now, nextRequestSlot) + MIN_REQUEST_GAP_MS;
  if (wait) await sleep(wait);
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

/** Fetch с Wikimedia-троттлом — только для запросов к *.wikipedia.org / commons.wikimedia.org. */
async function apiFetch(url, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 429 || res.status === 503) {
      if (attempt < retries) {
        const retryAfter = parseInt(res.headers.get('retry-after'), 10);
        const wait = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : Math.min(30000, 1000 * 2 ** attempt);
        await sleep(wait);
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

/** Fetch без троттла — для внешних источников (Openverse, MET). */
async function jsonFetch(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 429 || res.status === 503) {
      if (attempt < retries) { await sleep(Math.min(5000, 500 * 2 ** attempt)); continue; }
      throw new Error(`HTTP ${res.status}`);
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

// PDF/DjVu отдают thumbnail первой страницы книги, а не иллюстрацию — никогда не годятся.
const isUsableImageFile = (title) => !/\.(pdf|djvu)$/i.test(title || '');

// Слова-наполнители, ломающие матч на заголовок статьи / AND-поиск Commons.
const FILLER_RE = /\b(illustration|illustrated|diagram|schematic|portrait|photo|photograph|picture|image|drawing|sketch|anatomy|history|historical|invention|closeup|close-up|ww2|wwii|иллюстрация|фото|фотография|портрет|схема|рисунок|история|исторический)\b/gi;

/** Убирает наполнители из запроса; null, если ничего не изменилось. */
function simplifyQuery(q) {
  const s = (q || '').replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim();
  return s && s !== (q || '').trim() ? s : null;
}

/** Первые n слов запроса (для коротких сущностей); null, если слов и так ≤ n. */
function firstWords(q, n) {
  const words = (q || '').split(/\s+/).filter(Boolean);
  return words.length > n ? words.slice(0, n).join(' ') : null;
}

// ---------- лицензионный гейт (только PD/CC0 — без обязательной атрибуции) ----------

/**
 * true только для Public Domain / CC0 — их можно показывать без подписи-атрибуции.
 * CC-BY/CC-BY-SA, несвободное, помеченные ограничения и неизвестную лицензию
 * отклоняем (safe default).
 */
function isPublicDomainOrCC0(extmeta) {
  if (!extmeta) return false;
  if ((extmeta.Restrictions?.value || '').trim()) return false; // спец-ограничения → мимо
  const code = (extmeta.License?.value || '').toLowerCase().trim();
  const name = (extmeta.LicenseShortName?.value || '').trim();
  if (['pd', 'cc0', 'cc-publicdomain', 'cc-pd-mark'].includes(code)) return true;
  if (code.startsWith('pd-')) return true;
  if (/public domain/i.test(name)) return true;
  if (/^cc0/i.test(name)) return true;
  if (/^no restrictions$/i.test(name)) return true;
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
    .filter((t) => /^File:/i.test(t) && isUsableImageFile(t));
}

/**
 * Для Wikimedia URL из Openverse получает правильный thumbUrl через Commons imageinfo API.
 * Нельзя конструировать URL вручную: Wikimedia не генерирует thumbnail больше оригинала.
 */
async function wikimediaThumbFromUrl(directUrl) {
  const m = directUrl.match(/\/commons\/(?:[a-f0-9]\/[a-f0-9]{2}\/)(.+)$/i);
  if (!m) return null;
  const filename = m[1]; // уже percent-encoded
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json`
    + `&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_SIZE}&titles=File:${filename}`;
  const data = await apiFetch(apiUrl);
  for (const page of Object.values(data?.query?.pages ?? {})) {
    return page.imageinfo?.[0]?.thumburl || null;
  }
  return null;
}

/**
 * Openverse API — уже фильтрует по CC0/PDM, возвращает прямые URL.
 * @returns {Promise<{thumbUrl,file,license,author}|null>} первый подходящий результат
 */
async function searchOpenverse(term, limit = 5) {
  const url = `https://api.openverse.org/v1/images/?`
    + `q=${encodeURIComponent(term)}&license=cc0,pdm&page_size=${limit}`;
  const data = await jsonFetch(url);
  const results = data?.results ?? [];
  for (const r of results) {
    if (!r.url) continue;
    let thumbUrl;
    if (/upload\.wikimedia\.org/i.test(r.url)) {
      // Для Wikimedia: берём thumbUrl через Commons API (прямой URL отдаёт 424/400)
      thumbUrl = await wikimediaThumbFromUrl(r.url);
      if (!thumbUrl) continue;
    } else {
      thumbUrl = r.thumbnail || r.url;
    }
    return {
      thumbUrl,
      file: r.url || r.foreign_landing_url || r.id,
      license: r.license_version ? `${r.license}-${r.license_version}` : r.license,
      author: r.creator || 'unknown',
      allowed: true,
    };
  }
  return null;
}

/**
 * Перебирает варианты запросов в Openverse и возвращает первый результат.
 */
async function pickFromOpenverse(queries) {
  for (const q of queries.filter(Boolean)) {
    try {
      const result = await searchOpenverse(q);
      if (result) return result;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Metropolitan Museum of Art Open Access — isPublicDomain: true, ключ не нужен.
 * @returns {Promise<{thumbUrl,file,license,author}|null>}
 */
async function findInMET(term) {
  const variants = [term, simplifyQuery(term), firstWords(term, 3)]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  for (const v of variants) {
    try {
      const data = await jsonFetch(
        `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(v)}&hasImages=true`
      );
      for (const objId of (data?.objectIDs ?? []).slice(0, 5)) {
        const obj = await jsonFetch(
          `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objId}`
        );
        if (obj?.isPublicDomain && obj?.primaryImageSmall) {
          return {
            thumbUrl: obj.primaryImageSmall,
            file: `MET-${objId}: ${(obj.title || '').slice(0, 50)}`,
            license: 'Public domain',
            author: obj.artistDisplayName || 'unknown',
            allowed: true,
          };
        }
      }
    } catch { /* следующий вариант */ }
  }
  return null;
}

/** Resolves with the first non-null value, or null when all settle to null/error. */
function raceNonNull(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) { resolve(null); return; }
    for (const p of promises) {
      Promise.resolve(p).then(
        (v) => { if (v != null) resolve(v); else if (--pending === 0) resolve(null); },
        ()  => { if (--pending === 0) resolve(null); }
      );
    }
  });
}

/**
 * Точные кандидаты по запросу. Пробуем несколько вариантов запроса (полный,
 * без наполнителей, первые 3 слова), т.к. многословные imageSearchQuery плохо
 * матчатся на заголовок статьи и AND-поиск Commons. Картинки статей Wikipedia
 * идут раньше Commons-поиска (он шумнее).
 */
async function collectPreciseCandidates(searchQuery) {
  const files = [];
  const add = (f) => { if (f && isUsableImageFile(f) && !files.includes(f)) files.push(f); };
  const variants = [searchQuery, simplifyQuery(searchQuery), firstWords(searchQuery, 3)]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  // 1) Главная картинка статьи (точное название) — самый релевантный источник.
  for (const v of variants) {
    for (const lang of ['ru', 'en']) {
      try { add(await resolvePageImage(v, lang)); } catch { /* next */ }
    }
  }
  // 2) Поиск похожих статей.
  for (const v of variants) {
    for (const lang of ['ru', 'en']) {
      try { add(await resolveViaSearch(v, lang)); } catch { /* next */ }
    }
  }
  // 3) Commons-поиск по каждому варианту (последний приоритет — шумный).
  for (const v of variants) {
    try { (await searchCommonsFiles(v, 5)).forEach(add); } catch { /* next */ }
  }
  return files.slice(0, 12);
}

// ---------- основная логика ----------

/** Wikipedia/Commons поиск — возвращает {chosen, blocked}. */
async function findInWikimedia(searchQuery, fallbackQuery) {
  const precise = await collectPreciseCandidates(searchQuery);
  let { chosen, blocked } = await pickAllowed(precise);
  if (!chosen) {
    let approx = [];
    try { approx = await searchCommonsFiles(fallbackQuery, 8); } catch { /* ignore */ }
    const r2 = await pickAllowed(approx);
    if (r2.chosen) chosen = r2.chosen;
    blocked = blocked.concat(r2.blocked);
  }
  return { chosen, blocked };
}

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

  try {
    // Три источника стартуют параллельно; побеждает тот, кто ответит первым.
    let wikimediaBlocked = [];

    const wikimediaP = findInWikimedia(searchQuery, fallbackQuery)
      .then(r => { wikimediaBlocked = r.blocked; return r.chosen; })
      .catch(() => null);

    const openverseP = pickFromOpenverse([searchQuery, fallbackQuery])
      .then(r => { if (r) console.log(`  [openverse] ${id} → ${r.file}`); return r; })
      .catch(() => null);

    const metP = findInMET(searchQuery)
      .then(r => { if (r) console.log(`  [met] ${id} → ${r.file}`); return r; })
      .catch(() => null);

    const chosen = await raceNonNull([wikimediaP, openverseP, metP]);

    if (!chosen) {
      if (wikimediaBlocked.length) {
        console.log(`  [лицензия] ${id} — найдено, но не PD/CC0 (${wikimediaBlocked[0].license})`);
        return { id, status: 'license_blocked', query: searchQuery, rejectedLicense: wikimediaBlocked[0].license };
      }
      console.log(`  [не найдено] ${id}`);
      return { id, status: 'not_found', query: searchQuery };
    }

    const ext = extFromUrl(chosen.thumbUrl);
    const destPath = path.join(IMAGES_DIR, `${id}.${ext}`);
    await downloadFile(chosen.thumbUrl, destPath);
    const { beforeKb, afterKb, webp } = await optimizeImage(destPath);
    console.log(`  [OK] ${webp} (${beforeKb} KB → ${afterKb} KB, ${chosen.license}) ← ${chosen.file}`);
    return { id, status: 'ok', file: webp, license: chosen.license, author: chosen.author };
  } catch (e) {
    console.log(`  [ошибка] ${id}: ${e.message}`);
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

  console.log(`BigQuiz image fetcher — ${toProcess.length} вопросов (Wikimedia+Openverse+MET параллельно, до ${CONCURRENCY} вопросов одновременно)\n`);

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
