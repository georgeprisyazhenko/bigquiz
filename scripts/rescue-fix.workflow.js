// Слой 2 (часть 1+2): пере-оценка угла зря дропнутых (новая калибровка - бытовые
// ярлыки 3-4) + фикс длины ответов у formIssues. Без веба. По уже готовому тексту,
// минимальным дифом. Вход scripts/rescue-in/*.json. Дальше scripts/merge-rescue.mjs.
// Запуск: Workflow({ scriptPath: "scripts/rescue-fix.workflow.js" })

export const meta = {
  name: 'rescue-fix',
  description: 'Слой 2: пере-оценка угла weak-angle (бытовые ярлыки 3-4) + фикс длины ответов',
  phases: [
    { title: 'Rescue', detail: 'Sonnet medium: новый угол + фикс длины' },
    { title: 'Save', detail: 'Haiku: scripts/rescue-out/<slug>.json' }
  ]
}

const SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'newAngle', 'angleNote', 'answers', 'correctAnswerIndex', 'question'],
        properties: {
          id: { type: 'string' },
          newAngle: { type: 'integer', minimum: 1, maximum: 5 },
          angleNote: { type: 'string' },
          question: { type: 'string' },                                   // эхо или минимально поправленный
          answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
          correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
          changed: { type: 'string' }
        }
      }
    }
  }
}

const prompt = (file) => `Прочитай свод docs/category-risks.md (особенно A.0, A.3, A.5 и калибровку угла) и файл ${file} - массив вопросов викторины (id, question, answers[4], correctAnswerIndex, task, currentAngle, formIssues). Это уже отредактированные вопросы, которые ЛИБО зря дропнули по слабому углу (task=rescore-angle), ЛИБО имеют слишком длинный ответ (task=fix-length).

Для КАЖДОГО верни id и:

1) newAngle (1-5) - ПЕРЕОЦЕНИ угол по уточнённой калибровке: «как называется / кто изобрёл» про БЫТОВУЮ вещь (валюта страны, деталь одежды, деньги, часы, животные, обиходный предмет) - это НЕ зубрёжка, угол 3-4. Зубрёжка (1-2) - только школьная программа в лоб или узкоспециальный термин, помнить который незачем. Фанфакт из обычной жизни, хоть немного цепляющий - 3+. angleNote - короткое обоснование.

2) question, answers[4], correctAnswerIndex - МИНИМАЛЬНЫЙ ДИФ. Менять ТОЛЬКО если task=fix-length (тогда укороти ответы: каждый ≤44 симв, ≤5 слов, идеал 1 слово; однотипные; правильный сохрани) ИЛИ если очевиден дешёвый «переворот сюрприза в ответ» (если «ого»-факт застрял в премисе, а ответ - забываемый ярлык, переформулируй так, чтобы сюрприз стал ОТВЕТОМ - тогда подними и newAngle). Если правка не нужна - верни question/answers/correctAnswerIndex БЕЗ изменений (changed="без изменений"). НЕ переписывай стилистически то, что и так корректно. Тире не использовать, только дефис.

Верни строго по схеме все вопросы файла.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/rescue-in/*.json` и верни массив путей. Пусто - пустой массив.', { label: 'list', phase: 'Rescue', model: 'haiku', schema: S })
  return (r && r.files) || []
}

phase('Rescue')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),
  (file) => agent(prompt(file), { label: `rescue:${file.split('/').pop()}`, phase: 'Rescue', model: 'sonnet', effort: 'medium', schema: SCHEMA })
    .then((r) => ({ slug: file.split('/').pop().replace(/\.json$/, ''), items: (r && r.items) || [] })),
  async (rep) => {
    if (!rep || !rep.items.length) return null
    await agent(
      `Создай scripts/rescue-out/${rep.slug}.json (и папку, если нет) и запиши ДОСЛОВНО этот JSON. После записи ответь только "ok".\n\n${JSON.stringify(rep)}`,
      { label: `save:${rep.slug}`, phase: 'Save', model: 'haiku' }
    )
    const rescued = rep.items.filter((x) => x.newAngle > 2).length
    return { slug: rep.slug, total: rep.items.length, rescued }
  }
)

const clean = results.filter(Boolean)
return {
  categories: clean.length,
  total: clean.reduce((a, r) => a + r.total, 0),
  rescued: clean.reduce((a, r) => a + r.rescued, 0)
}
