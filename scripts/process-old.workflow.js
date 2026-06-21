// Прогон старых вопросов (scripts/old-in/*.json) через наш свод:
//   1. Repair  — Sonnet med: 14 принципов аудита + дроп-классы + ОБНОВИТЬ explanation + factDoubt.
//   2. Proof   — Sonnet med: грамматика.
//   3. Fact    — Sonnet med + веб: только factDoubt && не-дроп && угол>2.
//   4. Save    — Haiku: scripts/old-out/<slug>.json.
// Сохраняем explanation (правим под новый ответ при перевороте). imageSearchQuery/categories
// НЕ трогаем (переносятся в merge из оригинала). Дальше scripts/merge-old.mjs.
// Запуск: Workflow({ scriptPath: "scripts/process-old.workflow.js" })

export const meta = {
  name: 'process-old',
  description: 'Старые вопросы через флоу: ремонт по 14 принципам + дроп-классы + веб-факт, с сохранением explanation',
  phases: [
    { title: 'Repair', detail: 'Sonnet med: принципы + дроп + explanation' },
    { title: 'Proof', detail: 'Sonnet med: грамматика' },
    { title: 'Fact', detail: 'Sonnet med + веб: сомнительные' },
    { title: 'Save', detail: 'Haiku: scripts/old-out/<slug>.json' }
  ]
}

const REPAIR_SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'question', 'answers', 'correctAnswerIndex', 'explanation', 'newAngle', 'drop', 'dropReason', 'factDoubt', 'changed'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
          correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
          explanation: { type: 'string' },
          newAngle: { type: 'integer', minimum: 1, maximum: 5 },
          drop: { type: 'boolean' },
          dropReason: { type: 'string', enum: ['', 'street-niche', 'banal-school', 'multiple-correct', 'absurd-distractors', 'comparison', 'scandal-living', 'prohibited', 'ultra-niche', 'other'] },
          factDoubt: { type: 'boolean' },
          changed: { type: 'string' }
        }
      }
    }
  }
}
const PROOF_SCHEMA = {
  type: 'object', required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', required: ['id', 'question', 'answers', 'correctAnswerIndex', 'proofNote'], properties: { id: { type: 'string' }, question: { type: 'string' }, answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } }, correctAnswerIndex: { type: 'integer' }, proofNote: { type: 'string' } } } } }
}
const FACT_SCHEMA = {
  type: 'object', required: ['id', 'factVerdict', 'explanation'],
  properties: { id: { type: 'string' }, factVerdict: { type: 'string', enum: ['true', 'myth', 'wrong', 'unverifiable'] }, explanation: { type: 'string' }, correctedAnswer: { type: 'string' } }
}

const repairPrompt = (file) => `Ты редактор вопросов викторины BigQuiz (взрослые, русский). Прочитай свод docs/category-risks.md (A.0, A.3, A.5, A.8) и файл ${file} - массив наших УЖЕ существующих вопросов (id, question, answers[4], correctAnswerIndex, explanation). Они прошли первичную генерацию; сейчас финальная шлифовка по выстраданным принципам. Для каждого (echo id):

ПРИНЦИПЫ (применяй ко всем; userNote нет - это наши вопросы):
1. СЮРПРИЗ - В ОТВЕТ, не в премису: если ответ - забываемый ярлык (страна/город/имя/«кто первый»), а «ого»-факт в теле - переверни (число/год/атрибуция → ответ). После переворота подними newAngle И обнови explanation под новый ответ.
2. МИНИМАЛЬНЫЙ ДИФ: хорошее не трогай (changed="без изменений"). Не выбрасывай смыслообразующие уточнения (e-mail, эпоха).
3. ГРАММАТИКА/ТИРЕ: согласование/падежи/пунктуация; только дефис, не тире (тире как знак → запятая). Ответы в ИМЕНИТЕЛЬНОМ падеже; вопросительное слово согласовано с типом ответа (что/кто) и с типом дистракторов.
4. ДИСТРАКТОРЫ: ровно ОДИН верный (проверь, что НИ ОДИН дистрактор тоже не подходит); однородные, той же эпохи/домена, правдоподобные (без анахронизмов/абсурда); без протечки (в т.ч. предлогом «под»/«самый»); ≤44 симв/≤5 слов; числа по возрастанию.
5. explanation: ОБЯЗАТЕЛЬНО сохрани (это факт-награда). Если поменял вопрос/ответ - приведи explanation в соответствие. Если не трогал - верни как было.

ДРОП (drop=true + dropReason), если: street-niche (улицы/микротопонимы), banal-school (школьная программа в лоб), multiple-correct, absurd-distractors, comparison (надо сравнить 4 значения), scandal-living (скандал/насмешка над живым), prohibited (A.0: эзотерика/гадания/действующая религия/текущая политика/жестокость к детям-животным), ultra-niche (ответят <30%, не из обычной жизни). Иначе drop=false, dropReason="".

newAngle (1-5): бытовой ярлык про обычные вещи - 3-4, не дроп; зубрёжка - 1-2. factDoubt=true для цитат/атрибуций/«первый»/удивительных историко-фольклорных утверждений/спорной этимологии.

Верни строго по схеме ВСЕ вопросы файла.`

const proofPrompt = (items) => `Корректор русского. Проверь КАЖДЫЙ ТОЛЬКО на язык: согласование/падежи/окончания, пунктуацию (запятая, а не тире/дефис где нужна запятая), орфографию, повтор слов. Смысл/факт/угол НЕ меняй.
${JSON.stringify(items.map((x) => ({ id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex })), null, 2)}
Верни id, исправленные question/answers/correctAnswerIndex (чисто - без изменений), proofNote. Строго по схеме все.`

const factPrompt = (q) => `Проверь ФАКТ по интернету (ToolSearch "select:WebSearch,WebFetch", 1-2 запроса). Проверяй ИМЕННО то, на чём держится вопрос, не смежное. Источник-соцсеть не считается подтверждением.
id: ${q.id} (верни ровно этот)
Вопрос: ${q.question}
Заявленный верный ответ: ${q.answers[q.correctAnswerIndex]}
factVerdict: true | myth (байка/развенчано даже при верном ответе) | wrong (ответ неверен) | unverifiable. explanation 1-2 фразы + источник. Если ответ неверен, но спасаем вариантом из списка - correctedAnswer.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/old-in/*.json` и верни массив путей. Пусто - пустой массив.', { label: 'list', phase: 'Repair', model: 'haiku', schema: S })
  return (r && r.files) || []
}

phase('Repair')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),

  (file) => agent(repairPrompt(file), { label: `repair:${file.split('/').pop()}`, phase: 'Repair', model: 'sonnet', effort: 'medium', schema: REPAIR_SCHEMA })
    .then((r) => ({ slug: file.split('/').pop().replace(/\.json$/, ''), items: (r && r.items) || [] })),

  async (rep) => {
    if (!rep || !rep.items.length) return null
    const keep = rep.items.filter((x) => !x.drop)
    if (keep.length) {
      const proof = await agent(proofPrompt(keep), { label: `proof:${rep.slug}`, phase: 'Proof', model: 'sonnet', effort: 'medium', schema: PROOF_SCHEMA })
      const p = new Map(((proof && proof.items) || []).map((x) => [x.id, x]))
      rep.items = rep.items.map((it) => { const pi = p.get(it.id); return pi && !it.drop ? { ...it, question: pi.question, answers: pi.answers, correctAnswerIndex: pi.correctAnswerIndex, proofNote: pi.proofNote } : it })
    }
    return rep
  },

  async (rep) => {
    if (!rep) return null
    const doubtful = rep.items.filter((it) => !it.drop && it.factDoubt && it.newAngle > 2)
    const facts = await parallel(doubtful.map((q) => () => agent(factPrompt(q), { label: `fact:${q.id}`, phase: 'Fact', model: 'sonnet', effort: 'medium', schema: FACT_SCHEMA })))
    const fById = new Map(facts.filter(Boolean).map((f) => [f.id, f]))
    rep.items = rep.items.map((it) => ({ ...it, fact: fById.get(it.id) || null }))
    return rep
  },

  async (rep) => {
    if (!rep) return null
    await agent(`Создай scripts/old-out/${rep.slug}.json (и папку, если нет) и запиши ДОСЛОВНО этот JSON. После ответь только "ok".\n\n${JSON.stringify(rep)}`, { label: `save:${rep.slug}`, phase: 'Save', model: 'haiku' })
    return { slug: rep.slug, total: rep.items.length, dropped: rep.items.filter((x) => x.drop).length }
  }
)

const clean = results.filter(Boolean)
return { groups: clean.length, total: clean.reduce((a, r) => a + r.total, 0), dropped: clean.reduce((a, r) => a + r.dropped, 0) }
