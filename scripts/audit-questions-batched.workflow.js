// Дешёвый БАТЧ-аудит вопросов под текущий свод правил (docs/category-risks.md).
// В отличие от audit-questions.workflow.js (1 агент на вопрос + каждый читает весь свод правил),
// здесь:
//   - args передаёт только список id (≈3KB), а группы-агенты сами читают свои ~groupSize
//     файлов scripts/audit-in/<id>.json (мелкие, дешёвые) — полный свод правил НЕ читается;
//   - свод правил вшит в промпт сжатым чек-листом (RULES);
//   - аудит / правка / перепроверка идут ПАЧКАМИ (~groupSize вопросов за один вызов агента);
//   - воркфлоу не пишет файлы (нет save-агентов) — возвращает schema-валидные records,
//     которые главный цикл сам пишет в scripts/audit-out/<id>.json (тот же контракт для merge-audit.mjs).
//
// Запуск: Workflow({ scriptPath: "scripts/audit-questions-batched.workflow.js",
//   args: { ids: ["q_037", "q_038", ...], groupSize: 12 } })
// Предусловие: scripts/audit-in/<id>.json уже подготовлены (Шаг 1 audit-runbook).

export const meta = {
  name: 'audit-questions-batched',
  description: 'Батч-аудит вопросов: Opus судит пачками (правила вшиты) → Sonnet правит провалы пачкой → Opus low проверяет пачкой; данные в args, файлы пишет главный цикл',
  phases: [
    { title: 'Audit', detail: 'Opus: пачка вопросов за вызов' },
    { title: 'Fix', detail: 'Sonnet: правит провалы пачкой' },
    { title: 'Verify', detail: 'Opus low: проверяет правки пачкой' }
  ]
}

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = null } }
const IDS = (A && A.ids) || []
const GROUP = (A && A.groupSize) || 12
if (!IDS.length) { log('args.ids пуст — нечего проверять.'); return { error: 'no-ids' } }
log(`Вопросов к аудиту: ${IDS.length}, группами по ${GROUP}`)

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// Сжатый свод правил — вшивается в каждый промпт вместо чтения docs/category-risks.md.
const RULES = `СВОД ПРАВИЛ (применяй ВЕСЬ):
- A.2 НЕ банально: ответ не выводится здравым смыслом за секунду; коридор ответимости ~45-75% образованных взрослых. Не школьная программа в лоб, не ультранишевое задротство.
- A.3 ФАКТ, А НЕ ЯРЛЫК (главное): правильный ответ — интересный факт/механизм/причина/назначение/масштаб, а НЕ зазубренное имя/термин/дата/аббревиатура/спецификация ради них самих. Спрашивай зачем/как/насколько/почему так устроено. Цель — «не знал, расскажу друзьям». Исключение: ярлык годится, если сам по себе факт-сюрприз, или число поражает само по себе.
- A.5 ОТВЕТЫ И ДИСТРАКТОРЫ: 4 ответа однородны (один тип), РОВНО ОДИН верный под формулировку (проверь каждый дистрактор — он должен быть однозначно неверным). Дистракторы из одной области, логичны под вопрос, не синонимы, не «из чужой оперы», начинаются с РАЗНЫХ слов, без протечки слова-ответа в правильный вариант. Факт-награда explanation обязателен и силён.
- A.8 ЯЗЫК: грамотный живой разговорный русский, строго ОДНО предложение без вступлений; без жаргона/канцелярита/англо-аббревиатур в теле (формализм — в explanation); БЕЗ знаков ударения; «зачем» только про намеренное действие, для явлений природы — «почему»; числа цифрами.
- A.9 АНТИ-МИФ: факт академически подтверждён, не народная этимология / городская легенда / публицистический штамп / апокриф. Чёрный список: salary↔соль, рогатые шлемы викингов, Эйнштейн-двоечник, 10% мозга, перевёрнутая марка=измена и т.п. Если один из дистракторов на деле ближе к истине — вопрос негоден.`

const AUDIT_ITEM = {
  type: 'object',
  required: ['id', 'ok', 'factuallyCorrect', 'oneCorrect', 'angleOk', 'notBanal', 'noMyth', 'cleanDistractors', 'naturalLanguage', 'issues'],
  properties: {
    id: { type: 'string' }, ok: { type: 'boolean' },
    factuallyCorrect: { type: 'boolean' }, oneCorrect: { type: 'boolean' }, angleOk: { type: 'boolean' },
    notBanal: { type: 'boolean' }, noMyth: { type: 'boolean' }, cleanDistractors: { type: 'boolean' }, naturalLanguage: { type: 'boolean' },
    issues: { type: 'string' }
  }
}
const AUDIT_SCHEMA = { type: 'object', required: ['verdicts'], properties: { verdicts: { type: 'array', items: AUDIT_ITEM } } }

const EDIT_ITEM = {
  type: 'object',
  required: ['id', 'question', 'answers', 'correctAnswerIndex', 'explanation', 'changed', 'removeSuggested', 'reason'],
  properties: {
    id: { type: 'string' }, question: { type: 'string' },
    answers: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', maxLength: 44 } },
    correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
    explanation: { type: 'string' }, changed: { type: 'boolean' }, removeSuggested: { type: 'boolean' }, reason: { type: 'string' }
  }
}
const EDIT_SCHEMA = { type: 'object', required: ['edits'], properties: { edits: { type: 'array', items: EDIT_ITEM } } }

const VERIFY_ITEM = { type: 'object', required: ['id', 'ok', 'issues'], properties: { id: { type: 'string' }, ok: { type: 'boolean' }, issues: { type: 'string' } } }
const VERIFY_SCHEMA = { type: 'object', required: ['verdicts'], properties: { verdicts: { type: 'array', items: VERIFY_ITEM } } }

const auditPrompt = (ids) => `Ты строгий аудитор-фактчекер вопросов викторины для взрослых (русский язык).
${RULES}

Прочитай файлы вопросов (по одному на id): ${ids.map((id) => `scripts/audit-in/${id}.json`).join(', ')}.
В каждом файле поля question, answers, correctAnswerIndex (индекс верного ответа в answers), explanation.

Оцени КАЖДЫЙ из ${ids.length} вопросов. Для каждого верни объект с его id и булевыми флагами (true = норма):
- factuallyCorrect: факт верен, не миф/байка (A.9).
- oneCorrect: под формулировку верен РОВНО один вариант; ни один дистрактор не является тоже-правильным.
- angleOk: «факт, а не ярлык» (A.3); «зачем» только про намеренное действие, иначе «почему».
- notBanal: ответ НЕ выводится здравым смыслом за секунду (A.2); не банальщина.
- noMyth: факт-награда не развенчанная байка/народная этимология (A.9).
- cleanDistractors: 4 из одной области, логичны под вопрос, начинаются с разных слов, без протечки слова-ответа, не синонимы.
- naturalLanguage: грамотный живой русский, одно предложение, без жаргона/канцелярита/ударений.
(Лимит длины ответа и тире проверяет код отдельно — их НЕ оценивай.)

ok = все семь флагов true. Если ok=false — в issues дай КОНКРЕТНОЕ замечание (что не так и как чинить), чтобы редактор исправил. Если ok=true — issues="".

Верни verdicts — РОВНО по одному объекту на каждый id из списка: ${JSON.stringify(ids)}.`

const fixPrompt = (items) => `Ты редактор вопросов викторины для взрослых (русский).
${RULES}

Для каждого вопроса прочитай его файл scripts/audit-in/<id>.json (поля question, answers, correctAnswerIndex, explanation) и исправь по замечанию аудитора (поле issues ниже), сохранив фактическую верность. Правила вывода для каждого:
- answers: ровно 4, ≤ 5 слов и ≤ 44 символов, ни одно слово > 18 символов; однородные; РОВНО ОДИН верный; дистракторы логичны под вопрос и начинаются с разных слов; без протечки слова-ответа.
- Язык: грамотный русский, одно предложение; только дефис (минус), не тире; без знаков ударения; числа цифрами; «зачем» только про намеренное действие, иначе «почему».
- Сильный explanation (факт-награда). Тему меняй только если иначе не спасти.
- correctAnswerIndex указывает на верный вариант в НОВОМ массиве answers.
- Если вопрос некорректен в принципе и спасти нечем — removeSuggested=true. changed=true если менял. reason — кратко.

id и замечания аудитора:
${JSON.stringify(items, null, 2)}

Верни edits — РОВНО по одному объекту на каждый id из списка.`

const verifyPrompt = (items) => `Перепроверь отредактированные вопросы викторины под свод правил.
${RULES}

Для каждого ok=true, если: факт верен и не миф; ровно один верный; «зачем/почему» корректно; не банально; язык грамотный, одно предложение; дистракторы чистые. Если ok=false — issues кратко (что осталось не так). (Длину/тире не оценивай — это код.)

Версии после правки:
${JSON.stringify(items, null, 2)}

Верни verdicts — РОВНО по одному объекту на каждый id.`

// --- Audit (пачками, барьер: нужны ВСЕ провалы перед фазой Fix) ---
phase('Audit')
const auditGroups = chunk(IDS, GROUP)
const auditRes = await parallel(auditGroups.map((g, gi) => () =>
  agent(auditPrompt(g), { label: `audit:g${gi + 1}/${auditGroups.length}`, phase: 'Audit', schema: AUDIT_SCHEMA })
))
const audits = new Map()
for (const r of auditRes) if (r && r.verdicts) for (const v of r.verdicts) audits.set(v.id, v)

const failed = IDS.filter((id) => { const a = audits.get(id); return a && !a.ok })
  .map((id) => ({ id, issues: audits.get(id).issues }))
log(`Провалили аудит: ${failed.length} из ${IDS.length}`)

// --- Fix (пачками) ---
phase('Fix')
const edits = new Map()
if (failed.length) {
  const fixGroups = chunk(failed, GROUP)
  const fixRes = await parallel(fixGroups.map((g, gi) => () =>
    agent(fixPrompt(g), { label: `fix:g${gi + 1}/${fixGroups.length}`, phase: 'Fix', model: 'sonnet', schema: EDIT_SCHEMA })
  ))
  for (const r of fixRes) if (r && r.edits) for (const e of r.edits) edits.set(e.id, e)
}

// --- Verify (пачками, только реально изменённые и не помеченные на удаление) ---
phase('Verify')
const verifies = new Map()
const toVerify = []
for (const [id, e] of edits) if (e && !e.removeSuggested) toVerify.push({ id, question: e.question, answers: e.answers, correctAnswerIndex: e.correctAnswerIndex, explanation: e.explanation })
if (toVerify.length) {
  const vGroups = chunk(toVerify, GROUP)
  const vRes = await parallel(vGroups.map((g, gi) => () =>
    agent(verifyPrompt(g), { label: `verify:g${gi + 1}/${vGroups.length}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'low' })
  ))
  for (const r of vRes) if (r && r.verdicts) for (const v of r.verdicts) verifies.set(v.id, v)
}

// Сборка records для главного цикла: он сам пишет scripts/audit-out/<id>.json (контракт merge-audit.mjs).
const records = IDS.map((id) => ({
  id,
  audit: audits.get(id) || null,
  edited: edits.get(id) || null,
  verify: verifies.get(id) || null
}))

return {
  audited: IDS.length,
  passed: records.filter((r) => r.audit && r.audit.ok).length,
  failed: failed.length,
  fixed: records.filter((r) => r.edited && r.edited.changed).length,
  removeSuggested: records.filter((r) => r.edited && r.edited.removeSuggested).map((r) => r.id),
  verifyFailed: records.filter((r) => r.edited && r.edited.changed && !(r.verify && r.verify.ok)).map((r) => r.id),
  records
}
