// Пере-судейство pending-вопросов пула обновлённым судьёй.
// Вход: scripts/rejudge-in/<subId>.json (см. prep-rejudge.mjs).
// Запуск: Workflow({ scriptPath: "scripts/re-judge.workflow.js" })
// Дальше: сохрани возврат воркфлоу в scripts/rejudge-out.json → node scripts/merge-rejudge.mjs.
//
// Судья несёт ПОЛНЫЙ актуальный свод флагов (вау-в-ответ, около-спам, вложенные диапазоны,
// numeric-tell, редкий термин, бинарность, дискриминатор, англо-фразы) — синхронизирован с
// judgePrompt в fill-questions.workflow.js и docs/category-risks.md. См. docs/rules-map.md.

export const meta = {
  name: 're-judge',
  description: 'Пере-судейство pending-вопросов пула обновлённым судьёй (keep/revise/drop)',
  phases: [
    { title: 'List', detail: 'haiku: ls rejudge-in' },
    { title: 'Judge', detail: 'судья по подкатегориям, батчами' }
  ]
}

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['verdicts', 'summary'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'verdict', 'reason', 'prohibitedYG', 'factuallyCorrect', 'inSweetSpot', 'factOverLabel', 'naturalLanguage', 'cleanDistractors'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['keep', 'revise', 'drop'] },
          reason: { type: 'string' },
          prohibitedYG: { type: 'boolean' },
          factuallyCorrect: { type: 'boolean' },
          inSweetSpot: { type: 'boolean' },
          factOverLabel: { type: 'boolean' },
          naturalLanguage: { type: 'boolean' },
          cleanDistractors: { type: 'boolean' }
        }
      }
    },
    summary: { type: 'string' }
  }
}

const judgePrompt = (file) => `Ты строгий судья-фактчекер вопросов викторины для ВЗРОСЛЫХ. Прочитай файл ${file} — объект {subId, subName, cat, questions:[{id, question, answers[4], correctAnswerIndex, explanation}]}. Для субкатегорийных рисков можешь свериться с docs/category-risks.md (Часть C), но ОСНОВНЫЕ правила ниже. Оцени КАЖДЫЙ вопрос.

Для каждого верни: id (из файла), verdict (keep|revise|drop), reason (кратко по-русски), и флаги:
- prohibitedYG: ГЛАВНЫЙ ГЕЙТ (ЯИ 3.4). true если тема под баном: эзотерика/гадания/предсказания-практика, ДЕЙСТВУЮЩАЯ религия (вероучение/обряды), ТЕКУЩАЯ/острая политика (живые политики, выборы, конфликты), жестокость/смерти к детям и животным. НЕ бан: античная/скандинавская мифология как культура, древняя история как факт. true → verdict ОБЯЗАТЕЛЬНО drop.
- factuallyCorrect: факт верен и НЕ миф/байка. При сомнении → false.
- inSweetSpot: ответят ~45-75% образованных взрослых (не банальщина, не ультраниша <30%).
- factOverLabel: ответ — интересный факт/механизм, а НЕ зубримый ярлык. Удивительный «ого»-факт должен быть В ОТВЕТЕ: если он уже в премисе, а ответ — забываемый ярлык/«объясни причину как на экзамене» → false. Если вопрос НАЗЫВАЕТ сущность, чья идентичность и есть вау (назвал корабль «Навуходоносор» → «вавилонский царь» тривиален) → тоже false.
- naturalLanguage: живой разговорный русский, без жаргона/англо-аббревиатур/канцелярита/ударений. Сюда же: «около/примерно» НЕ в каждом варианте; перечисление через «и», не запятую; редкий термин в вопросе пояснён; ВАРИАНТЫ по-русски (без англо-фраз вроде «Patch Tuesday»; бренды/имена можно).
- cleanDistractors: 4 варианта одной области, правдоподобны В КОНТЕКСТЕ (не «песчинки в еде»), без чужого, без протечки, не синонимы. Числовые диапазоны НЕ вложены (не два «более N» в одну сторону). Верный НЕ единственное не-круглое число среди круглых. Величины в одной единице. НЕ бинарный выбор «X или Y». Варианты НЕ содержат подсказку-дискриминатор (века/размеры в скобках → выбор логикой).

verdict=keep ТОЛЬКО если все флаги true. drop если factuallyCorrect=false ИЛИ prohibitedYG ИЛИ неисправимый ярлык. revise — годная идея с правимым изъяном.
summary: 1-2 предложения по подкатегории.`

phase('List')
const LS = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
const lst = await agent('Выполни `ls scripts/rejudge-in/*.json` и верни массив путей.', { label: 'list', phase: 'List', model: 'haiku', schema: LS })
const files = (lst && lst.files) || []
log(`пере-судейство: ${files.length} файлов-подкатегорий`)

phase('Judge')
const results = await parallel(files.map((f) => () =>
  agent(judgePrompt(f), { label: `judge:${f.split('/').pop().replace(/\.json$/, '')}`, phase: 'Judge', effort: 'low', schema: JUDGE_SCHEMA })
    .then((r) => (r && r.verdicts) || [])
    .catch(() => [])
))

const out = results.flat()
const n = (vd) => out.filter((v) => v.verdict === vd).length
log(`готово: ${out.length} вердиктов — keep=${n('keep')} revise=${n('revise')} drop=${n('drop')}`)
return out
