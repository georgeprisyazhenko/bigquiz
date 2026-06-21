// CLI: перенести все «Хорошо» (approved) из пула ревью в прод (public/questions.json).
// То же, что кнопка «В прод» в админке, но из терминала.
//   node scripts/promote-to-prod.mjs && npm test
import { promoteToProd } from './lib/review-store.mjs'

const r = promoteToProd()
console.log(`Перенесено в прод: ${r.moved}`)
if (r.movedIds && r.movedIds.length) console.log(`  id: ${r.movedIds.join(', ')}`)
if (r.blocked && r.blocked.length) {
  console.log(`Заблокировано код-гейтом (осталось в пуле): ${r.blocked.length}`)
  console.log(`  id: ${r.blocked.map((b) => b.id).join(', ')}`)
}
console.log(`Осталось в пуле: ${r.remaining}`)
console.log('Прогони npm test (гейт длины — по проду).')
