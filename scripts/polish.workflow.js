// Единый воркфлоу доводки вопросов BigQuiz до стандарта.
// Стратегия: fix-first. Твои reviewNote — прямая директива, выполняется в первую очередь.
// Дроп ТОЛЬКО по 5 жёстким причинам (запрет ЯИ / нельзя дать 4 чистых дистрактора /
// подтверждённый миф / банально-школьное под любым углом / ультраниша <30%).
//
// Вход: scripts/polish-in/*.json (см. prep-polish.mjs).
// Дальше: scripts/merge-polish.mjs && npm test.
//
// Стадии (pipeline по категории):
//   1. Repair  — Sonnet med: полный свод + reviewNote как директива; fix-first.
//   2. Proof   — Sonnet med: грамматика; вставочное/парное тире → ЗАПЯТАЯ.
//   3. Verify  — Sonnet med: fix-first; refix если есть проблема; drop только фундаментально.
//   4. Fact    — Sonnet med + веб: factDoubt && угол>2 && не-дроп.
//   5. Save    — Haiku: scripts/polish-out/<slug>.json.
//
// Запуск: Workflow({ scriptPath: "scripts/polish.workflow.js" })

export const meta = {
  name: 'polish',
  description: 'Доводка вопросов: fix-first, reviewNote как директива, дроп только по жёстким критериям',
  phases: [
    { title: 'Repair', detail: 'Sonnet med: полный свод + твои комменты; fix-first' },
    { title: 'Proof', detail: 'Sonnet med: грамматика, вставочное тире → запятая' },
    { title: 'Verify', detail: 'Sonnet med: fix-first; refix если есть проблема' },
    { title: 'Fact', detail: 'Sonnet med + веб: factDoubt && угол>2' },
    { title: 'Save', detail: 'Haiku: scripts/polish-out/<slug>.json' }
  ]
}

const item = (extra) => ({ type: 'object', required: ['id', 'question', 'answers', 'correctAnswerIndex', ...extra.req], properties: { id: { type: 'string' }, question: { type: 'string' }, answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } }, correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 }, ...extra.props } })
const arr = (it) => ({ type: 'object', required: ['items'], properties: { items: { type: 'array', items: it } } })

const REPAIR_SCHEMA = arr(item({ req: ['explanation', 'angle', 'drop', 'dropReason', 'factDoubt', 'changed'], props: {
  explanation: { type: 'string' },
  angle: { type: 'integer', minimum: 1, maximum: 5 },
  drop: { type: 'boolean' },
  dropReason: { type: 'string', enum: ['', 'prohibited', 'distractors', 'myth', 'banal', 'ultra-niche'] },
  factDoubt: { type: 'boolean' },
  changed: { type: 'string' }
} }))

const PROOF_SCHEMA = arr(item({ req: ['proofNote'], props: { proofNote: { type: 'string' } } }))

const VERIFY_SCHEMA = arr({ type: 'object', required: ['id', 'verdict', 'issue'], properties: {
  id: { type: 'string' },
  verdict: { type: 'string', enum: ['pass', 'refix', 'drop'] },
  issue: { type: 'string' }
} })

const REFIX_SCHEMA = arr(item({ req: ['explanation', 'changed'], props: {
  explanation: { type: 'string' },
  changed: { type: 'string' }
} }))

const FACT_SCHEMA = { type: 'object', required: ['id', 'factVerdict', 'explanation'], properties: {
  id: { type: 'string' },
  factVerdict: { type: 'string', enum: ['true', 'myth', 'wrong', 'unverifiable'] },
  explanation: { type: 'string' },
  correctedAnswer: { type: 'string' }
} }

const RULES = `СТАНДАРТ — fix-first. Дроп только по 5 жёстким причинам ниже.

reviewNote (если есть) — ПРЯМАЯ ДИРЕКТИВА редактора. Выполни ровно то, на что указано
(замени дистракторы, переверни угол, переформулируй). Цель — спасти, не дропнуть.
Дроп по reviewNote только если он явно просит дропнуть или проблема фундаментально
неустранима по одной из 5 причин.

9 КЛАССОВ (все чинятся, кроме фундаментальных):
1. ДИСТРАКТОРЫ: каждый правдоподобен и ОДНОЗНАЧНО неверен под текущую формулировку;
   той же эпохи/домена; не синоним правильного ответа; не off-topic; не абсурд.
   Порядок действий при проблеме:
   а) Плохой дистрактор → заменить лучшим из той же области (минимальный диф).
   б) «Формально-тоже-верный» дистрактор → сначала смени УГОЛ ВОПРОСА так, чтобы он
      перестал быть верным и все 4 стали чистыми. Пример: «почему Балтика пресная?» →
      причины-дистракторы притянуты → лучше «какое море самое пресное?» → моря чисты.
   в) Дистрактор повторяет сущность, которую вопрос называет/с которой сравнивает →
      убрать, заменить. Это квази-протечка.
   НИКОГДА не заменяй дистрактор синонимом/перефразом правильного ответа — самоброй.
   drop="distractors" ТОЛЬКО если исчерпаны (а), (б), (в) и всё равно невозможно
   подобрать 4 варианта, каждый из которых: из той же области, правдоподобен, однозначно
   неверен. Это редкость — почти всегда помогает смена угла.
2. УГОЛ — сюрприз в ОТВЕТ: если «ого»-факт в премисе, а ответ — забываемый ярлык/
   имя/дата → перевернуть (число/механизм/атрибуция в ответ), поднять angle. drop="banal"
   ТОЛЬКО если под ЛЮБЫМ углом ответ тривиален (школьная программа насквозь).
3. ПРОТЕЧКА: ни ответ, ни его различающее слово не в вопросе — включая предлог и
   тавтологию имени. Переформулировать.
4. ФОРМУЛИРОВКА: ясная, полная, одно предложение; «до скольких/во сколько» →
   «до какой/в котором»; НИКОГДА не уточнять «вариантов 4 / правильный один»;
   уточняй принадлежность неоднозначных имён; не выбрасывай смыслообразующие детали.
5. СЛОЖНОСТЬ: sweet spot ~45-75%. drop="ultra-niche" ТОЛЬКО если <30% и нельзя
   переформулировать для широкой аудитории.
6. ТИРЕ: вставочное/парное тире → ЗАПЯТАЯ, не дефис. Дефис только там, где он дефис.
7. «ПОЧЕМУ»-вопрос: ответ объясняет ПРИЧИНУ. Если 4 правдоподобных причинных варианта
   нет — смени угол (не-«почему»).
8. ПАДЕЖ/EXPLANATION: ответы в именительном падеже; explanation 1-2 фразы (сгенерировать
   если пуст, сохранить/обновить под новый ответ если есть).
9. ДЛИНА ОТВЕТОВ (жёсткий гейт src/content-rules.js): каждый вариант ≤3 ЗНАЧИМЫХ слова
   (предлоги не в счёт), ≤44 символа, ни одно слово >18 символов. Идеал 1-2 слова. Если
   ответ длиннее — ПЕРЕФОРМУЛИРУЙ короче, сохранив смысл и правильность (НЕ дроп, НЕ мельчи).
   ⚠ ЧАСТАЯ ОШИБКА: укоротить ОДИН ответ и забыть остальные три — тогда вся правка
   отбраковывается. ПЕРЕД ВОЗВРАТОМ пересчитай значимые слова в КАЖДОМ из 4 вариантов:
   НИ ОДИН не должен превышать 3. Пример: «Соли кальция и магния» (4) → «Соли кальция, магния»
   (3); «Все части птицы — каждая на отдельной шпажке» → «Птица на одной шпажке».

5 ЖЁСТКИХ ПРИЧИН ДРОПА (только они, больше ничего):
- prohibited: ЯИ-запрет (эзотерика/гадания/религия/текущая политика/жестокость к
  детям и животным)
- distractors: после смены угла всё равно нельзя дать 4 чистых однозначно-неверных
  дистрактора
- myth: подтверждённый миф/фактически неверно, неисправимо без полной смены темы
- banal: школьная программа в лоб или бытовой ярлык под ЛЮБЫМ углом, интереса нет
- ultra-niche: ультраспецифично (<30% знают), нельзя переформулировать шире`

const repairPrompt = (file) => `Ты редактор вопросов BigQuiz (взрослые, русский).
Прочитай файл ${file} — массив вопросов (id, question, answers[4], correctAnswerIndex,
explanation может быть пуст, reviewNote — заметка редактора если есть).

${RULES}

Если вопрос уже идеален — changed="без изменений", верни КАК ЕСТЬ.
Для каждого верни: question, answers[4], correctAnswerIndex, explanation, angle (1-5),
drop, dropReason, factDoubt (цитата/«первый»/удивительный историко-фольклорный факт),
changed (1 фраза что изменено). Верни строго по схеме ВСЕ вопросы.`

const proofPrompt = (items) => `Строгий корректор русского. Проверь ТОЛЬКО язык:
согласование/падежи/окончания/орфографию и пунктуацию. ВАЖНО: вставочное/парное тире
(«текст — вставка —») и тире внутри фразы → ЗАПЯТАЯ. Дефис только где он реально дефис.
Смысл/факт/угол НЕ меняй.
${JSON.stringify(items.map(x => ({ id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex })), null, 2)}
Верни id, исправленные question/answers/correctAnswerIndex, proofNote. Строго по схеме все.`

const verifyPrompt = (items) => `Ты придирчивый ревьюер BigQuiz. Перечитай каждый вопрос
по своду (9 классов + ЯИ-запреты). Стратегия: FIX-FIRST.

verdict="pass" — придраться не к чему.
verdict="refix" — есть конкретный изъян, который ЧИНИТСЯ правкой. issue — ЧТО именно
  починить (рыхлый/тоже-верный дистрактор; сюрприз в премисе; протечка; вставочное тире;
  «почему» без причины; неясная формулировка; не именительный). Это НЕ дроп.
verdict="drop" — ТОЛЬКО если ФУНДАМЕНТАЛЬНО неспасаемо по одной из 5 причин:
  prohibited / нельзя дать 4 чистых дистрактора даже со сменой угла / подтверждённый миф /
  банально под любым углом / ультраниша <30%. issue — почему именно неспасаемо.
НЕ дропай то, что чинится. Сомнительный → refix.

${JSON.stringify(items.map(x => ({ id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex, explanation: x.explanation })), null, 2)}
Echo id. Строго по схеме все.`

const refixPrompt = (items) => `Финальная доводка: вопросы требуют конкретной правки (issue).
Почини КАЖДЫЙ ровно по его issue (дистракторы, угол, формулировка, тире, падеж).
Если issue про притянутые/тоже-верные дистракторы — сначала смени угол, чтобы дистракторы
стали чистыми. explanation сохрани/обнови. Верни question/answers[4]/correctAnswerIndex/
explanation/changed. Строго по схеме все.
${JSON.stringify(items.map(x => ({ id: x.id, issue: x.verifyIssue || '', question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex, explanation: x.explanation })), null, 2)}`

const factPrompt = (q) => `Проверь ФАКТ по интернету (ToolSearch "select:WebSearch,WebFetch", 1-2 запроса).
Проверяй ИМЕННО то, на чём держится вопрос. Соцсеть ≠ подтверждение.
id: ${q.id} (верни ровно этот)
Вопрос: ${q.question}
Верный ответ: ${q.answers[q.correctAnswerIndex]}
factVerdict: true | myth (байка/развенчано) | wrong (ответ неверен) | unverifiable.
explanation 1-2 фразы + источник. Если ответ неверен но спасаем — correctedAnswer.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/polish-in/*.json` и верни массив путей.', { label: 'list', phase: 'Repair', model: 'haiku', schema: S })
  return (r && r.files) || []
}

// args.noWeb === true → пропустить Fact-стадию (никаких WebSearch/WebFetch).
// Уместно для прогонов про длину/формулировку, где факты уже проверены при генерации.
const NO_WEB = !!(args && args.noWeb)

phase('Repair')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),

  // 1. Repair
  (file) => agent(repairPrompt(file), { label: `repair:${file.split('/').pop()}`, phase: 'Repair', model: 'sonnet', effort: 'medium', schema: REPAIR_SCHEMA })
    .then(r => ({ slug: file.split('/').pop().replace(/\.json$/, ''), items: (r && r.items) || [] })),

  // 2. Proof (только не-дроп)
  async (rep) => {
    if (!rep) return null
    const keep = rep.items.filter(x => !x.drop)
    if (keep.length) {
      const proof = await agent(proofPrompt(keep), { label: `proof:${rep.slug}`, phase: 'Proof', model: 'sonnet', effort: 'medium', schema: PROOF_SCHEMA })
      const p = new Map(((proof && proof.items) || []).map(x => [x.id, x]))
      rep.items = rep.items.map(it => { const pi = p.get(it.id); return pi && !it.drop ? { ...it, question: pi.question, answers: pi.answers, correctAnswerIndex: pi.correctAnswerIndex } : it })
    }
    return rep
  },

  // 3. Verify (fix-first: refix если чинится, drop только фундаментально)
  async (rep) => {
    if (!rep) return null
    const keep = rep.items.filter(x => !x.drop)
    if (keep.length) {
      const ver = await agent(verifyPrompt(keep), { label: `verify:${rep.slug}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: VERIFY_SCHEMA })
      const v = new Map(((ver && ver.items) || []).map(x => [x.id, x]))
      rep.items = rep.items.map(it => {
        const vi = v.get(it.id)
        if (!vi || it.drop) return it
        if (vi.verdict === 'drop') return { ...it, drop: true, dropReason: it.dropReason || 'verify-unfixable', verifyIssue: vi.issue }
        if (vi.verdict === 'refix') return { ...it, needsRefix: true, verifyIssue: vi.issue }
        return it
      })
    }
    return rep
  },

  // 3b. Refix — спасаем то, что verify пометил refix
  async (rep) => {
    if (!rep) return null
    const toFix = rep.items.filter(x => x.needsRefix && !x.drop)
    if (toFix.length) {
      const fx = await agent(refixPrompt(toFix), { label: `refix:${rep.slug}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: REFIX_SCHEMA })
      const f = new Map(((fx && fx.items) || []).map(x => [x.id, x]))
      rep.items = rep.items.map(it => { const fi = f.get(it.id); return fi ? { ...it, question: fi.question, answers: fi.answers, correctAnswerIndex: fi.correctAnswerIndex, explanation: fi.explanation, changed: (it.changed || '') + ' | refix: ' + (fi.changed || '') } : it })
    }
    return rep
  },

  // 4. Fact (веб) — только сомнительные выжившие с высоким углом. args.noWeb → пропустить.
  async (rep) => {
    if (!rep) return null
    const doubtful = NO_WEB ? [] : rep.items.filter(it => !it.drop && it.factDoubt && it.angle > 2)
    if (doubtful.length) {
      const facts = await parallel(doubtful.map(q => () => agent(factPrompt(q), { label: `fact:${q.id}`, phase: 'Fact', model: 'sonnet', effort: 'medium', schema: FACT_SCHEMA })))
      const fById = new Map(facts.filter(Boolean).map(f => [f.id, f]))
      rep.items = rep.items.map(it => ({ ...it, fact: fById.get(it.id) || null }))
    }
    return rep
  },

  // 5. Save
  async (rep) => {
    if (!rep) return null
    await agent(`Создай scripts/polish-out/${rep.slug}.json (и папку если нет) и запиши ДОСЛОВНО этот JSON. Ответь только "ok".\n\n${JSON.stringify(rep)}`, { label: `save:${rep.slug}`, phase: 'Save', model: 'haiku' })
    return { slug: rep.slug, total: rep.items.length, dropped: rep.items.filter(x => x.drop).length }
  }
)

const clean = results.filter(Boolean)
return { groups: clean.length, total: clean.reduce((a, r) => a + r.total, 0), dropped: clean.reduce((a, r) => a + r.dropped, 0) }
