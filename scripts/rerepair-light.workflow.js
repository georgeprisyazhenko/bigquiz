// Полный-лайт ре-ремонт всех clean-вопросов по принципам из аудита пользователя.
// Вход scripts/rerepair-in/*.json. БЕЗ веба (фактовые вердикты переносим в merge).
// Пайплайн на категорию: Repair (Sonnet med, принципы + userNote) → Proof (грамматика) → Save.
// Дальше scripts/merge-rerepair.mjs. Запуск: Workflow({ scriptPath: "scripts/rerepair-light.workflow.js" })

export const meta = {
  name: 'rerepair-light',
  description: 'Полный-лайт ре-ремонт 860 clean по принципам аудита (сюрприз-в-ответ, мин.диф, грамматика), без веба',
  phases: [
    { title: 'Repair', detail: 'Sonnet medium: принципы аудита + твои комменты' },
    { title: 'Proof', detail: 'Sonnet medium: грамматика/пунктуация' },
    { title: 'Save', detail: 'Haiku: scripts/rerepair-out/<slug>.json' }
  ]
}

const REPAIR_SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'question', 'answers', 'correctAnswerIndex', 'newAngle', 'changed', 'factSuspect'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
          correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
          newAngle: { type: 'integer', minimum: 1, maximum: 5 },
          changed: { type: 'string' },
          factSuspect: { type: 'boolean' } // явный апокриф/мисатрибуция/фольклор как факт - на дроп
        }
      }
    }
  }
}
const PROOF_SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'question', 'answers', 'correctAnswerIndex', 'proofNote'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
          correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
          proofNote: { type: 'string' }
        }
      }
    }
  }
}

const repairPrompt = (file) => `Ты редактор вопросов викторины BigQuiz (взрослые, русский). Прочитай свод docs/category-risks.md (A.0, A.3, A.5, A.8) и файл ${file} - массив уже отобранных «годных» вопросов (id, question, answers[4], correctAnswerIndex, currentAngle, originalQuestion, originalAnswers, userNote). Это финальная шлифовка по выстраданным принципам. Для каждого верни объект (echo id).

ПРИНЦИПЫ (применяй ко ВСЕМ; userNote, если есть, - прямое указание, выполни его в первую очередь):

1. СЮРПРИЗ - В ОТВЕТ, НЕ В ВОПРОС (главное). Если ответ - забываемый ЯРЛЫК (страна/город/имя/«кто первый»), а удивительный факт (число, год, масштаб, деталь) сидит в ТЕЛЕ вопроса - ПЕРЕВЕРНИ так, чтобы «ого»-факт стал ОТВЕТОМ. Примеры: ❌ «В какой стране выходит старейшая газета?»→Австрия → ✅ «Около скольких лет издаётся старейшая газета мира?»→«Более 300 лет» (варианты-длительности). ❌ «Как звали коня Наполеона, чей скелет в Лондоне?» → ✅ «Что, принадлежавшее Наполеону, хранится в музее Лондона?»→«Скелет коня». ❌ «кто первый выпустил гормон. крем» → ✅ «В каком году впервые выпустили крем на основе гормонов?» (реакция «ого, уже тогда»). Хватит ответов-страна/город/имя, когда есть угол интереснее. После переворота подними newAngle.

2. МИНИМАЛЬНЫЙ ДИФ. Если вопрос уже хорош и переворот не нужен - НЕ трогай его (changed="без изменений"). НЕ переформулируй стилистически то, что и так корректно («зачем меняли» - это брак). Если текущая версия хуже originalQuestion - вернись к оригиналу (сжав при нужде).

3. ГРАММАТИКА/ПУНКТУАЦИЯ/ТИРЕ. Верные согласование, падежи, окончания. Только дефис «-», НЕ длинное тире; там, где тире стоит как знак препинания внутри фразы, чаще нужна ЗАПЯТАЯ, а не дефис. Без повторов слов («чем… и чем ещё»).

4. ДИСТРАКТОРЫ. Ровно ОДИН верный (проверь, что ни один дистрактор тоже не подходит под формулировку); однородные, одной категории; без протечки слова-ответа в вопрос; без «не из той оперы». Ответы ≤44 симв, ≤5 слов (идеал 1), начинаются по-разному; числа по ВОЗРАСТАНИЮ; названия фильмов/книг в кавычках; «компания X», если ответ - голое имя бренда в начале.

5. newAngle (1-5) - переоцени. Бытовой ярлык про обычные вещи (валюта/деталь/деньги/часы/животные) - НЕ зубрёжка (3-4). Сильный «ого»-факт - 5. Зубрёжка (1-2) - школьная программа в лоб / узкоспец.

6. factSuspect=true, если факт-премиса/атрибуция - явный апокриф, мисатрибуция цитаты или непроверяемый фольклор, поданный как факт (напр. «по Фрейду…», «арабские купцы говорили…», «суп-тест Эдисона»). Такой вопрос будет отклонён.

correctAnswerIndex - в ОТРЕДАКТИРОВАННОМ массиве. changed - 1 фраза. Верни строго по схеме ВСЕ вопросы.`

const proofPrompt = (items) => `Ты строгий корректор русского языка. Проверь КАЖДЫЙ вопрос ТОЛЬКО на язык: согласование/падежи/окончания, пунктуацию (запятые в придаточных; запятая, а не тире/дефис там, где нужна запятая), орфографию, повтор слов. Смысл/угол/факты НЕ меняй. Тире → дефис или запятую по смыслу.

${JSON.stringify(items.map((x) => ({ id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex })), null, 2)}

Для каждого верни id, исправленные question/answers/correctAnswerIndex (чисто - верни без изменений) и proofNote (что исправил или "ok"). Строго по схеме, все вопросы.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/rerepair-in/*.json` и верни массив путей. Пусто - пустой массив.', { label: 'list', phase: 'Repair', model: 'haiku', schema: S })
  return (r && r.files) || []
}

phase('Repair')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),

  (file) => agent(repairPrompt(file), { label: `repair:${file.split('/').pop()}`, phase: 'Repair', model: 'sonnet', effort: 'medium', schema: REPAIR_SCHEMA })
    .then((r) => ({ file, slug: file.split('/').pop().replace(/\.json$/, ''), items: (r && r.items) || [] })),

  async (rep) => {
    if (!rep || !rep.items.length) return null
    const proof = await agent(proofPrompt(rep.items), { label: `proof:${rep.slug}`, phase: 'Proof', model: 'sonnet', effort: 'medium', schema: PROOF_SCHEMA })
    const pById = new Map(((proof && proof.items) || []).map((p) => [p.id, p]))
    const merged = rep.items.map((it) => {
      const p = pById.get(it.id)
      return p ? { ...it, question: p.question, answers: p.answers, correctAnswerIndex: p.correctAnswerIndex, proofNote: p.proofNote } : it
    })
    return { slug: rep.slug, items: merged }
  },

  async (rep) => {
    if (!rep) return null
    await agent(
      `Создай scripts/rerepair-out/${rep.slug}.json (и папку, если нет) и запиши ДОСЛОВНО этот JSON. После записи ответь только "ok".\n\n${JSON.stringify(rep)}`,
      { label: `save:${rep.slug}`, phase: 'Save', model: 'haiku' }
    )
    return { slug: rep.slug, total: rep.items.length, suspect: rep.items.filter((x) => x.factSuspect).length }
  }
)

const clean = results.filter(Boolean)
return {
  categories: clean.length,
  total: clean.reduce((a, r) => a + r.total, 0),
  factSuspect: clean.reduce((a, r) => a + r.suspect, 0)
}
