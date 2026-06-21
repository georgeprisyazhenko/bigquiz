// CLI: удалить все «На выброс» (discard) из пула ревью.
// То же, что кнопка «Удалить дропы» в админке. Дропы уже записаны в журнал
// (как негативные примеры) в момент пометки, здесь только физическое удаление.
//   node scripts/delete-drops.mjs
import { deleteDrops } from './lib/review-store.mjs'

const r = deleteDrops()
console.log(`Удалено дропов из пула: ${r.removed}`)
if (r.removed) console.log('Бэкап пула создан рядом (data/review-pool.backup-*.json).')
