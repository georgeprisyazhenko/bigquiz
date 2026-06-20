// Узкий догон-фактчек (после prep-factcheck-risky.mjs): веб-проверяем ТОЛЬКО
// предотобранные рисковые вопросы. Без LLM-флага. Один агент на категорию читает свой
// файл и веб-проверяет все его вопросы. Вердикты возвращаются INLINE (без стадии записи -
// чтобы не упереться в лимит на save, как в прошлый раз). Дальше merge-factcheck.mjs.
// Запуск: Workflow({ scriptPath: "scripts/recheck-facts-risky.workflow.js" })

export const meta = {
  name: 'recheck-facts-risky',
  description: 'Узкий веб-фактчек только рисковых вопросов (миф-паттерны), вердикты inline',
  phases: [{ title: 'Check', detail: 'Sonnet medium + веб: по категории' }]
}

const CHECK_SCHEMA = {
  type: 'object', required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'factVerdict', 'explanation'],
        properties: {
          id: { type: 'string' },
          factVerdict: { type: 'string', enum: ['true', 'myth', 'wrong', 'unverifiable'] },
          explanation: { type: 'string' },
          correctedAnswer: { type: 'string' }
        }
      }
    }
  }
}

const checkPrompt = (file) => `Прочитай файл ${file} - массив вопросов викторины (id, question, answers[4], correctAnswerIndex, correctAnswer). Проверь ФАКТ КАЖДОГО по интернету: загрузи инструменты ToolSearch "select:WebSearch,WebFetch", делай 1-2 запроса на вопрос.

Для каждого верни id (ДОСЛОВНО из файла), factVerdict:
- 'true' - факт и верный ответ подтверждаются;
- 'myth' - красивая премиса/история - подтверждённая байка/развенчано (даже если ответ формально верен);
- 'wrong' - заявленный верный ответ фактически неверен;
- 'unverifiable' - надёжно не подтверждается и не опровергается.
explanation - 1-2 фразы со ссылкой на источник. Если ответ неверен, но спасаем вариантом из списка - correctedAnswer. Верни вердикты по ВСЕМ вопросам файла.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/factcheck-in/*.json` и верни массив путей. Пусто - пустой массив.', { label: 'list', phase: 'Check', model: 'haiku', schema: S })
  return (r && r.files) || []
}

phase('Check')
const files = args && Array.isArray(args.files) ? args.files : await listInputs()
const perCat = await parallel(
  files.map((file) => () =>
    agent(checkPrompt(file), { label: `check:${file.split('/').pop()}`, phase: 'Check', model: 'sonnet', effort: 'medium', schema: CHECK_SCHEMA })
      .then((r) => ({ slug: file.split('/').pop().replace(/\.json$/, ''), verdicts: (r && r.verdicts) || [] }))
  )
)

const all = perCat.filter(Boolean).flatMap((c) => c.verdicts)
const m = (v) => all.filter((x) => x.factVerdict === v).length
return { checked: all.length, myth: m('myth'), wrong: m('wrong'), unverifiable: m('unverifiable'), tru: m('true'), verdicts: all }
