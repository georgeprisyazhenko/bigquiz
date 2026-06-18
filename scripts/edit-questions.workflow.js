// Воркфлоу прогон-редактор: применяет заметки ревью к уже сгенерированным вопросам.
// Запуск: Workflow({ scriptPath: "scripts/edit-questions.workflow.js", args: { ids: ["q_146", ...] } })
//   Полные данные вопросов + заметки лежат в scripts/edit-in.json (id → {question, answers,
//   correctAnswerIndex, explanation, note, status, violations}); агенты читают их оттуда.
//
// Пайплайн на каждый id:
//   1. Edit   — Sonnet читает edit-in.json, применяет заметку ревьюера + ВСЕ контент-правила.
//   2. Verify — Opus (effort low) проверяет факт/коридор/лимиты/учтена ли заметка.
//   3. Save   — Haiku пишет scripts/edit-out/<id>.json.
// Дальше scripts/merge-edits.mjs патчит public/questions.json по id.

export const meta = {
  name: 'edit-questions',
  description: 'Прогон-редактор: применить заметки ревью к вопросам (Sonnet правит → Opus low проверяет)',
  phases: [
    { title: 'Edit', detail: 'Sonnet применяет заметку + контент-правила' },
    { title: 'Verify', detail: 'Opus low: факт/лимит/заметка учтена' },
    { title: 'Save', detail: 'Haiku: scripts/edit-out/<id>.json' }
  ]
}

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = null } }
const IDS = (A && A.ids) || []
if (!IDS.length) { log('args.ids пуст — нечего править.'); return { error: 'no-ids', edited: 0 } }
log(`Вопросов к правке: ${IDS.length}`)

const EDIT_SCHEMA = {
  type: 'object',
  required: ['id', 'status', 'note', 'question', 'answers', 'correctAnswerIndex', 'explanation', 'changed', 'removeSuggested', 'reason'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string' },
    note: { type: 'string' },
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
  required: ['id', 'ok', 'factuallyCorrect', 'contentRulesOk', 'noteAddressed', 'issues'],
  properties: {
    id: { type: 'string' },
    ok: { type: 'boolean' },
    factuallyCorrect: { type: 'boolean' },
    contentRulesOk: { type: 'boolean' },
    noteAddressed: { type: 'boolean' },
    issues: { type: 'string' }
  }
}

const editPrompt = (id) => `Ты редактор вопросов викторины. Прочитай docs/category-risks.md (A.3, A.5, A.8 — все правила) и файл scripts/edit-in/${id}.json — там поля question, answers, correctAnswerIndex, explanation, а также note (ЗАМЕТКА РЕВЬЮЕРА), status, violations. Исправь этот один вопрос.

Главный ориентир — ВЫПОЛНИ заметку ревьюера. Если заметка предлагает другой угол/формулировку — примени. Если заметка — просто похвала, оставь суть, но всё равно приведи к правилам ниже.

Если в файле есть поле priorIssue — это замечание судьи к ПРЕДЫДУЩЕЙ правке этого вопроса; ОБЯЗАТЕЛЬНО устрани его. Чаще всего это «не ровно один верный» (после смены угла подходит несколько ответов) — тогда сузь формулировку или замени дистракторы так, чтобы верным остался ровно один, не теряя сути заметки ревьюера.

Правила (соблюдай ВСЕ):
- Ответы: ровно 4, ≤ 5 слов и ≤ 44 символов каждый, ни одно слово > 18 символов; однородные; РОВНО ОДИН верный; дистракторы логичны под формулировку и начинаются с разных слов; без протечки слова-ответа.
- Язык: грамотный живой русский, одно предложение без вступлений; ДЕФИС \`-\`, не тире \`—\`/\`–\`; без знаков ударения; числа цифрами; «зачем» только про намеренное действие, иначе «почему»; жаргон/аббревиатуры — в explanation.
- Сохрани сильный explanation (факт-награда). Тему не меняй, если заметка не требует.
- correctAnswerIndex указывает на верный вариант в НОВОМ массиве answers.

Если status=rejected и заметка означает, что вопрос некорректен в принципе и спасти нечем — removeSuggested=true. Иначе false.
В ответ верни строго по схеме: id="${id}", status и note скопируй из файла как есть, далее исправленные question/answers/correctAnswerIndex/explanation, changed (менял ли), removeSuggested, reason (кратко что сделал).`

const verifyPrompt = (id, ed) => `Проверь ОТРЕДАКТИРОВАННЫЙ вопрос викторины (id ${id}). Сверься с docs/category-risks.md. Заметка ревьюера была: «${ed.note || '(нет)'}».

Отредактированная версия:
${JSON.stringify({ question: ed.question, answers: ed.answers, correctAnswerIndex: ed.correctAnswerIndex, explanation: ed.explanation }, null, 2)}

Верни:
- factuallyCorrect: факт верен, не миф.
- contentRulesOk: ответы ≤5 слов/≤44 симв/слово ≤18; ровно один верный; дефис не тире; без ударений; одно предложение; «зачем/почему» корректно.
- noteAddressed: заметка ревьюера учтена.
- ok = все три true. issues: если ok=false — кратко что не так, иначе пустая строка. id="${id}".`

phase('Edit')
const results = await pipeline(
  IDS,
  (id) => agent(editPrompt(id), { label: `edit:${id}`, phase: 'Edit', model: 'sonnet', schema: EDIT_SCHEMA }),
  (ed, id) => {
    if (!ed) return null
    return agent(verifyPrompt(id, ed), { label: `verify:${id}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'low' })
      .then((v) => ({ ed, verify: v || { ok: false, issues: 'нет ответа судьи' } }))
  },
  async (r, id) => {
    if (!r) return null
    const out = { id, status: r.ed.status, note: r.ed.note, edited: r.ed, verify: r.verify }
    await agent(
      `Создай файл scripts/edit-out/${id}.json (создай папку scripts/edit-out, если нет) и запиши в него ДОСЛОВНО этот JSON целиком, ничего не меняя. Ответь только ok.\n\n${JSON.stringify(out)}`,
      { label: `save:${id}`, phase: 'Save', model: 'haiku' }
    )
    return { id, status: r.ed.status, changed: !!r.ed.changed, removeSuggested: !!r.ed.removeSuggested, ok: !!(r.verify && r.verify.ok) }
  }
)

const clean = results.filter(Boolean)
return {
  items: clean.length,
  changed: clean.filter((r) => r.changed).length,
  removeSuggested: clean.filter((r) => r.removeSuggested).length,
  verifyFailed: clean.filter((r) => !r.ok).map((r) => r.id),
  reangledRejected: clean.filter((r) => r.status === 'rejected' && !r.removeSuggested).length
}
