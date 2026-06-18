#!/usr/bin/env node
/**
 * Скрипт автоматического скачивания изображений для вопросов викторины.
 *
 * Для каждого вопроса без картинки берёт правильный ответ как поисковый запрос,
 * ищет изображение через Wikipedia API (сначала ru, потом en),
 * скачивает и сохраняет в public/assets/images/.
 *
 * Запуск: node scripts/fetch-images.js
 * Только новые: node scripts/fetch-images.js --skip-existing
 * Конкретные id: node scripts/fetch-images.js q_001 q_002
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public', 'assets', 'images');
const QUESTIONS_FILE = path.join(ROOT, 'public', 'questions.json');

const DELAY_MS = 2000; // пауза между запросами чтобы не нагружать API
const THUMB_SIZE = 800;

const args = process.argv.slice(2);
const skipExisting = args.includes('--skip-existing');
const targetIds = args.filter(a => !a.startsWith('--'));

// ---------- утилиты ----------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function downloadFile(url, destPath, retries = 4) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; BigQuiz-ImageFetcher/1.0)',
    'Accept': 'image/webp,image/jpeg,image/png,image/*,*/*',
    'Accept-Language': 'ru,en;q=0.9',
    'Referer': 'https://ru.wikipedia.org/',
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

async function apiFetch(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'BigQuiz-ImageFetcher/1.0' } });
    if (res.status === 429) {
      if (attempt < retries) {
        const wait = 2000 * (attempt + 1);
        await sleep(wait);
        continue;
      }
      throw new Error('HTTP 429');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

// ---------- стратегии поиска ----------

/** Wikipedia pageimages — возвращает URL главной картинки статьи */
async function fetchFromWikipedia(term, lang = 'ru') {
  const encoded = encodeURIComponent(term);
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encoded}&prop=pageimages&format=json&pithumbsize=${THUMB_SIZE}&pilicense=any`;
  const data = await apiFetch(url);
  const pages = data?.query?.pages ?? {};
  for (const page of Object.values(pages)) {
    if (page.thumbnail?.source) return page.thumbnail.source;
  }
  return null;
}

/** Wikipedia opensearch — ищет похожие статьи и берёт картинку первой */
async function fetchFromWikipediaSearch(term, lang = 'ru') {
  const encoded = encodeURIComponent(term);
  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encoded}&limit=3&format=json`;
  const data = await apiFetch(searchUrl);
  const titles = data?.[1] ?? [];
  for (const title of titles) {
    const imgUrl = await fetchFromWikipedia(title, lang);
    if (imgUrl) return imgUrl;
  }
  return null;
}

/** Wikimedia Commons search — fallback для иллюстративных запросов */
async function fetchFromCommons(term) {
  const encoded = encodeURIComponent(term);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encoded}&format=json&srlimit=5`;
  const data = await apiFetch(url);
  const results = data?.query?.search ?? [];
  for (const result of results) {
    const title = result.title; // "File:Something.jpg"
    const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_SIZE}&format=json`;
    const info = await apiFetch(infoUrl);
    const pages = info?.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const src = page.imageinfo?.[0]?.thumburl ?? page.imageinfo?.[0]?.url;
      if (src) return src;
    }
  }
  return null;
}

// ---------- основная логика ----------

async function findImageUrl(question) {
  const searchQuery = question.imageSearchQuery
    || question.answers[question.correctAnswerIndex];
  const fallbackQuery = question.question.slice(0, 60);

  // Пробуем в порядке убывания точности
  const strategies = [
    () => fetchFromWikipedia(searchQuery, 'ru'),
    () => fetchFromWikipedia(searchQuery, 'en'),
    () => fetchFromWikipediaSearch(searchQuery, 'ru'),
    () => fetchFromWikipediaSearch(searchQuery, 'en'),
    () => fetchFromCommons(searchQuery),
    () => fetchFromCommons(fallbackQuery),
  ];

  for (const strategy of strategies) {
    try {
      const url = await strategy();
      if (url) return url;
    } catch (e) {
      // пробуем следующую стратегию
    }
  }
  return null;
}

function extFromUrl(url) {
  const match = url.match(/\.(jpe?g|png|webp|gif|svg)/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function processQuestion(question) {
  const id = question.id;
  const searchQuery = question.imageSearchQuery
    || question.answers[question.correctAnswerIndex];

  // Проверяем, есть ли уже файл на диске
  const extensions = ['jpg', 'jpeg', 'png', 'webp'];
  const existingFile = extensions
    .map(ext => path.join(IMAGES_DIR, `${id}.${ext}`))
    .find(p => fs.existsSync(p));

  if (existingFile && skipExisting) {
    console.log(`  [skip] ${id} — уже есть ${path.basename(existingFile)}`);
    return { id, status: 'skipped' };
  }

  console.log(`  [поиск] ${id}: "${searchQuery}"`);
  const imgUrl = await findImageUrl(question);

  if (!imgUrl) {
    console.log(`  [не найдено] ${id}`);
    return { id, status: 'not_found' };
  }

  const ext = extFromUrl(imgUrl);
  const destPath = path.join(IMAGES_DIR, `${id}.${ext}`);

  try {
    await downloadFile(imgUrl, destPath);
    const sizeKb = Math.round(fs.statSync(destPath).size / 1024);
    console.log(`  [OK] ${id}.${ext} (${sizeKb} KB) ← ${imgUrl.slice(0, 80)}…`);
    return { id, status: 'ok', file: `${id}.${ext}` };
  } catch (e) {
    console.log(`  [ошибка скачивания] ${id}: ${e.message}`);
    return { id, status: 'error', error: e.message };
  }
}

async function main() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
  const { questions } = JSON.parse(raw);

  const toProcess = targetIds.length
    ? questions.filter(q => targetIds.includes(q.id))
    : questions;

  console.log(`BigQuiz image fetcher — ${toProcess.length} вопросов\n`);

  const results = { ok: [], skipped: [], not_found: [], error: [] };

  for (const question of toProcess) {
    const result = await processQuestion(question);
    results[result.status]?.push(result.id);
    await sleep(DELAY_MS);
  }

  console.log('\n── Итог ──');
  console.log(`  Скачано:     ${results.ok.length}`);
  console.log(`  Пропущено:   ${results.skipped.length}`);
  console.log(`  Не найдено:  ${results.not_found.length}`);
  if (results.not_found.length) console.log(`               ${results.not_found.join(', ')}`);
  console.log(`  Ошибки:      ${results.error.length}`);
  if (results.error.length) console.log(`               ${results.error.join(', ')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
