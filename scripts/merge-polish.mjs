// Возвращает результаты polish.workflow.js (scripts/polish-out/*.json) в ПУЛ ревью
// (data/review-pool.json) — вопросы попадали в polish через кнопку «На доработку».
//   - Починенные: сохраняем preReworkVersion (было), применяем новый текст,
//     reworkedAt + reworkNote (что изменено), статус → pending (на повторное ревью),
//     поля проблемы/предложения/тегов очищаем (отработаны, сохранены в preReworkVersion).
//   - Дропнутые polish (drop / факт-миф / неверно): статус → discard, reworkNote с причиной
//     (человек увидит и при желании воскресит).
//   - Код-гейты (длина/тире/запрет): нарушены → откат к оригиналу, статус → pending,
//     reworkNote='гейт провален' (перетриажишь вручную).
// Каждое действие пишется в журнал data/review-log.jsonl (корпус для анализатора).
//
// node scripts/merge-polish.mjs && npm test

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, gatesOk, loadPool, appendLog, snapshot } from './lib/review-store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'scripts', 'polish-out')
if (!existsSync(DIR)) { console.error('Нет polish-out — сначала прогони воркфлоу polish.'); process.exit(1) }

const POOL = join(ROOT, 'data', 'review-pool.json')
if (!existsSync(POOL)) { console.error('Нет data/review-pool.json — нечего обновлять.'); process.exit(1) }

// Собрать все результаты polish по id
const byId = new Map()
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(join(DIR, f), 'utf8')).items || []) byId.set(it.id, it)
}

const data = loadPool()
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
copyFileSync(POOL, POOL.replace(/\.json$/, `.backup-${stamp}.json`))
const now = new Date().toISOString()

const stat = { fixed: 0, unchanged: 0, dropped: 0, reverted: 0 }

for (const q of data.questions) {
  const r = byId.get(q.id)
  if (!r) continue
  const before = snapshot(q)

  // Дроп polish (по классам или по факту) → discard, человек решит окончательно
  if (r.drop || (r.fact && (r.fact.factVerdict === 'myth' || r.fact.factVerdict === 'wrong'))) {
    const reason = r.drop ? r.dropReason || 'other' : 'fact-' + r.fact.factVerdict
    const issue = r.verifyIssue || (r.fact && r.fact.explanation) || ''
    q.reviewStatus = 'discard'
    q.reworkedAt = now
    q.reworkNote = 'polish не смог: ' + reason + (issue ? ' — ' + issue.slice(0, 120) : '')
    stat.dropped++
    appendLog({ id: q.id, action: 'rework-drop', reason, before, after: null })
    continue
  }

  // Без изменений — polish решил, что вопрос уже ок
  if (!r.changed || /^без изменений/i.test(r.changed)) {
    q.reviewStatus = 'pending'
    q.reworkedAt = now
    q.reworkNote = 'без изменений'
    stat.unchanged++
    appendLog({ id: q.id, action: 'rework-nochange', before, after: before })
    continue
  }

  // Применить исправленный текст
  const newQ = stripDashes(r.question || q.question)
  const newA = (r.answers || q.answers).map(stripDashes)
  const newCI = r.correctAnswerIndex ?? q.correctAnswerIndex

  if (!gatesOk({ question: newQ, answers: newA })) {
    // Правка не уложилась в гейт (обычно: укорочены не все ответы) — оставляем в
    // ОЧЕРЕДИ (rework), чтобы добить следующим проходом, а не потерять. reworkedAt НЕ
    // ставим: правка не применена, бейдж «прошёл доработку» был бы враньём.
    q.reviewStatus = 'rework'
    q.reworkNote = 'доработка не применена (гейт длины) — нужна повторная'
    stat.reverted++
    appendLog({ id: q.id, action: 'rework-revert', reason: 'code-gate', before, after: null })
    continue
  }

  q.preReworkVersion = before
  q.question = newQ
  q.answers = newA
  q.correctAnswerIndex = newCI
  if (r.explanation) q.explanation = stripDashes(r.explanation)
  q.reworkedAt = now
  q.reworkNote = r.changed
  q.reviewStatus = 'pending'
  delete q.reviewProblem
  delete q.reviewSuggestion
  delete q.reviewTags
  stat.fixed++
  appendLog({
    id: q.id, action: 'rework', reason: (before.reviewProblem + ' ' + (before.reviewTags || []).join(',')).trim(),
    before, after: { question: newQ, answers: newA, correctAnswerIndex: newCI }
  })
}

writeFileSync(POOL, JSON.stringify(data, null, 2) + '\n')
console.log(`rework merge → пул: починено ${stat.fixed} · без изм. ${stat.unchanged} · дроп ${stat.dropped} · откат ${stat.reverted}`)
console.log('Доработанные вернулись в пул как pending (с бейджем «прошёл доработку») — пере-ревьюй в админке.')
