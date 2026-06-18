// Воркфлоу полного аудита: проверяет КАЖДЫЙ вопрос под текущий полный свод правил
// (docs/category-risks.md) и правит только провалившиеся. В отличие от edit-questions
// (правит по заметкам ревьюера), здесь критерии применяются ко ВСЕМ вопросам — ловит то,
// что прошло старого, более мягкого судью или вообще не пересматривалось.
//
// Запуск: Workflow({ scriptPath: "scripts/audit-questions.workflow.js", args: { ids: ["q_001", ...] } })
//   Данные вопроса — в scripts/audit-in/<id>.json (id, status, question, answers,
//   correctAnswerIndex, explanation); агенты читают их оттуда.
//
// Пайплайн на каждый id:
//   1. Audit  — Opus судит под ВСЕ критерии, возвращает ok + конкретные issues.
//   2. Fix    — если !ok: Sonnet правит по issues + всем правилам (иначе пропуск).
//   3. Verify — если правили: Opus (low) перепроверяет.
//   4. Save   — Haiku пишет scripts/audit-out/<id>.json.
// Дальше scripts/merge-audit.mjs патчит исправленные в questions.json (и шлёт их в pending).

export const meta = {
  name: 'audit-questions',
  description: 'Полный аудит вопросов под текущий свод правил (Opus судит все → Sonnet правит провалы → Opus low проверяет)',
  phases: [
    { title: 'Audit', detail: 'Opus: каждый вопрос под все критерии' },
    { title: 'Fix', detail: 'Sonnet правит провалившиеся' },
    { title: 'Verify', detail: 'Opus low перепроверяет правки' },
    { title: 'Save', detail: 'Haiku: scripts/audit-out/<id>.json' }
  ]
}

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = null } }
const IDS = (A && A.ids) || []
if (!IDS.length) { log('args.ids пуст — нечего проверять.'); return { error: 'no-ids' } }
log(`Вопросов к аудиту: ${IDS.length}`)

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['id', 'ok', 'factuallyCorrect', 'oneCorrect', 'angleOk', 'notBanal', 'noMyth', 'cleanDistractors', 'naturalLanguage', 'issues'],
  properties: {
    id: { type: 'string' },
    ok: { type: 'boolean' },
    factuallyCorrect: { type: 'boolean' },
    oneCorrect: { type: 'boolean' },
    angleOk: { type: 'boolean' },
    notBanal: { type: 'boolean' },
    noMyth: { type: 'boolean' },
    cleanDistractors: { type: 'boolean' },
    naturalLanguage: { type: 'boolean' },
    issues: { type: 'string' }
  }
}

const EDIT_SCHEMA = {
  type: 'object',
  required: ['id', 'question', 'answers', 'correctAnswerIndex', 'explanation', 'changed', 'removeSuggested', 'reason'],
  properties: {
    id: { type: 'string' },
    question: { type: 'string' },
    answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', maxLength: 44 } },
    correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
    explanation: { type: 'string' },
    changed: { type: 'boolean' },
    removeSuggested: { type: 'boolean' },
    reason: { type: 'string' }
  }
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['id', 'ok', 'issues'],
  properties: { id: { type: 'string' }, ok: { type: 'boolean' }, issues: { type: 'string' } }
}

const auditPrompt = (id) => `Ты строгий аудитор вопросов викторины. Прочитай docs/category-risks.md ПОЛНОСТЬЮ и файл scripts/audit-in/${id}.json (question, answers, correctAnswerIndex, explanation, status). Оцени этот вопрос под ВЕСЬ свод правил.

Верни флаги (true = норма):
- factuallyCorrect: факт верен, не миф/байка (A.9).
- oneCorrect: под формулировку верен РОВНО один вариант; ни один дистрактор не является тоже-правильным.
- angleOk: «факт, а не ярлык» (A.3); «зачем» только про намеренное действие, иначе «почему».
- notBanal: ответ НЕ выводится здравым смыслом за секунду (A.2); не банальщина.
- noMyth: факт-награда не развенчанная байка/народная этимология (A.9).
- cleanDistractors: 4 из одной области, логичны под вопрос, начинаются с разных слов, без протечки слова-ответа, не синонимы.
- naturalLanguage: грамотный живой русский, одно предложение, без жаргона/канцелярита.
(Лимит длины и тире проверяются кодом отдельно — их не оценивай.)

ok = все флаги true. Если ok=false — в issues дай КОНКРЕТНОЕ замечание (что не так и как чинить), чтобы редактор мог исправить. Если ok=true — issues пустая строка. id="${id}".`

const fixPrompt = (id, issues) => `Ты редактор вопросов викторины. Прочитай docs/category-risks.md (A.2, A.3, A.5, A.8) и scripts/audit-in/${id}.json. Исправь этот вопрос по замечанию аудитора, сохранив фактическую верность.

ЗАМЕЧАНИЕ АУДИТОРА (устрани его): «${issues}»

Правила вывода (соблюдай ВСЕ):
- Ответы: ровно 4, ≤ 5 слов и ≤ 44 символов, слово ≤ 18 символов; однородные; РОВНО ОДИН верный; дистракторы логичны и начинаются с разных слов; без протечки слова-ответа.
- Язык: грамотный русский, одно предложение; ДЕФИС \`-\`, не тире; без ударений; числа цифрами; «зачем» только про намеренное действие, иначе «почему».
- Сильный explanation. Тему меняй только если иначе не спасти.
- correctAnswerIndex указывает на верный в НОВОМ массиве answers.
Если вопрос некорректен в принципе и спасти нечем — removeSuggested=true. changed=true если менял. reason — кратко. id="${id}".`

const verifyPrompt = (id, ed) => `Перепроверь отредактированный вопрос (id ${id}) под docs/category-risks.md. Версия:
${JSON.stringify({ question: ed.question, answers: ed.answers, correctAnswerIndex: ed.correctAnswerIndex, explanation: ed.explanation }, null, 2)}
ok=true, если: факт верен и не миф; ровно один верный; «зачем/почему» корректно; не банально; язык грамотный; ответы в лимитах; дефис не тире. Если ok=false — issues кратко. id="${id}".`

phase('Audit')
const results = await pipeline(
  IDS,
  (id) => agent(auditPrompt(id), { label: `audit:${id}`, phase: 'Audit', schema: AUDIT_SCHEMA }),
  (au, id) => {
    if (!au) return null
    if (au.ok) return { id, audit: au, edited: null, verify: null }
    return agent(fixPrompt(id, au.issues), { label: `fix:${id}`, phase: 'Fix', model: 'sonnet', schema: EDIT_SCHEMA })
      .then((ed) => ({ id, audit: au, edited: ed }))
  },
  async (r, id) => {
    if (!r) return null
    let verify = null
    if (r.edited && !r.edited.removeSuggested) {
      verify = await agent(verifyPrompt(id, r.edited), { label: `verify:${id}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'low' })
    }
    const out = { id, status: (r.audit && r.audit.id) ? undefined : undefined, audit: r.audit, edited: r.edited, verify }
    await agent(
      `Создай файл scripts/audit-out/${id}.json (создай папку scripts/audit-out, если нет) и запиши ДОСЛОВНО этот JSON целиком. Ответь только ok.\n\n${JSON.stringify({ id, audit: r.audit, edited: r.edited, verify })}`,
      { label: `save:${id}`, phase: 'Save', model: 'haiku' }
    )
    return { id, ok: !!(r.audit && r.audit.ok), changed: !!(r.edited && r.edited.changed), removeSuggested: !!(r.edited && r.edited.removeSuggested), verifyOk: !!(verify && verify.ok) }
  }
)

const clean = results.filter(Boolean)
return {
  audited: clean.length,
  passed: clean.filter((r) => r.ok).length,
  failed: clean.filter((r) => !r.ok).length,
  fixed: clean.filter((r) => r.changed).length,
  removeSuggested: clean.filter((r) => r.removeSuggested).map((r) => r.id),
  verifyFailed: clean.filter((r) => r.changed && !r.verifyOk).map((r) => r.id)
}
