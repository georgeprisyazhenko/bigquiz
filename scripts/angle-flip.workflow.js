// Перевёртыш угла: для вопросов, где вау-факт сидит в ПРЕМИСЕ, генерит вариант «вау-в-ответ»
// по актуальным правилам. Вход: scripts/angleflip-in/questions.json (см. prep-angle-flip.mjs).
// Запуск: Workflow({ scriptPath: "scripts/angle-flip.workflow.js" }).
// Возврат — массив кандидатов (с orig для сравнения). Ревью КАНДИДАТОВ — в чате с человеком
// (смена угла = вкусовое решение), затем applied через editQuestion. Прогони кандидатов через
// гейты content-rules перед показом. См. docs/rules-map.md, docs/review-runbook.md.

export const meta = {
  name: 'angle-flip',
  description: 'Перевёртыш угла: вау-факт из премисы вопроса → в ОТВЕТ',
  phases: [{ title: 'Load', detail: 'haiku: читает angleflip-in' }, { title: 'Flip', detail: 'редизайн угла по вопросу' }]
}

const SCHEMA = {
  type: 'object',
  required: ['id', 'flippable', 'question', 'answers', 'correctAnswerIndex', 'explanation', 'note'],
  properties: {
    id: { type: 'string' }, flippable: { type: 'boolean' },
    question: { type: 'string' },
    answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
    correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
    explanation: { type: 'string' }, note: { type: 'string' }
  }
}

const prompt = (q) => `Ты редактор-генератор BigQuiz (викторина для ВЗРОСЛЫХ, русский). Вопрос НИЖЕ забракован: удивительный «ого»-факт сидит в самой ПРЕМИСЕ, а ответ — забываемый ярлык или экзаменационное «объясни причину». ПЕРЕВЕРНИ угол так, чтобы факт стал САМИМ ОТВЕТОМ, а вопрос — простым «знаю / угадаю».

Оригинал:
${JSON.stringify({ question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation }, null, 2)}
Замечание судьи: ${q.judgeReason || '(нет)'}

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
- Вау-факт — в ОТВЕТ, НЕ в вопрос. Никаких «объясни почему» (экзамен). НЕ называй в вопросе сущность, чья идентичность и есть вау.
- РОВНО 4 варианта, ровно ОДИН верный. Дистракторы: одна область, правдоподобны В КОНТЕКСТЕ, однозначно неверны, не синонимы, без протечки, начинаются с разных слов. НЕ бинарный выбор «X или Y». Варианты НЕ содержат подсказку-дискриминатор (века/размеры в скобках).
- Длина КАЖДОГО ответа: ≤3 ЗНАЧИМЫХ слова (служебные/местоимения не в счёт), ≤44 символа, слово ≤18. Числа цифрами. «около» не в каждом варианте. Перечисление через «и». Без вложенных «более N/менее N». Верный не единственное не-круглое число среди круглых. ВАРИАНТЫ по-русски (без англо-фраз; бренды/имена можно).
- Редкий термин в вопросе — поясни кратко. Только дефис, не тире. Один вопрос = одно предложение. Сильный explanation (1-2 фразы). Факт ОБЯЗАН быть верным (не миф).
- Если перевернуть невозможно (банально/ультраниша под ЛЮБЫМ углом) — flippable=false, оставь оригинал в полях, в note напиши почему.

Верни строго по схеме: id="${q.id}", flippable, question, answers[4], correctAnswerIndex, explanation, note (на чём теперь вау).`

phase('Load')
const RD = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', required: ['id', 'question', 'answers', 'correctAnswerIndex'], properties: { id: { type: 'string' }, question: { type: 'string' }, answers: { type: 'array' }, correctAnswerIndex: { type: 'integer' }, explanation: { type: 'string' }, judgeReason: { type: 'string' } } } } } }
const loaded = await agent('Прочитай файл scripts/angleflip-in/questions.json и верни его как {items:[...]} без изменений.', { label: 'load', phase: 'Load', model: 'haiku', schema: RD })
const questions = (loaded && loaded.items) || []
log(`angle-flip: загружено ${questions.length} вопросов`)

phase('Flip')
const out = await parallel(questions.map((q) => () =>
  agent(prompt(q), { label: `flip:${q.id}`, phase: 'Flip', model: 'sonnet', effort: 'medium', schema: SCHEMA })
    .then((r) => (r ? { ...r, id: q.id, orig: { question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex } } : null))
    .catch(() => null)
))

const ok = out.filter(Boolean)
log(`готово: ${ok.length}/${questions.length}; перевёрнуто=${ok.filter((r) => r.flippable).length}`)
return ok
