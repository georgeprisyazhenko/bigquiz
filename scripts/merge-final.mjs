// Применяет final-pass (scripts/final-out/*.json). node scripts/merge-final.mjs --source old|guestion
//   old      → public/questions.json: drop/verify/факт-реджект → rejected; исправленные → pending;
//              сохраняет image*/imageSearchQuery/categories; БЕЗОПАСНЫЙ откат к оригиналу при нарушении гейта.
//   guestion → public/guestion-clean.json: drop → disposition='drop-*'; kept → применить текст+explanation;
//              ourCategories/tags/original сохраняются; код-гейты.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText, validateNoDashes, validateNoProhibited } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (process.argv.find((a) => a === 'old' || a === 'guestion') || (process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : '')) || ''
if (source !== 'old' && source !== 'guestion') { console.error('Укажи --source old|guestion'); process.exit(1) }

const DIR = join(ROOT, 'scripts', 'final-out')
if (!existsSync(DIR)) { console.error('Нет final-out - сначала прогони воркфлоу.'); process.exit(1) }
const byId = new Map()
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) for (const it of JSON.parse(readFileSync(join(DIR, f), 'utf8')).items || []) byId.set(it.id, it)

const norm = (s) => (s || '').trim().toLowerCase()
const gatesOk = (q, a) => q.length <= 240 && validateNoDashes(q).ok && validateNoProhibited(q).ok && a.every((x) => validateAnswerText(x).ok && validateNoDashes(x).ok && validateNoProhibited(x).ok)
const factReject = (v) => v === 'myth' || v === 'unverifiable'

const P = source === 'old' ? join(ROOT, 'public', 'questions.json') : join(ROOT, 'public', 'guestion-clean.json')
const data = JSON.parse(readFileSync(P, 'utf8'))
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
writeFileSync(P.replace(/\.json$/, `.backup-final-${ts}.json`), JSON.stringify(data, null, 2) + '\n')

const stat = { drop: 0, factReject: 0, fixed: 0, changed: 0, reverted: 0, untouched: 0 }
for (const q of data.questions) {
  const r = byId.get(q.id)
  if (!r) continue // не был в этом прогоне (кого брать - решает prep-final)

  // дроп (классы + verify)
  if (r.drop) {
    if (source === 'old') { q.reviewStatus = 'rejected'; q.reviewNote = 'final-drop: ' + (r.dropReason || 'other') + (r.verifyIssue ? ' | ' + r.verifyIssue : '') }
    else q.disposition = 'drop-' + (r.dropReason || 'other')
    stat.drop++; continue
  }
  // факт
  const v = r.fact ? r.fact.factVerdict : null
  let na = r.answers.map(stripDashes); let ni = r.correctAnswerIndex; let nq = stripDashes(r.question)
  if (factReject(v)) { if (source === 'old') { q.reviewStatus = 'rejected'; q.reviewNote = 'факт: ' + v } else { q.disposition = 'drop-fact'; q.fact = r.fact } stat.factReject++; continue }
  if (v === 'wrong') {
    const ca = norm(r.fact.correctedAnswer); const idx = ca ? na.findIndex((a) => norm(a) === ca || norm(a).includes(ca.split(/[\s(]/)[0])) : -1
    if (idx >= 0) { ni = idx; stat.fixed++ } else { if (source === 'old') { q.reviewStatus = 'rejected'; q.reviewNote = 'факт: wrong' } else q.disposition = 'drop-fact'; stat.factReject++; continue }
  }
  // безопасность: ремонт нарушил гейт
  if (!gatesOk(nq, na)) {
    if (source === 'old') { q.reviewStatus = 'pending'; q.reviewNote = 'ремонт нарушил гейт - оставлен оригинал, проверить' }
    stat.reverted++; continue // для guestion: оставляем старый текст как есть (он уже проходил гейты)
  }
  // применить
  const changed = (r.changed || '') !== 'без изменений' || nq !== q.question || JSON.stringify(na) !== JSON.stringify(q.answers)
  q.question = nq; q.answers = na; q.correctAnswerIndex = ni; q.correctAnswer = na[ni]
  if (r.explanation) q.explanation = stripDashes(r.explanation)
  if (r.fact) q.fact = r.fact
  if (source === 'guestion') q.disposition = 'clean' // спасённый из дропа возвращается в clean
  if (source === 'old') { if (changed) { q.reviewStatus = 'pending'; q.reviewNote = (r.changed || '').slice(0, 160) } }
  if (changed) stat.changed++; else stat.untouched++
}

// пересчёт счётчиков guestion
if (source === 'guestion') { data.clean = data.questions.filter((x) => x.disposition === 'clean').length; data.dropped = data.questions.filter((x) => x.disposition !== 'clean').length }
writeFileSync(P, JSON.stringify(data, null, 2) + '\n')
console.log(`final merge (${source}): drop ${stat.drop} · факт-реджект ${stat.factReject} · исправлен ${stat.fixed} · изменено ${stat.changed} · откат ${stat.reverted} · без изм. ${stat.untouched}`)
if (source === 'old') { const c = (s) => data.questions.filter((q) => q.reviewStatus === s).length; console.log(`reviewStatus: approved ${c('approved')} · pending ${c('pending')} · rejected ${c('rejected')}`) }
else console.log(`clean ${data.clean} / dropped ${data.dropped}`)
