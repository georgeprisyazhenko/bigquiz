// Воркфлоу полного наполнения BigQuiz вопросами.
// Запуск: Workflow({ scriptPath: "scripts/fill-questions.workflow.js", args: { subcats: [...], perSubcat: 15 } })
//   args.subcats   — массив { id, name, cat } подкатегорий для этой партии (см. docs/generation-runbook.md).
//   args.perSubcat — сколько вопросов генерить на подкатегорию (по умолчанию 15; судья отберёт лучшие).
//
// Пайплайн на каждую подкатегорию (конкурентно, pipeline без барьеров):
//   1. Generate — Sonnet, читает docs/category-risks.md, генерит N вопросов.
//   2. Judge    — Opus, effort: 'low' (быстрый отбор), судит всю пачку за один вызов по schema.
//   3. Save     — Haiku, пишет результат подкатегории в scripts/gen-out/<id>.json (дёшево, резюмируемо).
// Полные данные НЕ возвращаются (на 126 подкат это переполнило бы контекст) — они на диске,
// дальше их сливает scripts/merge-gen.mjs. Воркфлоу возвращает только компактные метрики.

export const meta = {
  name: 'fill-questions',
  description: 'Наполнение вопросами: генерация (Sonnet 15/подкат) → судья (Opus effort low) → запись по подкатегории',
  phases: [
    { title: 'Generate', detail: 'Sonnet: N вопросов на подкатегорию' },
    { title: 'Judge', detail: 'Opus effort low: вердикты пачкой' },
    { title: 'Save', detail: 'Haiku: scripts/gen-out/<id>.json' }
  ]
}

// args может прийти как объект ИЛИ как JSON-строка — нормализуем.
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = null } }
const SUBCATS = (A && A.subcats) || []
const N = (A && A.perSubcat) || 15

if (!SUBCATS.length) {
  log('args.subcats пуст — нечего генерировать. Передай массив { id, name, cat }.')
  return { error: 'no-subcats', generated: 0 }
}
log(`Подкатегорий в партии: ${SUBCATS.length}, по ${N} вопросов на каждую.`)

const GEN_SCHEMA = {
  type: 'object',
  required: ['questions'],
  properties: {
    questions: {
      type: 'array', minItems: N, maxItems: N,
      items: {
        type: 'object',
        required: ['question', 'answers', 'correctAnswerIndex', 'explanation', 'imageSearchQuery', 'categories'],
        properties: {
          question: { type: 'string' },
          answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', maxLength: 44 } },
          correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
          explanation: { type: 'string' },
          imageSearchQuery: { type: 'string' },
          categories: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } }
        }
      }
    }
  }
}

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['verdicts', 'summary'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'verdict', 'reason', 'factuallyCorrect', 'inSweetSpot', 'factOverLabel', 'naturalLanguage', 'cleanDistractors'],
        properties: {
          index: { type: 'integer' },
          verdict: { type: 'string', enum: ['keep', 'revise', 'drop'] },
          reason: { type: 'string' },
          factuallyCorrect: { type: 'boolean' },
          inSweetSpot: { type: 'boolean' },
          factOverLabel: { type: 'boolean' },
          naturalLanguage: { type: 'boolean' },
          cleanDistractors: { type: 'boolean' }
        }
      }
    },
    summary: { type: 'string' }
  }
}

const genPrompt = (sc, n) => `Прочитай инструкцию по генерации docs/category-risks.md ПОЛНОСТЬЮ (особенно A.3 «факт, а не ярлык», A.5, A.8, A.9, A.10) и найди в Части C заметку именно по подкатегории "${sc.name}" (id: ${sc.id}). Сверься с деревом docs/categories.md. Затем сгенерируй РОВНО ${n} вопросов для этой подкатегории (верхняя категория: ${sc.cat}).

Критичные акценты:
- ГЛАВНОЕ (A.3): ФАКТ, а не ЯРЛЫК. Не спрашивай имя/термин/дату/аббревиатуру/спецификацию ради них самих — это «задротство». Спрашивай зачем/как/насколько/как применяли/почему так устроено. Цель — «не знал, расскажу друзьям».
- Воспроизводи 4 архетипа: происхождение знакомого слова/вещи · функция/назначение детали · история случайной находки · яркий образ/смысл.
- ЖЁСТКИЙ лимит ответа (соблюдай при генерации!): ≤ 5 слов, ≤ 44 символов, ни одно слово > 18 символов. Идеал 1-3 слова. Однородные; дистракторы из одной области, без очевидно-чужого, без протечки слова-ответа.
- РОВНО ОДИН верный: дистракторы однозначно неверны под формулировку и логичны под неё; варианты начинаются с РАЗНЫХ слов (не «За счёт… ×4»).
- Естественный разговорный язык, грамотный живой русский: без жаргона, англо-аббревиатур и канцелярита в теле (формализм — в explanation).
- Только дефис (минус), НЕ длинное и НЕ среднее тире - нигде. БЕЗ знаков ударения. Числа цифрами. ОДНО предложение, без вступлений на 2-3 фразы.
- «Зачем» — только про намеренное действие; для явлений природы — «почему».
- Каждый вопрос несёт сильный explanation (факт-награда); если самый «ого»-факт оказался в explanation — вынеси его в вопрос. Соблюдай Часть C для подкатегории.
- Разнообразь углы (A.10): не более 2–3 вопросов одного типа на партию. Не бери факты, угадываемые здравым смыслом за секунду.

В categories укажи как минимум "${sc.id}"; можно добавить смежные ВАЛИДНЫЕ id из дерева (максимум 3). Верни строго по схеме.`

const judgePrompt = (sc, questions) => `Ты строгий судья-фактчекер вопросов викторины для взрослых. Подкатегория "${sc.name}". Свериться с docs/category-risks.md — A.3 «факт, а не ярлык», A.5 (ответы/дистракторы), A.8 (язык), A.9 (анти-миф). Оцени каждый из ${questions.length} вопросов (index с 0).

Вопросы:
${JSON.stringify(questions, null, 2)}

Для КАЖДОГО верни:
- index, verdict (keep|revise|drop), reason (кратко по-русски — за что).
- factuallyCorrect: факт верен и не миф/байка.
- inSweetSpot: ответят ~45–75% образованных взрослых (не банальщина, не ультранишевость).
- factOverLabel: ответ — интересный факт/механизм/причина, А НЕ зубримый ярлык ради него самого. ГЛАВНЫЙ критерий.
- naturalLanguage: разговорный язык, без жаргона/англо-аббревиатур/канцелярита и БЕЗ знаков ударения.
- cleanDistractors: 4 варианта из одной области, без очевидно-чужого, без протечки слова-ответа, не синонимы.

verdict=keep ТОЛЬКО если все пять флагов true. drop — если factuallyCorrect=false ИЛИ явный «ярлык-задротство» (не спасти переформулировкой). revise — годная идея с правимым изъяном.
summary: 1–2 предложения по партии (разнообразие углов, типовые проблемы).`

phase('Generate')
const results = await pipeline(
  SUBCATS,
  // 1. Генерация — Sonnet. effort генератора НЕ занижаем: он защищает качество вопросов.
  (sc) => agent(genPrompt(sc, N), { label: `gen:${sc.id}`, phase: 'Generate', model: 'sonnet', schema: GEN_SCHEMA }),

  // 2. Судья — Opus (наследует дефолт сессии), effort: 'low' для скорости. Батч из N вопросов за вызов.
  (gen, sc) => {
    if (!gen) return null
    return agent(judgePrompt(sc, gen.questions), { label: `judge:${sc.id}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'low' })
      .then((j) => ({
        subId: sc.id,
        subName: sc.name,
        questions: gen.questions,
        verdicts: (j && j.verdicts) || [],
        summary: (j && j.summary) || ''
      }))
  },

  // 3. Запись — Haiku пишет результат подкатегории на диск (дёшево, резюмируемо). Возвращаем только метрики.
  async (asg, sc) => {
    if (!asg) return null
    const counts = {
      subId: sc.id,
      subName: sc.name,
      keep: asg.verdicts.filter((v) => v.verdict === 'keep').length,
      revise: asg.verdicts.filter((v) => v.verdict === 'revise').length,
      drop: asg.verdicts.filter((v) => v.verdict === 'drop').length
    }
    await agent(
      `Создай файл scripts/gen-out/${sc.id}.json (создай папку scripts/gen-out, если её нет) и запиши в него ДОСЛОВНО следующий JSON целиком, ничего не добавляя и не переформатируя. После записи ответь только словом ok.\n\n${JSON.stringify(asg)}`,
      { label: `save:${sc.id}`, phase: 'Save', model: 'haiku' }
    )
    return counts
  }
)

const clean = results.filter(Boolean)
const sum = (k) => clean.reduce((a, r) => a + r[k], 0)
return {
  subcats: clean.length,
  keep: sum('keep'),
  revise: sum('revise'),
  drop: sum('drop'),
  bySubcat: clean.map((r) => ({ sub: r.subName, keep: r.keep, revise: r.revise, drop: r.drop }))
}
