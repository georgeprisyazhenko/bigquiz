// Применяет совмещённый проход (scripts/judgecat-out/*.json) к guestion-clean.json:
// дроп по классам (disposition='drop-<reason>'); присвоение НАШИХ категорий (валидируем
// id по public/categories.json); флаг fits. Считает дропы и «не вписавшихся».
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'scripts', 'judgecat-out')
const P = join(ROOT, 'public', 'guestion-clean.json')
if (!existsSync(DIR)) { console.error('Нет judgecat-out - сначала прогони воркфлоу.'); process.exit(1) }

// валидные id нашего дерева
const cats = JSON.parse(readFileSync(join(ROOT, 'public', 'categories.json'), 'utf8')).categories
const validIds = new Set()
for (const c of cats) { validIds.add(c.id); for (const s of c.subcategories || []) validIds.add(s.id) }

const byId = new Map()
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(join(DIR, f), 'utf8')).items || []) byId.set(it.id, it)
}

const d = JSON.parse(readFileSync(P, 'utf8'))
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
writeFileSync(join(ROOT, 'public', `guestion-clean.backup-${ts}.json`), JSON.stringify(d, null, 2) + '\n')

const dropByReason = {}
let dropped = 0, unfit = 0, assigned = 0
const unfitIds = []
for (const q of d.questions) {
  if (q.disposition !== 'clean') continue
  const r = byId.get(q.id)
  if (!r) continue
  if (r.drop) {
    const reason = r.dropReason || 'other'
    q.disposition = 'drop-' + reason
    dropByReason[reason] = (dropByReason[reason] || 0) + 1
    dropped++
    continue
  }
  // категории нашего дерева (только валидные id)
  const ids = (r.categoryIds || []).filter((x) => validIds.has(x))
  if (ids.length) { q.ourCategories = ids; assigned++ }
  if (!r.fits || !ids.length) { q.fitsTree = false; unfit++; unfitIds.push(q.id) }
  else q.fitsTree = true
}
d.clean = d.questions.filter((q) => q.disposition === 'clean').length
d.dropped = d.questions.filter((q) => q.disposition !== 'clean').length
writeFileSync(P, JSON.stringify(d, null, 2) + '\n')
console.log(`Дропнуто по классам: ${dropped} →`, JSON.stringify(dropByReason))
console.log(`Категории нашего дерева присвоены: ${assigned}`)
console.log(`НЕ вписалось в дерево (fitsTree=false): ${unfit}`)
console.log(`Итог: clean ${d.clean} / dropped ${d.dropped}`)
if (unfit) console.log('Не вписались (первые 30):', unfitIds.slice(0, 30).join(', '))
