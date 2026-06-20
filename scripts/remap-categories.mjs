// Чинит присвоенные категории: агент местами выдумал id вместо наших точных.
// Алиасы для частых ошибок + fuzzy-фоллбек по подстроке. Без LLM.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const cats = JSON.parse(readFileSync(join(ROOT, 'public', 'categories.json'), 'utf8')).categories
const valid = new Set()
for (const c of cats) { valid.add(c.id); for (const s of c.subcategories || []) valid.add(s.id) }

const ALIAS = {
  'kompanii-brendy': 'kompanii', brends: 'kompanii', 'proiskhozhdenie-slov': 'etimologiya',
  'olimpiyskie-igry': 'olimpiada', modeley: 'modelery', 'odezhda-obuv': 'odezhda',
  'vodnyy-mir': 'vodnye-obitateli', 'dragotsennosti-ukrasheniya': 'dragocennosti',
  'kosmetika-parfyumeriya': 'kosmetika', 'eda-deserty': 'eda', 'reklama-marketing': 'reklama',
  ptitsy: 'pticy', 'zvezdy-galaktiki': 'zvyozdy-galaktiki', videogry: 'videoigry',
  'samolety-aviatsiya': 'aviaciya', 'samolyoty-aviaciya': 'aviaciya'
}

const validArr = [...valid]
function resolve(id) {
  if (valid.has(id)) return id
  if (ALIAS[id] && valid.has(ALIAS[id])) return ALIAS[id]
  // fuzzy: общий длинный префикс/подстрока стема
  const stem = id.split('-')[0]
  const hit = validArr.find((v) => v === stem || v.startsWith(stem) || stem.startsWith(v.split('-')[0]))
  return hit || null
}

const out = new Map()
for (const f of readdirSync(join(ROOT, 'scripts', 'judgecat-out')).filter((x) => x.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(join(ROOT, 'scripts', 'judgecat-out', f), 'utf8')).items || []) out.set(it.id, it)
}

const P = join(ROOT, 'public', 'guestion-clean.json')
const d = JSON.parse(readFileSync(P, 'utf8'))
let remapped = 0, stillUnfit = 0
const unfitIds = []
for (const q of d.questions) {
  if (q.disposition !== 'clean') continue
  const r = out.get(q.id)
  if (!r || r.drop) continue
  const resolved = [...new Set((r.categoryIds || []).map(resolve).filter(Boolean))].slice(0, 3)
  if (resolved.length) {
    if (JSON.stringify(resolved) !== JSON.stringify(q.ourCategories || [])) remapped++
    q.ourCategories = resolved
    q.fitsTree = true
  } else {
    q.fitsTree = false
    stillUnfit++
    unfitIds.push(q.id)
  }
}
writeFileSync(P, JSON.stringify(d, null, 2) + '\n')
const assigned = d.questions.filter((q) => q.disposition === 'clean' && q.fitsTree).length
console.log(`Перемаплено категорий: ${remapped}`)
console.log(`Clean с нашей категорией: ${assigned} / ${d.questions.filter((q) => q.disposition === 'clean').length}`)
console.log(`Реально не вписалось (после ремапа): ${stillUnfit}`, unfitIds.length ? '→ ' + unfitIds.join(', ') : '')
