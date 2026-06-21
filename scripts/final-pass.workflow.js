// ФИНАЛЬНЫЙ прогон (единый для старых и guestion). Стандарт: вопрос на выходе ЛИБО
// идеален, ЛИБО доведён ПОЛНОСТЬЮ, ЛИБО дропнут. Гарантия «не робко» - стадия Verify.
// Вход: scripts/final-in/*.json (см. prep-final.mjs). Дальше: scripts/merge-final.mjs.
// Стадии (pipeline по категории):
//   1. Repair  — Sonnet med: 8 классов аудита + стандарт + генерация explanation (если пуст).
//   2. Proof   — Sonnet med: грамматика; ВСТАВОЧНОЕ/ПАРНОЕ тире → ЗАПЯТАЯ (не дефис).
//   3. Verify  — Sonnet med: придирчивый ре-чек; остался ХОТЬ ОДИН изъян → drop.
//   4. Fact    — Sonnet med + веб: только factDoubt && не-дроп && угол>2; проверять ключевой факт.
//   5. Save    — Haiku: scripts/final-out/<slug>.json.
// Запуск: Workflow({ scriptPath: "scripts/final-pass.workflow.js" })

export const meta = {
  name: 'final-pass',
  description: 'Финальный строгий прогон: ремонт по 8 классам + тире→запятая + Strict-verify + веб-факт + explanation',
  phases: [
    { title: 'Repair', detail: 'Sonnet med: стандарт + 8 классов + explanation' },
    { title: 'Proof', detail: 'Sonnet med: грамматика, тире→запятая' },
    { title: 'Verify', detail: 'Sonnet med: придирчивый ре-чек → drop при изъяне' },
    { title: 'Fact', detail: 'Sonnet med + веб: сомнительные' },
    { title: 'Save', detail: 'Haiku: scripts/final-out/<slug>.json' }
  ]
}

const item = (extra) => ({ type: 'object', required: ['id', 'question', 'answers', 'correctAnswerIndex', ...extra.req], properties: { id: { type: 'string' }, question: { type: 'string' }, answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } }, correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 }, ...extra.props } })
const arr = (it) => ({ type: 'object', required: ['items'], properties: { items: { type: 'array', items: it } } })

const REPAIR_SCHEMA = arr(item({ req: ['explanation', 'newAngle', 'drop', 'dropReason', 'factDoubt', 'changed'], props: {
  explanation: { type: 'string' },
  newAngle: { type: 'integer', minimum: 1, maximum: 5 },
  drop: { type: 'boolean' },
  dropReason: { type: 'string', enum: ['', 'distractors', 'angle', 'leak-obvious', 'phrasing', 'too-hard', 'why-not-answered', 'prohibited', 'duplicate', 'other'] },
  factDoubt: { type: 'boolean' },
  changed: { type: 'string' }
} }))
const PROOF_SCHEMA = arr(item({ req: ['proofNote'], props: { proofNote: { type: 'string' } } }))
const VERIFY_SCHEMA = arr({ type: 'object', required: ['id', 'verdict', 'issue'], properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'refix', 'drop'] }, issue: { type: 'string' } } })
const REFIX_SCHEMA = arr(item({ req: ['explanation', 'changed'], props: { explanation: { type: 'string' }, changed: { type: 'string' } } }))
const FACT_SCHEMA = { type: 'object', required: ['id', 'factVerdict', 'explanation'], properties: { id: { type: 'string' }, factVerdict: { type: 'string', enum: ['true', 'myth', 'wrong', 'unverifiable'] }, explanation: { type: 'string' }, correctedAnswer: { type: 'string' } } }

const STANDARD = `СТАНДАРТ (без компромиссов): каждый вопрос на выходе - ЛИБО уже идеален (не трогать, changed="без изменений"), ЛИБО доведён ПОЛНОСТЬЮ до соответствия, ЛИБО drop=true. «Подправлено, но всё ещё с изъяном» = ПРОВАЛ.`

const PRINCIPLES = `8 классов (по каждому - довести или drop):
1. ДИСТРАКТОРЫ: каждый правдоподобен и ОДНОЗНАЧНО неверен; не синоним, не off-topic, не абсурд/анахронизм, не «формально-тоже-верный». Той же эпохи/домена. ЧИСТЫЕ дистракторы НЕ ТРОГАЙ (минимальный диф). НИКОГДА не заменяй дистрактор на синоним/перефраз правильного ответа - частый самоброй: «пролив узкий» + «волна не успевает войти» = одно и то же → вопрос ломается и дропается зря. Если дистракторы ПРИТЯНУТЫ/тоже-верны под текущий угол - СНАЧАЛА СМЕНИ УГОЛ (переформулируй так, чтобы дистракторы стали чистыми: напр. «почему Балтика самая пресная?» → причины-дистракторы притянуты → лучше «какое море одно из самых пресных?» → Балтийское, и дистракторы-моря чисты). Дистрактор НЕ должен повторять сущность, которую вопрос НАЗЫВАЕТ или с которой СРАВНИВАЕТ (q_216: «больше, чем английский флот» + дистрактор «Английские пушки» - пушки часть английского флота = путаница/квази-протечка; убрать или заменить). Только если и сменой угла 4 чистых не выходит → drop (dropReason="distractors").
2. УГОЛ - сюрприз в ОТВЕТ: если «ого»-факт в премисе, а ответ - забываемый ярлык (страна/город/имя/«кто первый») → перевернуть (число/год/атрибуция в ответ), поднять newAngle, обновить explanation. Банал/очевидное-из-вопроса/микротопоним/школьная-программа → drop (angle).
3. ПРОТЕЧКА: ни ответ, ни его различающее слово не в вопросе - включая предлог («под»→«под землёй») и тавтологию имени. Иначе переформулировать или drop (leak-obvious).
4. ФОРМУЛИРОВКА: ясная, полная, ОДНО предложение, без странных оборотов; «до скольких/во сколько» → «до какой/в котором»; НИКОГДА не уточнять «вариантов 4 / правильный один»; уточняй национальность/принадлежность неоднозначных имён («испанская Непобедимая армада», не просто «Непобедимая армада»); СОХРАНЯЙ смыслообразующие уточнения - не выбрасывай их при сокращении (q_325: «электронные/e-mail письма», а не просто «письма» - иначе теряется суть про спам в почте; эпоха, страна, контекст). Неисправимо → drop (phrasing).
5. СЛОЖНОСТЬ: не задротство/учебник/лекция; sweet spot ~45-75%; бытовой факт про обычные вещи - ок. Ультраниша → drop (too-hard).
6. ТИРЕ: только дефис «-»; ВСТАВОЧНОЕ/ПАРНОЕ тире → ЗАПЯТАЯ, не дефис.
7. «ПОЧЕМУ»-вопрос: ответ обязан объяснять ПРИЧИНУ; если 4 правдоподобных причинных не выходит → drop (why-not-answered).
8. ПАДЕЖ/EXPLANATION: ответы в именительном; вопросительное слово согласовано с типом ответа и дистракторов. explanation (факт-награда, 1-2 предлож.): если ПУСТ - СГЕНЕРИРУЙ; если есть - сохрани/обнови под новый ответ.
9. НАУЧНАЯ ТОЧНОСТЬ: ни вопрос, ни ответ не должны быть физически/научно НЕВЕРНЫ даже в упрощении (напр. «атомы светятся сами» неверно - их ВОЗБУЖДАЮТ, и они излучают; верно «возбуждённые атомы излучают»). Для «что заставляет/почему» ответ обязан ТОЧНО называть причину/механизм, а не отрицать причину.
prohibited (A.0): эзотерика/гадания/действующая религия/текущая политика/жестокость к детям-животным → drop. duplicate распознать нельзя по одному - не использовать.
newAngle 1-5. factDoubt=true для цитат/атрибуций/«первый»/удивительных историко-фольклорных/спорной этимологии.`

const repairPrompt = (file) => `Ты финальный редактор вопросов BigQuiz (взрослые, русский). Прочитай docs/category-risks.md (A.0, A.3, A.5, A.8) и файл ${file} - массив вопросов (id, question, answers[4], correctAnswerIndex, explanation возможно пуст, original возможно есть, userNote/priorFlag возможно есть). Это ФИНАЛЬНАЯ доводка.

userNote (если есть) - ПРЯМОЕ замечание пользователя («не ок» с причиной). ВЫПОЛНИ его В ПЕРВУЮ ОЧЕРЕДЬ: почини ровно то, на что он указал (рерайт дистрактора, переворот угла, переформулировка). Цель - спасти по его замечанию, а не дропнуть. drop=true по userNote только если он явно просит дроп/дубликат.
priorFlag (если есть) - причина прошлого АВТО-дропа. Прошлый классификатор бывал слишком строг и метил ЛОЖНО (напр. чистый вопрос-идентификацию «какое море = реликт Тетиса» как 'comparison'). ПЕРЕПРОВЕРЬ сам: если проблема реальна - почини; если её на деле нет и вопрос хорош - ОСТАВЬ (drop=false, changed='без изменений'). НЕ дропай по priorFlag без собственного подтверждения.

${STANDARD}

${PRINCIPLES}

Для каждого верни (echo id): question, answers[4], correctAnswerIndex (в ОТРЕДАКТИРОВАННОМ массиве), explanation, newAngle, drop, dropReason, factDoubt, changed (1 фраза). Минимальный диф там, где вопрос уже идеален. Верни строго по схеме ВСЕ вопросы.`

const proofPrompt = (items) => `Строгий корректор русского. Проверь КАЖДЫЙ ТОЛЬКО на язык: согласование/падежи/окончания/орфографию, повтор слов, и пунктуацию. ВАЖНО: вставочное/парное тире («текст — вставка —») и тире-как-знак внутри фразы → ЗАПЯТАЯ (не дефис). Дефис только где он реально дефис (диапазоны, сложные слова). Смысл/факт/угол НЕ меняй.
${JSON.stringify(items.map((x) => ({ id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex })), null, 2)}
Верни id, исправленные question/answers/correctAnswerIndex (чисто - без изменений), proofNote. Строго по схеме все.`

const verifyPrompt = (items) => `Ты придирчивый финальный ревьюер. Перечитай каждый вопрос по своду (A.0/A.3/A.5/A.8 + 8 классов: дистракторы, угол/сюрприз-в-ответ, протечка, формулировка, сложность, тире, «почему», падеж/explanation).

ПРИОРИТЕТ - ПОЧИНИТЬ, не дропнуть (цель базы - довести вопросы, а не отсеять):
- verdict="drop" ТОЛЬКО если вопрос ФУНДАМЕНТАЛЬНО неспасаем: банальный/ультранишевый ФАКТ (саму суть не исправить правкой), нельзя дать 4 правдоподобных дистрактора, запрещённая тема A.0, подтверждённый миф. issue - почему неспасаем.
- verdict="refix", если изъян ЧИНИТСЯ правкой (рыхлый/тоже-верный/синоним/off-topic/абсурдный дистрактор; сюрприз в премисе; протечка; вставочное тире; «почему» без причины; неясная формулировка; «4 варианта»; не именительный; плохой explanation). issue - что именно починить.
- verdict="pass" - если придраться не к чему.
НЕ дропай то, что чинится. Сомнительный по форме → refix, а не drop.

${JSON.stringify(items.map((x) => ({ id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex, explanation: x.explanation })), null, 2)}
Echo id. Строго по схеме все.`

const refixPrompt = (items) => `Финальная ДОВОДКА: эти вопросы признаны спасаемыми, но требуют конкретной починки (issue). Почини КАЖДЫЙ ровно по его issue, доведя до полного соответствия своду (дистракторы правдоподобны и однозначно неверны; сюрприз в ответе; без протечки; одно предложение; именительный падеж; тире-вставка → запятая; «почему» - ответ объясняет причину). Если issue про ПРИТЯНУТЫЕ/тоже-верные дистракторы - можно и нужно СМЕНИТЬ УГОЛ вопроса, чтобы дистракторы стали чистыми (напр. с «почему X пресное» на «какое море самое пресное» → моря-дистракторы), сохранив факт-сюрприз в ОТВЕТЕ. explanation сохрани/обнови. НЕ дропать - задача спасти.

${JSON.stringify(items.map((x) => ({ id: x.id, issue: x.verifyIssue || '', question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex, explanation: x.explanation })), null, 2)}
Echo id. Верни question/answers[4]/correctAnswerIndex/explanation/changed. Строго по схеме все.`

const factPrompt = (q) => `Проверь ФАКТ по интернету (ToolSearch "select:WebSearch,WebFetch", 1-2 запроса). Проверяй ИМЕННО то, на чём держится вопрос, не смежное. Соцсеть ≠ подтверждение.
id: ${q.id} (верни ровно этот)
Вопрос: ${q.question}
Верный ответ: ${q.answers[q.correctAnswerIndex]}
factVerdict: true | myth (байка/развенчано даже при верном ответе) | wrong | unverifiable. explanation 1-2 фразы + источник. Если ответ неверен, но спасаем вариантом из списка - correctedAnswer.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/final-in/*.json` и верни массив путей. Пусто - пустой массив.', { label: 'list', phase: 'Repair', model: 'haiku', schema: S })
  return (r && r.files) || []
}

phase('Repair')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),

  // 1. Repair
  (file) => agent(repairPrompt(file), { label: `repair:${file.split('/').pop()}`, phase: 'Repair', model: 'sonnet', effort: 'medium', schema: REPAIR_SCHEMA })
    .then((r) => ({ slug: file.split('/').pop().replace(/\.json$/, ''), items: (r && r.items) || [] })),

  // 2. Proof (по не-дроп)
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

  // 3. Verify (fix-first): drop ТОЛЬКО неспасаемое; чинимое → refix; иначе pass.
  async (rep) => {
    if (!rep) return null
    const keep = rep.items.filter((x) => !x.drop)
    if (keep.length) {
      const ver = await agent(verifyPrompt(keep), { label: `verify:${rep.slug}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: VERIFY_SCHEMA })
      const v = new Map(((ver && ver.items) || []).map((x) => [x.id, x]))
      rep.items = rep.items.map((it) => {
        const vi = v.get(it.id)
        if (!vi || it.drop) return it
        if (vi.verdict === 'drop') return { ...it, drop: true, dropReason: it.dropReason || 'verify-unfixable', verifyIssue: vi.issue }
        if (vi.verdict === 'refix') return { ...it, needsRefix: true, verifyIssue: vi.issue }
        return it
      })
    }
    return rep
  },

  // 3b. Refix - спасаем то, что verify пометил refix (чиним по issue, НЕ дропаем).
  async (rep) => {
    if (!rep) return null
    const toFix = rep.items.filter((x) => x.needsRefix && !x.drop)
    if (toFix.length) {
      const fx = await agent(refixPrompt(toFix), { label: `refix:${rep.slug}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: REFIX_SCHEMA })
      const f = new Map(((fx && fx.items) || []).map((x) => [x.id, x]))
      rep.items = rep.items.map((it) => { const fi = f.get(it.id); return fi ? { ...it, question: fi.question, answers: fi.answers, correctAnswerIndex: fi.correctAnswerIndex, explanation: fi.explanation, changed: (it.changed || '') + ' | refix: ' + (fi.changed || '') } : it })
    }
    return rep
  },

  // 4. Fact (веб) по сомнительным выжившим
  async (rep) => {
    if (!rep) return null
    const doubtful = rep.items.filter((it) => !it.drop && it.factDoubt && it.newAngle > 2)
    const facts = await parallel(doubtful.map((q) => () => agent(factPrompt(q), { label: `fact:${q.id}`, phase: 'Fact', model: 'sonnet', effort: 'medium', schema: FACT_SCHEMA })))
    const fById = new Map(facts.filter(Boolean).map((f) => [f.id, f]))
    rep.items = rep.items.map((it) => ({ ...it, fact: fById.get(it.id) || null }))
    return rep
  },

  // 5. Save
  async (rep) => {
    if (!rep) return null
    await agent(`Создай scripts/final-out/${rep.slug}.json (и папку, если нет) и запиши ДОСЛОВНО этот JSON. После ответь только "ok".\n\n${JSON.stringify(rep)}`, { label: `save:${rep.slug}`, phase: 'Save', model: 'haiku' })
    return { slug: rep.slug, total: rep.items.length, dropped: rep.items.filter((x) => x.drop).length }
  }
)

const clean = results.filter(Boolean)
return { groups: clean.length, total: clean.reduce((a, r) => a + r.total, 0), dropped: clean.reduce((a, r) => a + r.dropped, 0) }
