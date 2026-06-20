// Воркфлоу-аннотатор собранных с guestion.ru вопросов (scripts/scrape-out/*.json).
// Цель — УЧЕБНАЯ: понять чужое ремесло постановки. Размечает каждый вопрос по нашим
// осям судейства (docs/category-risks.md) и по типу угла (A.10), выставляет наш вердикт
// (взяли бы как есть?) и ценность как ЗАТРАВКИ темы. НЕ для копирования вопросов в прод.
//
// Запуск (после сбора данных скриптом scripts/scrape-guestion.mjs --all):
//   Workflow({ scriptPath: "scripts/annotate-questions.workflow.js" })
// По желанию ограничить набор:
//   Workflow({ scriptPath: "scripts/annotate-questions.workflow.js", args: { files: ["scripts/scrape-out/nauka.json"] } })
//
// Пайплайн (pipeline без барьеров, по файлу-категории):
//   1. Annotate — Sonnet: читает docs/category-risks.md + файл категории, размечает ВСЕ вопросы пачкой.
//   2. Save     — Haiku: пишет scripts/annotate-out/<slug>.json (дёшево, резюмируемо).
// Затем барьер и финальный синтез (Sonnet): кросс-категорийный отчёт docs/guestion-style-report.md.

export const meta = {
  name: 'annotate-questions',
  description: 'Учебная разметка чужих вопросов (guestion.ru) по нашим осям судьи + тип угла + ценность затравки',
  phases: [
    { title: 'List', detail: 'Haiku: список файлов scripts/scrape-out/*.json' },
    { title: 'Annotate', detail: 'Sonnet: разметка вопросов категории пачкой' },
    { title: 'Save', detail: 'Haiku: scripts/annotate-out/<slug>.json' },
    { title: 'Synthesize', detail: 'Sonnet: docs/guestion-style-report.md' }
  ]
}

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = null } }

const ANGLE_TYPES = [
  'object-name',        // какой/кто/что — объект/имя/термин
  'number-scale',       // сколько/насколько — число/масштаб/величина
  'naming-origin',      // как называли/прозвали, происхождение названия
  'odd-one-out',        // что лишнее / что общего
  'chronology',         // что раньше / хронология
  'identify-by-trait',  // опознать по признаку/функции
  'quote-attribution',  // кому принадлежит цитата
  'other'
]

const ANNOTATE_SCHEMA = {
  type: 'object',
  required: ['category', 'source', 'annotations', 'summary'],
  properties: {
    category: { type: 'string' },
    source: { type: 'string' },
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sourceId', 'factOverLabel', 'inSweetSpot', 'cleanDistractors', 'naturalLanguage', 'factuallyCorrect', 'concise', 'angleType', 'ourVerdict', 'seedValue', 'note'],
        properties: {
          sourceId: { type: 'string' },
          factOverLabel: { type: 'boolean' },   // ГЛАВНОЕ: факт/механизм, а не зубримый ярлык
          inSweetSpot: { type: 'boolean' },      // ответят ~45-75% образованных взрослых
          cleanDistractors: { type: 'boolean' }, // 4 из одной области, не синонимы/дубли, ровно один верный
          naturalLanguage: { type: 'boolean' },  // живой русский без канцелярита/жаргона
          factuallyCorrect: { type: 'boolean' }, // факт верен и не миф/байка
          concise: { type: 'boolean' },          // НАШИ лимиты: вопрос одно предложение ≤240, ответы ≤44 симв/≤5 слов
          angleType: { type: 'string', enum: ANGLE_TYPES },
          ourVerdict: { type: 'string', enum: ['keep', 'revise', 'drop'] }, // взяли бы как есть под наш свод
          seedValue: { type: 'string', enum: ['high', 'medium', 'low'] },   // ценность как ЗАТРАВКА темы
          note: { type: 'string' }               // кратко по-русски: за что и какой угол
        }
      }
    },
    summary: { type: 'string' }
  }
}

const FILES_SCHEMA = {
  type: 'object', required: ['files'],
  properties: { files: { type: 'array', items: { type: 'string' } } }
}

const annotatePrompt = (file) => `Ты разбираешь ЧУЖИЕ вопросы викторины (сайт guestion.ru) РАДИ ИЗУЧЕНИЯ ремесла постановки - не для копирования. Прочитай ПОЛНОСТЬЮ наш свод правил docs/category-risks.md (особенно A.3 «факт, не ярлык», A.5 ответы/дистракторы, A.8 язык/длина, A.9 анти-миф, A.10 типы углов). Затем прочитай файл с собранными вопросами: ${file} (поля: question, answers[4], correctAnswerIndex, correctAnswer, tags, sourceId).

Размечай КАЖДЫЙ вопрос из файла по нашим осям. Для каждого верни объект:
- sourceId - из файла.
- factOverLabel: true, если правильный ответ - интересный факт/механизм/причина/масштаб, а НЕ зубримый ярлык (имя/термин/дата/аббревиатура) ради него самого. ГЛАВНАЯ ось.
- inSweetSpot: true, если ответят ~45-75% образованных взрослых (не банальщина >90%, не ультранишевость <30%).
- cleanDistractors: true, если 4 варианта из одной области, различимы (не синонимы и не дубли), нет протечки слова-ответа, и ровно ОДИН верный.
- naturalLanguage: true, если живой грамотный русский без канцелярита/жаргона/англо-аббревиатур и без знаков ударения.
- factuallyCorrect: true, если факт верен и это НЕ развенчанный миф/байка/мисатрибуция цитаты.
- concise: true, если влезает в НАШИ лимиты - вопрос строго одно предложение (≤240 симв., без вступлений на 2-3 фразы) И каждый ответ ≤5 слов / ≤44 символов. У guestion.ru вопросы часто длинные и «два-в-одном» - честно ставь false.
- angleType: один из ${JSON.stringify(ANGLE_TYPES)} (A.10).
- ourVerdict: keep|revise|drop - взяли бы мы этот вопрос КАК ЕСТЬ под наш свод (keep - только если по сути все оси ок; drop - миф/нет одного верного/безнадёжный ярлык; revise - годная идея, но форму чинить).
- seedValue: high|medium|low - насколько хорош сам ФАКТ/тема как затравка для нашего вопроса, ДАЖЕ если форма плохая (high - яркий неизбитый факт-сюрприз; low - банальщина или зубрёжка).
- note: 1 короткая фраза по-русски - в чём суть оценки.

Также верни category и source (из файла) и summary (2-3 предложения: какие углы у этой категории сильные, какие типовые нарушения нашего свода, сколько примерно годных затравок). Верни строго по схеме.`

// ---- 0. Список файлов ----
phase('List')
let files = (A && Array.isArray(A.files)) ? A.files : null
if (!files) {
  const listed = await agent(
    'Выполни `ls scripts/scrape-out/*.json` и верни массив путей (относительных, как выведено). Если папки нет или она пуста - верни пустой массив.',
    { label: 'list-files', phase: 'List', model: 'haiku', schema: FILES_SCHEMA }
  )
  files = (listed && listed.files) || []
}
if (!files.length) {
  log('Нет файлов в scripts/scrape-out/ - сначала запусти scripts/scrape-guestion.mjs --all.')
  return { error: 'no-input', annotated: 0 }
}
log(`Категорий к разметке: ${files.length}.`)

// ---- 1-2. Разметка + запись (pipeline без барьеров) ----
phase('Annotate')
const results = await pipeline(
  files,
  (file) => agent(annotatePrompt(file), { label: `annot:${file.split('/').pop()}`, phase: 'Annotate', model: 'sonnet', schema: ANNOTATE_SCHEMA }),
  async (res, file) => {
    if (!res) return null
    const slug = file.split('/').pop().replace(/\.json$/, '')
    const counts = {
      category: res.category,
      total: res.annotations.length,
      keep: res.annotations.filter((a) => a.ourVerdict === 'keep').length,
      revise: res.annotations.filter((a) => a.ourVerdict === 'revise').length,
      drop: res.annotations.filter((a) => a.ourVerdict === 'drop').length,
      factOverLabel: res.annotations.filter((a) => a.factOverLabel).length,
      concise: res.annotations.filter((a) => a.concise).length,
      seedHigh: res.annotations.filter((a) => a.seedValue === 'high').length,
      summary: res.summary
    }
    await agent(
      `Создай файл scripts/annotate-out/${slug}.json (создай папку scripts/annotate-out, если её нет) и запиши в него ДОСЛОВНО следующий JSON целиком, ничего не меняя. После записи ответь только словом ok.\n\n${JSON.stringify(res)}`,
      { label: `save:${slug}`, phase: 'Save', model: 'haiku' }
    )
    return counts
  }
)

const clean = results.filter(Boolean)
if (!clean.length) return { error: 'all-failed', annotated: 0 }

// ---- 3. Кросс-категорийный синтез ----
phase('Synthesize')
const sum = (k) => clean.reduce((a, r) => a + r[k], 0)
const totals = {
  categories: clean.length,
  questions: sum('total'),
  keep: sum('keep'), revise: sum('revise'), drop: sum('drop'),
  factOverLabel: sum('factOverLabel'), concise: sum('concise'), seedHigh: sum('seedHigh')
}
const digest = clean.map((r) => ({ category: r.category, total: r.total, keep: r.keep, revise: r.revise, drop: r.drop, factOverLabel: r.factOverLabel, concise: r.concise, seedHigh: r.seedHigh, summary: r.summary }))

await agent(
  `Ты пишешь учебный отчёт по чужим вопросам викторины (guestion.ru), размеченным по нашему своду docs/category-risks.md. Цель - извлечь уроки ремесла: что у них работает (углы, факты-сюрпризы) и что мы бы зарубили (длина, «два-в-одном», грязные дистракторы, ярлыки, мифы). Это НЕ план копирования вопросов.

Сводные числа по всем категориям:
${JSON.stringify(totals, null, 2)}

Разбивка и саммари по категориям:
${JSON.stringify(digest, null, 2)}

Полные поштучные разметки лежат в scripts/annotate-out/<slug>.json (читай при необходимости).

Напиши файл docs/guestion-style-report.md (Write) на русском со структурой:
1. # Отчёт: разбор вопросов guestion.ru под наш свод - 1 абзац о цели и объёме (числа из сводки: всего вопросов, доля concise, доля factOverLabel, сколько high-seed).
2. ## Что у них работает - сильные углы и типы фактов-сюрпризов, которые стоит перенимать как ЗАТРАВКИ (с 3-5 конкретными примерами sourceId/темы из annotate-out).
3. ## Что мы бы зарубили - частые нарушения нашего свода (длина/«два-в-одном», длинные варианты, грязные/дублирующиеся дистракторы, ярлык-задротство, мифы) с примерами.
4. ## Углы по A.10 - какие типы углов у них преобладают и каких нам не хватает.
5. ## Категории-доноры - топ категорий по доле high-seed (лучшие источники тем для нашего пайплайна).
6. ## Вывод - 3-5 буллетов: как использовать это в нашей генерации (брать тему/факт, чинить форму).

После записи ответь одним абзацем-резюме (3-5 предложений) для меня.`,
  { label: 'synthesize', phase: 'Synthesize', model: 'sonnet' }
)

return { ...totals, report: 'docs/guestion-style-report.md', perCategory: digest.map((d) => ({ category: d.category, keep: d.keep, seedHigh: d.seedHigh })) }
