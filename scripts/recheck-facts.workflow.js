// Догон-фактчек: по clean-вопросам без вердикта (scripts/factcheck-in/*.json)
// СТРОГО переотбираем сомнительные, затем веб-проверяем ТОЛЬКО их.
// Пайплайн на категорию:
//   1. Flag  — Sonnet medium (без веба): читает файл, строгий factDoubt; для отмеченных
//              эхо-возвращает question + correctAnswer (чтобы стадии веба не читать файл).
//   2. Check — Sonnet medium + веб: верифицировать отобранные (параллельно).
//   3. Save  — Haiku: scripts/factcheck-out/<slug>.json (резюмируемо).
// Дальше scripts/merge-factcheck.mjs впечатывает вердикты в public/guestion-clean.json.
// Запуск: Workflow({ scriptPath: "scripts/recheck-facts.workflow.js" })

export const meta = {
  name: 'recheck-facts',
  description: 'Догон-фактчек: строгий переотбор сомнительных → веб только по нужным → запись вердиктов',
  phases: [
    { title: 'Flag', detail: 'Sonnet medium: строгий factDoubt' },
    { title: 'Check', detail: 'Sonnet medium + веб: только отобранные' },
    { title: 'Save', detail: 'Haiku: scripts/factcheck-out/<slug>.json' }
  ]
}

const FLAG_SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'needsCheck', 'question', 'correctAnswer'],
        properties: {
          id: { type: 'string' },
          needsCheck: { type: 'boolean' },
          question: { type: 'string' },     // эхо из файла (чтобы веб-стадии не читать файл)
          correctAnswer: { type: 'string' } // эхо верного ответа
        }
      }
    }
  }
}
const CHECK_SCHEMA = {
  type: 'object', required: ['id', 'factVerdict', 'explanation'],
  properties: {
    id: { type: 'string' },
    factVerdict: { type: 'string', enum: ['true', 'myth', 'wrong', 'unverifiable'] },
    explanation: { type: 'string' },
    correctedAnswer: { type: 'string' }
  }
}

const flagPrompt = (file) => `Прочитай файл ${file} - массив вопросов викторины (id, question, answers[4], correctAnswerIndex, correctAnswer). Это уже отобранные «годные» вопросы; их факты ещё НЕ проверялись по источникам.

Реши для КАЖДОГО, нужна ли веб-проверка факта. ПОРОГ СТРОГИЙ - needsCheck=true при любом признаке:
- «первый/первым», «изобрёл», «придумал», «самый …» (приоритет/суперлатив);
- конкретная атрибуция цитаты человеку;
- история происхождения бренда/слова/вещи («назван в честь», «изначально был…»);
- удивительный/контринтуитивный факт, который легко оказывается байкой;
- точная дата/число/статистика как суть ответа;
- нишевый специфический факт, в котором ты не уверен на 100%.
needsCheck=false ТОЛЬКО для твёрдого общеизвестного факта (напр. «столица Франции - Париж»). При любом сомнении - true.

Для КАЖДОГО вопроса верни: id, needsCheck, и ЭХО полей question и correctAnswer ДОСЛОВНО из файла (не меняя ни символа). Все вопросы из файла.`

const checkPrompt = (q) => `Проверь ФАКТ вопроса викторины по интернету. Загрузи инструменты: ToolSearch "select:WebSearch,WebFetch", сделай 1-2 запроса.

id: ${q.id} (верни РОВНО этот id)
Вопрос: ${q.question}
Заявленный верный ответ: ${q.correctAnswer}

Верни id (точно как выше), factVerdict: 'true' (факт и ответ верны), 'myth' (подтверждённая байка/развенчано даже при формально верном ответе), 'wrong' (ответ фактически неверен), 'unverifiable' (надёжно не подтверждается и не опровергается). explanation - 1-2 фразы со ссылкой на источник. Если ответ неверен, но спасаем - correctedAnswer.`

async function listInputs() {
  const S = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
  const r = await agent('Выполни `ls scripts/factcheck-in/*.json` и верни массив путей. Пусто - пустой массив.', { label: 'list', phase: 'Flag', model: 'haiku', schema: S })
  return (r && r.files) || []
}

phase('Flag')
const results = await pipeline(
  args && Array.isArray(args.files) ? args.files : await listInputs(),

  // 1. Строгий флаг (без веба), с эхо question/correctAnswer
  (file) => agent(flagPrompt(file), { label: `flag:${file.split('/').pop()}`, phase: 'Flag', model: 'sonnet', effort: 'medium', schema: FLAG_SCHEMA })
    .then((r) => ({ file, slug: file.split('/').pop().replace(/\.json$/, ''), flags: (r && r.items) || [] })),

  // 2. Веб-проверка только отмеченных
  async (rep) => {
    if (!rep) return null
    const toCheck = rep.flags.filter((f) => f.needsCheck && f.question && f.correctAnswer)
    const verdicts = await parallel(toCheck.map((q) => () => agent(checkPrompt(q), { label: `check:${q.id}`, phase: 'Check', model: 'sonnet', effort: 'medium', schema: CHECK_SCHEMA })))
    return { slug: rep.slug, checked: verdicts.filter(Boolean), flaggedCount: toCheck.length, total: rep.flags.length }
  },

  // 3. Запись вердиктов
  async (rep) => {
    if (!rep) return null
    await agent(
      `Создай scripts/factcheck-out/${rep.slug}.json (и папку, если нет) и запиши ДОСЛОВНО этот JSON. После записи ответь только "ok".\n\n${JSON.stringify({ slug: rep.slug, verdicts: rep.checked })}`,
      { label: `save:${rep.slug}`, phase: 'Save', model: 'haiku' }
    )
    const m = (v) => rep.checked.filter((x) => x.factVerdict === v).length
    return { slug: rep.slug, total: rep.total, flagged: rep.flaggedCount, checked: rep.checked.length, myth: m('myth'), wrong: m('wrong'), unverifiable: m('unverifiable'), tru: m('true') }
  }
)

const clean = results.filter(Boolean)
return {
  categories: clean.length,
  total: clean.reduce((a, r) => a + r.total, 0),
  flagged: clean.reduce((a, r) => a + r.flagged, 0),
  checked: clean.reduce((a, r) => a + r.checked, 0),
  myth: clean.reduce((a, r) => a + r.myth, 0),
  wrong: clean.reduce((a, r) => a + r.wrong, 0),
  unverifiable: clean.reduce((a, r) => a + r.unverifiable, 0)
}
