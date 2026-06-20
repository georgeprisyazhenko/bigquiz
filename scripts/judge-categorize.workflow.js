// Совмещённый дешёвый проход (Sonnet medium, БЕЗ веба) по clean-вопросам:
//   (а) дроп по классам брака из аудита пользователя;
//   (б) присвоение НАШЕЙ категории (id из public/categories.json / docs/categories.md);
//   (в) флаг fits=false, если вопрос не вписывается ни в одну нашу категорию.
// Вход scripts/judgecat-in/*.json. Дальше scripts/merge-judge-cat.mjs.
// Запуск: Workflow({ scriptPath: "scripts/judge-categorize.workflow.js" })

export const meta = {
  name: 'judge-categorize',
  description: 'Дроп по классам брака + присвоение нашей категории + подсчёт не вписавшихся (Sonnet, без веба)',
  phases: [
    { title: 'Judge+Cat', detail: 'Sonnet medium: дроп-классы + наши категории' },
    { title: 'Save', detail: 'Haiku: scripts/judgecat-out/<slug>.json' }
  ]
}

const SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'drop', 'dropReason', 'categoryIds', 'fits'],
        properties: {
          id: { type: 'string' },
          drop: { type: 'boolean' },
          dropReason: { type: 'string', enum: ['', 'street-niche', 'banal-school', 'multiple-correct', 'absurd-distractors', 'comparison', 'scandal-living', 'social-source', 'ultra-niche', 'other'] },
          categoryIds: { type: 'array', minItems: 0, maxItems: 3, items: { type: 'string' } }, // id из НАШЕГО дерева
          fits: { type: 'boolean' } // false, если не вписывается ни в одну нашу категорию
        }
      }
    }
  }
}

const prompt = (file) => `Прочитай НАШЕ дерево категорий docs/categories.md (там id и названия 23 категорий / 124 подкатегорий) и файл ${file} - массив clean-вопросов (id, question, answers[4], correctAnswerIndex). Для КАЖДОГО реши две вещи.

1) ДРОП по классам брака (drop=true + dropReason), если вопрос подпадает:
- street-niche: ответ - конкретная улица / микротопонимика (особ. зарубежная) - ultra-niche.
- banal-school: школьная программа в лоб, знают почти все (соляная кислота в желудке, сколько клеток на доске) - выше sweet spot.
- multiple-correct: хотя бы один дистрактор ТОЖЕ верен под формулировку (часто в «один из…», «есть ли…»; пример - музей напитка в большом городе, где есть музеи и других напитков). РОВНО ОДИН верный нарушен.
- absurd-distractors: дистракторы абсурдны/анахроничны (современная функция у средневекового предмета; приливы без моря) - отсекаются мгновенно.
- comparison: чтобы ответить, надо знать значения у всех 4 и сравнить (не узнавание).
- scandal-living: скандал/насмешка над конкретным живым человеком.
- social-source: факт держится только на соцсетях/форуме (ненадёжно).
- ultra-niche: ответят <30% даже образованных, тема не из обычной жизни.
Если ничего из этого - drop=false, dropReason="".

2) КАТЕГОРИЯ из НАШЕГО дерева: categoryIds - 1-3 id подкатегорий (или id верхней категории, если точной подкат нет), СТРОГО существующих в categories.md. Если вопрос НЕ вписывается ни в одну нашу категорию (нет подходящей темы) - categoryIds=[] и fits=false. Иначе fits=true.

Echo id обязательно. Верни строго по схеме все вопросы файла.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/judgecat-in/*.json` и верни массив путей. Пусто - пустой массив.', { label: 'list', phase: 'Judge+Cat', model: 'haiku', schema: S })
  return (r && r.files) || []
}

phase('Judge+Cat')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),
  (file) => agent(prompt(file), { label: `jc:${file.split('/').pop()}`, phase: 'Judge+Cat', model: 'sonnet', effort: 'medium', schema: SCHEMA })
    .then((r) => ({ slug: file.split('/').pop().replace(/\.json$/, ''), items: (r && r.items) || [] })),
  async (rep) => {
    if (!rep || !rep.items.length) return null
    await agent(
      `Создай scripts/judgecat-out/${rep.slug}.json (и папку, если нет) и запиши ДОСЛОВНО этот JSON. После записи ответь только "ok".\n\n${JSON.stringify(rep)}`,
      { label: `save:${rep.slug}`, phase: 'Save', model: 'haiku' }
    )
    return { slug: rep.slug, total: rep.items.length, dropped: rep.items.filter((x) => x.drop).length, unfit: rep.items.filter((x) => !x.fits).length }
  }
)

const clean = results.filter(Boolean)
return {
  categories: clean.length,
  total: clean.reduce((a, r) => a + r.total, 0),
  dropped: clean.reduce((a, r) => a + r.dropped, 0),
  unfit: clean.reduce((a, r) => a + r.unfit, 0)
}
