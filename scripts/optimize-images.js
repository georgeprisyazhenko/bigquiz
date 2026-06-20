#!/usr/bin/env node
/**
 * Шаг оптимизации изображений для вопросов викторины.
 *
 * Берёт картинки из public/assets/images/, ужимает каждую до WebP
 * (длинная сторона <= 768px, quality 82) и перемещает исходник
 * (jpg/png/gif/…) в scripts/images-raw/ — чтобы тяжёлые оригиналы
 * не попадали в архив игры (всё из public/ уходит в сборку, а у
 * Яндекс.Игр лимит 100 МБ).
 *
 * Игровой код предпочитает .webp (см. getImageCandidatePaths в src/main.js).
 *
 * Запуск:
 *   node scripts/optimize-images.js                 — все не-webp картинки
 *   node scripts/optimize-images.js --skip-existing — пропускать, если .webp уже есть
 *   node scripts/optimize-images.js q_001 q_002     — только эти id
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public', 'assets', 'images');
const RAW_DIR = path.join(__dirname, 'images-raw');

// Пресет: см. docs/GDD_LITE.md. Картинка показывается на 333x250 (буфер x2),
// поэтому крупнее ~768px смысла нет.
const MAX_DIM = 768;
const QUALITY = 82;
const EFFORT = 6;

const SOURCE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif'];

/**
 * Сжимает один файл в WebP рядом с ним и переносит оригинал в RAW_DIR.
 * @returns {Promise<{ id: string, beforeKb: number, afterKb: number, webp: string }>}
 */
export async function optimizeImage(srcPath, opts = {}) {
  const maxDim = opts.maxDim ?? MAX_DIM;
  const quality = opts.quality ?? QUALITY;

  const dir = path.dirname(srcPath);
  const ext = path.extname(srcPath);
  const id = path.basename(srcPath, ext);
  const isWebp = ext.toLowerCase() === '.webp';

  const beforeBytes = fs.statSync(srcPath).size;
  const outPath = path.join(dir, `${id}.webp`);

  const pipeline = sharp(srcPath)
    .rotate() // применить EXIF-ориентацию, потом метаданные отбрасываются
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: EFFORT });

  if (isWebp) {
    // Источник уже webp: нельзя писать в тот же файл во время чтения — пишем во временный.
    const tmpPath = path.join(dir, `${id}.webp.tmp`);
    await pipeline.toFile(tmpPath);
    fs.renameSync(tmpPath, outPath);
  } else {
    await pipeline.toFile(outPath);
    // Переносим оригинал из public/ (архив игры) в raw-папку.
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.renameSync(srcPath, path.join(RAW_DIR, path.basename(srcPath)));
  }

  const afterBytes = fs.statSync(outPath).size;
  return {
    id,
    beforeKb: Math.round(beforeBytes / 1024),
    afterKb: Math.round(afterBytes / 1024),
    webp: `${id}.webp`,
  };
}

function listSourceFiles() {
  if (!fs.existsSync(IMAGES_DIR)) return [];
  return fs
    .readdirSync(IMAGES_DIR)
    .filter((name) => SOURCE_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .map((name) => path.join(IMAGES_DIR, name));
}

async function main() {
  const args = process.argv.slice(2);
  const skipExisting = args.includes('--skip-existing');
  const targetIds = args.filter((a) => !a.startsWith('--'));

  let files = listSourceFiles();
  if (targetIds.length) {
    files = files.filter((f) => targetIds.includes(path.basename(f, path.extname(f))));
  }

  console.log(`BigQuiz image optimizer — ${files.length} файлов (WebP ${MAX_DIM}px q${QUALITY})\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let done = 0;
  let skipped = 0;

  for (const file of files) {
    const id = path.basename(file, path.extname(file));
    const webpPath = path.join(IMAGES_DIR, `${id}.webp`);

    if (skipExisting && fs.existsSync(webpPath)) {
      console.log(`  [skip] ${id} — .webp уже есть`);
      skipped++;
      continue;
    }

    try {
      const { beforeKb, afterKb } = await optimizeImage(file);
      const saved = beforeKb ? Math.round((1 - afterKb / beforeKb) * 100) : 0;
      console.log(`  [OK] ${id}: ${beforeKb} KB → ${afterKb} KB (−${saved}%)`);
      totalBefore += beforeKb;
      totalAfter += afterKb;
      done++;
    } catch (e) {
      console.log(`  [ошибка] ${id}: ${e.message}`);
    }
  }

  console.log('\n── Итог ──');
  console.log(`  Оптимизировано: ${done}`);
  if (skipped) console.log(`  Пропущено:      ${skipped}`);
  if (done) {
    const totalSaved = totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;
    console.log(`  Вес: ${totalBefore} KB → ${totalAfter} KB (−${totalSaved}%)`);
    console.log(`  Оригиналы перенесены в: ${path.relative(ROOT, RAW_DIR)}/`);
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
