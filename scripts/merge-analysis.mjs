// Применяет результат анализатора (scripts/analysis-out/result.json):
//   1. АДДИТИВНО дописывает ❌→✅ примеры в docs/quality-examples.md (безопасно).
//   2. Кладёт предложения правок правил в docs/rubric-proposals/<stamp>.md —
//      НЕ трогает docs/category-risks.md (финальное слово за человеком).
//   3. Двигает водяной знак lastAnalyzed (до until из batch.json) — чтобы следующий
//      прогон брал только новые записи журнала.
//
//   node scripts/merge-analysis.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeWatermark, readWatermark } from './lib/review-store.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RESULT = path.join(ROOT, 'scripts', 'analysis-out', 'result.json')
const BATCH = path.join(ROOT, 'scripts', 'analysis-in', 'batch.json')
const EXAMPLES = path.join(ROOT, 'docs', 'quality-examples.md')
const PROPOSALS_DIR = path.join(ROOT, 'docs', 'rubric-proposals')

if (!fs.existsSync(RESULT)) { console.error('Нет scripts/analysis-out/result.json — сначала прогони воркфлоу analyze-reviews.'); process.exit(1) }
const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'))
const stamp = new Date().toISOString().slice(0, 10)

// 1. Примеры → docs/quality-examples.md (в конец, отдельной датированной секцией).
const examples = result.examples || []
if (examples.length) {
  const lines = ['', `## Из ревью ${stamp}`, '']
  for (const ex of examples) {
    lines.push(`### ${ex.klass || 'разное'}`, '')
    lines.push('❌ Было:', '```')
    lines.push(`Q: ${ex.bad.question}`)
    lines.push(`A: ${(ex.bad.answers || []).join(' | ')}`)
    lines.push('```')
    if (ex.good && ex.good.question) {
      lines.push('✅ Стало:', '```')
      lines.push(`Q: ${ex.good.question}`)
      lines.push(`A: ${(ex.good.answers || []).join(' | ')}`)
      lines.push('```')
    }
    if (ex.why) lines.push(`Почему: ${ex.why}`)
    lines.push('')
  }
  fs.appendFileSync(EXAMPLES, lines.join('\n') + '\n', 'utf8')
}

// 2. Предложения правок → docs/rubric-proposals/<stamp>.md (на ручную проверку).
const proposals = result.proposals || []
if (proposals.length) {
  if (!fs.existsSync(PROPOSALS_DIR)) fs.mkdirSync(PROPOSALS_DIR, { recursive: true })
  const out = [`# Предложения правок свода правил — ${stamp}`, '',
    'Сгенерировано анализатором ревью. НЕ применено автоматически — реши сам и внеси в',
    '`docs/category-risks.md` руками, если согласен.', '']
  if (result.summary) out.push(`> ${result.summary}`, '')
  for (const p of proposals) {
    out.push(`## ${p.rule} (на основе ${p.evidenceCount} случаев)`, '')
    out.push(`**Что повторяется:** ${p.observation}`, '')
    out.push(`**Предлагаемая правка:** ${p.proposedChange}`, '')
  }
  const file = path.join(PROPOSALS_DIR, `${stamp}.md`)
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8')
  console.log(`Предложения правок: docs/rubric-proposals/${stamp}.md (${proposals.length}) — проверь и применяй вручную.`)
}

// 3. Сдвинуть водяной знак до конца обработанной пачки.
let until = null
if (fs.existsSync(BATCH)) { try { until = JSON.parse(fs.readFileSync(BATCH, 'utf8')).until } catch {} }
if (until) {
  const wm = readWatermark()
  writeWatermark({ ...wm, lastAnalyzed: until })
}

console.log(`Примеров добавлено в docs/quality-examples.md: ${examples.length}`)
console.log(`Водяной знак lastAnalyzed → ${until || '(не сдвинут — нет batch.json)'}`)
