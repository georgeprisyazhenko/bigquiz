// Полная чистка вопросов guestion.ru под наш свод (НЕ аудит - чиним, не отсеиваем).
// Вход: scripts/clean-in/*.json (per-category, см. scripts/prep-clean-in.mjs).
// Пайплайн на категорию (pipeline без барьеров):
//   1. Repair    — Sonnet medium: переписать в чистую форму BigQuiz + угол 1-5 + factDoubt.
//   2. Proofread — Sonnet medium: отдельный грамма-корректор (согласование/падежи/пунктуация).
//   3. FactCheck — Sonnet medium + веб: ТОЛЬКО по factDoubt && угол>2.
//   4. Save      — Haiku: scripts/clean-out/<slug>.json (резюмируемо).
// Дальше scripts/merge-clean.mjs собирает public/guestion-clean.json.
// Запуск: Workflow({ scriptPath: "scripts/clean-questions.workflow.js" })

export const meta = {
  name: 'clean-questions',
  description: 'Полная чистка guestion: ремонт (Sonnet med) → корректор → веб-факт по сомнительным → запись',
  phases: [
    { title: 'Repair', detail: 'Sonnet medium: чистая форма + угол 1-5' },
    { title: 'Proofread', detail: 'Sonnet medium: грамма-корректор' },
    { title: 'FactCheck', detail: 'Sonnet medium + веб: только сомнительные с углом>2' },
    { title: 'Save', detail: 'Haiku: scripts/clean-out/<slug>.json' }
  ]
}

const REPAIR_ITEM = {
  type: 'object',
  required: ['id', 'cleanedQuestion', 'cleanedAnswers', 'correctAnswerIndex', 'changed', 'fixable', 'prohibitedYG', 'guardrails', 'angle', 'banal', 'factDoubt'],
  properties: {
    id: { type: 'string' },
    cleanedQuestion: { type: 'string' },
    cleanedAnswers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
    correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
    changed: { type: 'string' },
    fixable: { type: 'boolean' },
    prohibitedYG: { type: 'boolean' },
    guardrails: {
      type: 'object', required: ['compactness', 'language', 'distractors'],
      properties: {
        compactness: { type: 'object', required: ['ok', 'note'], properties: { ok: { type: 'boolean' }, note: { type: 'string' } } },
        language: { type: 'object', required: ['ok', 'note'], properties: { ok: { type: 'boolean' }, note: { type: 'string' } } },
        distractors: { type: 'object', required: ['ok', 'note'], properties: { ok: { type: 'boolean' }, note: { type: 'string' } } }
      }
    },
    angle: { type: 'object', required: ['score', 'type', 'note'], properties: { score: { type: 'integer', minimum: 1, maximum: 5 }, type: { type: 'string' }, note: { type: 'string' } } },
    banal: { type: 'boolean' },
    factDoubt: { type: 'boolean' },
    factNote: { type: 'string' }
  }
}
const REPAIR_SCHEMA = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: REPAIR_ITEM } } }

const PROOF_SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'cleanedQuestion', 'cleanedAnswers', 'correctAnswerIndex', 'proofNote'],
        properties: {
          id: { type: 'string' },
          cleanedQuestion: { type: 'string' },
          cleanedAnswers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
          correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
          proofNote: { type: 'string' }  // что исправил по грамматике/пунктуации (или "ok")
        }
      }
    }
  }
}

const FACT_SCHEMA = {
  type: 'object', required: ['id', 'factVerdict', 'explanation'],
  properties: {
    id: { type: 'string' },
    factVerdict: { type: 'string', enum: ['true', 'myth', 'wrong', 'unverifiable'] },
    explanation: { type: 'string' },
    correctedAnswer: { type: 'string' }
  }
}

const repairPrompt = (file) => `Ты редактор вопросов викторины BigQuiz (взрослая аудитория, русский). Прочитай свод docs/category-risks.md (A.3, A.5, A.8) и файл ${file} - массив сырых вопросов guestion.ru (поля id, question, answers[4], correctAnswerIndex, correctAnswer).

Задача - НЕ судить на выброс, а ПОЧИНИТЬ каждый в чистую форму BigQuiz, сохранив факт и верный ответ. Для каждого верни объект (echo id ОБЯЗАТЕЛЬНО).

ПРИНЦИП МИНИМАЛЬНОГО ДИФА (КРИТИЧНО): если оригинал УЖЕ проходит свод (одно предложение ≤240, ответы ≤44 симв/≤5 слов, грамотный русский, чистые дистракторы, один верный) - НЕ переписывай его, верни почти как есть (changed="без изменений" или "минимальная правка"). Меняй ТОЛЬКО конкретное нарушение, минимально. НЕ переформулируй стилистически то, что и так корректно - частая ошибка прошлого прогона была «улучшать» хорошие вопросы и ломать их. Сомневаешься, лучше ли стало - не трогай.

РЕМОНТ (cleanedQuestion, cleanedAnswers[4], correctAnswerIndex):
- Вопрос: одно предложение, ≤240 симв, максимально лаконично (можно ли сказать проще без потери смысла - скажи проще: «Где…» вместо «В каком помещении…»); грамотный живой русский, верные согласование/падежи/окончания/пунктуация; дефис, не тире; числа цифрами; без ударений; без англо-аббревиатур/канцелярита в теле.
- НЕ СПОЙЛИТЬ: не раскрывай твист/ответ в самом вопросе; не добавляй рамок-уточнений, которые либо лишние (если видно из ответов), либо вводят неточность.
- СЮРПРИЗ - В ОТВЕТ, не в вопрос: если самый удивительный факт оказался в ТЕЛЕ вопроса, а ответ - забываемый ярлык (имя/название/страна), ПЕРЕВЕРНИ. Предмет вопроса - обычный объект, а «ого»-факт - ответ. Пример: ❌ «Как звали коня Наполеона, чей скелет хранится в Лондоне?» (ответ-имя забудут) → ✅ «Что, принадлежавшее Наполеону, хранится в музее Лондона?» → ответ «Скелет коня». Это поднимает угол с 2 до 5. Переворот допустим, даже если меняет структуру вопроса.
- Ответы: ≤44 симв, ≤5 слов (идеал 1 слово), однотипные; убрать дубли; начинать с РАЗНЫХ слов; общий служебный/категориальный префикс убрать из ответов и перенести его смысл В ВОПРОС; убрать протечку различающего слова ответа в вопрос. Если ответы - ЧИСЛА, упорядочи по ВОЗРАСТАНИЮ. Названия фильмов/книг - в кавычках («Матрица»).
- ДИСТРАКТОРЫ: НЕ ухудшай. Сохрани исходную логику и ОДНУ категорию; не подменяй на generic-варианты «не из той оперы»; каждый неверный логичен под формулировку. РОВНО ОДИН ВЕРНЫЙ - проверь каждый дистрактор: под формулировку он должен быть ОДНОЗНАЧНО неверным (частый брак: спросили «что выдавали строителям», а в дистракторах лук/чеснок, которые тоже выдавали - тогда сузь вопрос или замени дистрактор).
- ЦИТАТЫ: сохраняй оригинальную цитату в форме «закончи фразу», сжимая вокруг неё; НЕ пересказывай косвенной речью. Сомнительную атрибуцию смягчай («приписывают», «по легенде»).
- correctAnswerIndex - индекс верного в ОТРЕДАКТИРОВАННОМ массиве. changed - 1 фраза, что поменял. fixable: false только если неспасаемо в принципе.

ОЦЕНКА:
- prohibitedYG: ГЛАВНЫЙ ГЕЙТ (A.0, ЯИ 3.4). true, если тема под баном платформы: эзотерика/гадания/гороскопы/предсказания-практика, ДЕЙСТВУЮЩАЯ религия (вероучение/обряды/сравнение конфессий), ТЕКУЩАЯ/острая политика (живые политики, выборы, конфликты, оценки), жестокость к детям/животным. НЕ бан: античная/скандинавская мифология как культура, древняя история/институты как факт. Такой вопрос будет автоматически отклонён.
- guardrails.{compactness,language,distractors}: {ok,note} - состояние ПОСЛЕ ремонта.
- angle: сила «ого»-эффекта 1-5. ОЦЕНИВАЙ ПО УДИВИТЕЛЬНОСТИ ФАКТА, не по форме вопроса. Фанфакт про обычные вещи/отрасли - сильный угол (4-5), даже если ответ мало кто знает. Формат «закончи известную цитату» - тоже сильный угол. 5 - «о, не знал, расскажу друзьям». ВАЖНО про нижнюю границу: «как называется / кто изобрёл» про БЫТОВУЮ вещь (валюта страны, деталь одежды, предмет обихода, деньги, животные, часы) - это НЕ зубрёжка, угол 3-4, НЕ дроп. Зубрёжка (1-2, дроп) - только школьная программа в лоб (сколько клеток на доске уровня 7 класса) или узкоспециальный термин, помнить который незачем. НЕ ЖАДНИЧАЙ: если факт из обычной жизни и хоть немного цепляет - ставь 3+.
- banal: true только если ответ знают почти все (не переоценивай аудиторию).
- factDoubt: true, если истинность факта/верного ответа под сомнением. ВСЕГДА true для: любой цитаты с атрибуцией человеку (Фрейд, Наполеон, Черчилль…); «по словам / по мнению / по теории / согласно X»; удивительных историко-фольклорных утверждений («что выдавали строителям пирамид», «арабские купцы говорили»); приоритетов «первый / изобрёл»; спорной этимологии; устаревания. При МАЛЕЙШЕМ сомнении в правдивости - true. factNote - в чём сомнение.

Верни строго по схеме ВСЕ вопросы из файла.`

const proofPrompt = (items) => `Ты строгий корректор русского языка. Вот отредактированные вопросы викторины. Проверь КАЖДЫЙ ТОЛЬКО на грамматику: согласование (род/число/падеж - напр. «дирижабля, совершивШЕГО», не «совершивШИЙ»), окончания, управление, пунктуацию (запятые в придаточных; запятая, а не тире/дефис там, где нужна запятая), орфографию, повтор слов (не должно быть «чем… и чем ещё»). Смысл/факты/угол НЕ меняй - только язык.

Вопросы (JSON):
${JSON.stringify(items.map((x) => ({ id: x.id, cleanedQuestion: x.cleanedQuestion, cleanedAnswers: x.cleanedAnswers, correctAnswerIndex: x.correctAnswerIndex })), null, 2)}

Для каждого верни id, исправленные cleanedQuestion/cleanedAnswers/correctAnswerIndex (если язык был чист - верни без изменений), и proofNote: что исправил (или "ok"). Сохраняй correctAnswerIndex согласованным с массивом. Верни строго по схеме все вопросы.`

const factPrompt = (q) => `Проверь ФАКТ вопроса викторины по интернету. Загрузи инструменты через ToolSearch: "select:WebSearch,WebFetch", сделай 1-2 запроса.

id вопроса: ${q.id}  (верни ровно этот id)
Вопрос: ${q.cleanedQuestion}
Заявленный верный ответ: ${q.cleanedAnswers[q.correctAnswerIndex]}
Сомнение: ${q.factNote || '(проверь истинность ответа)'}

Верни id (точно как выше), factVerdict: 'true' (факт и ответ верны), 'myth' (подтверждённая байка/развенчано - даже если ответ формально верен), 'wrong' (ответ фактически неверен), 'unverifiable' (надёжно не подтверждается, но и не опровергнуто). explanation - 1-2 фразы со ссылкой на источник. Если ответ сайта неверен, но спасаем другим вариантом - дай correctedAnswer.`

phase('Repair')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),

  // 1. Ремонт
  (file) => agent(repairPrompt(file), { label: `repair:${file.split('/').pop()}`, phase: 'Repair', model: 'sonnet', effort: 'medium', schema: REPAIR_SCHEMA })
    .then((r) => ({ file, items: (r && r.items) || [] })),

  // 2. Корректор (грамматика поверх ремонта)
  async (rep) => {
    if (!rep || !rep.items.length) return null
    const proof = await agent(proofPrompt(rep.items), { label: `proof:${rep.file.split('/').pop()}`, phase: 'Proofread', model: 'sonnet', effort: 'medium', schema: PROOF_SCHEMA })
    const proofById = new Map(((proof && proof.items) || []).map((p) => [p.id, p]))
    const merged = rep.items.map((it) => {
      const p = proofById.get(it.id)
      return p ? { ...it, cleanedQuestion: p.cleanedQuestion, cleanedAnswers: p.cleanedAnswers, correctAnswerIndex: p.correctAnswerIndex, proofNote: p.proofNote } : it
    })
    return { file: rep.file, items: merged }
  },

  // 3. Веб-фактчек: только сомнительные с углом > 2 (на дроп-по-углу не тратим веб)
  async (rep) => {
    if (!rep) return null
    const doubtful = rep.items.filter((it) => it.factDoubt && it.angle.score > 2)
    const facts = await parallel(doubtful.map((q) => () => agent(factPrompt(q), { label: `fact:${q.id}`, phase: 'FactCheck', model: 'sonnet', effort: 'medium', schema: FACT_SCHEMA })))
    const factById = new Map(facts.filter(Boolean).map((f) => [f.id, f]))
    const items = rep.items.map((it) => {
      const fact = factById.get(it.id) || null
      let disposition = 'clean'
      if (it.prohibitedYG) disposition = 'drop-prohibited'      // A.0 / ЯИ 3.4 - бан платформы, до всего
      else if (!it.fixable) disposition = 'drop-unfixable'
      else if (it.angle.score <= 2) disposition = 'drop-weak-angle'
      else if (fact && fact.factVerdict === 'myth') disposition = 'drop-fact'
      else if (fact && fact.factVerdict === 'wrong' && !fact.correctedAnswer) disposition = 'drop-fact'
      return { ...it, fact, disposition }
    })
    return { file: rep.file, items }
  },

  // 4. Запись на диск (Haiku), вернуть метрики
  async (rep) => {
    if (!rep) return null
    const slug = rep.file.split('/').pop().replace(/\.json$/, '')
    await agent(
      `Создай scripts/clean-out/${slug}.json (и папку scripts/clean-out, если нет) и запиши ДОСЛОВНО этот JSON, ничего не меняя. После записи ответь только "ok".\n\n${JSON.stringify({ slug, items: rep.items })}`,
      { label: `save:${slug}`, phase: 'Save', model: 'haiku' }
    )
    const clean = rep.items.filter((i) => i.disposition === 'clean').length
    return { slug, total: rep.items.length, clean, dropped: rep.items.length - clean }
  }
)

// Вспомогательная: список входных файлов (через агента, т.к. в скрипте нет fs).
async function listInputs() {
  const FILES_SCHEMA = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/clean-in/*.json` и верни массив путей. Пусто/нет папки - пустой массив.', { label: 'list', phase: 'Repair', model: 'haiku', schema: FILES_SCHEMA })
  return (r && r.files) || []
}

const clean = results.filter(Boolean)
return {
  categories: clean.length,
  total: clean.reduce((a, r) => a + r.total, 0),
  clean: clean.reduce((a, r) => a + r.clean, 0),
  dropped: clean.reduce((a, r) => a + r.dropped, 0),
  byCat: clean.map((r) => ({ slug: r.slug, clean: r.clean, dropped: r.dropped }))
}
