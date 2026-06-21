// Анализатор ревью: на основе журнала действий (data/review-log.jsonl, отобранного
// prep-analysis.mjs в scripts/analysis-in/batch.json) распознаёт тренды в моих
// правках/дропах и:
//   1. формирует конкретные ❌→✅ примеры для docs/quality-examples.md (аддитивно);
//   2. ПРЕДЛАГАЕТ точечные правки правил docs/category-risks.md — НЕ применяет сам
//      (финальное слово за человеком; merge-analysis кладёт их в docs/rubric-proposals/).
//
// Запуск: Workflow({ scriptPath: "scripts/analyze-reviews.workflow.js" })
// Дальше: node scripts/merge-analysis.mjs

export const meta = {
  name: 'analyze-reviews',
  description: 'Анализ ревью: тренды правок/дропов → примеры (аддитивно) + предложения правок правил',
  phases: [
    { title: 'Analyze', detail: 'кластеризует журнал, формирует примеры и предложения' },
    { title: 'Save', detail: 'Haiku: scripts/analysis-out/result.json' }
  ]
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['examples', 'proposals', 'summary'],
  properties: {
    examples: {
      type: 'array',
      items: {
        type: 'object',
        required: ['klass', 'bad', 'why'],
        properties: {
          klass: { type: 'string' }, // класс ошибки (дистракторы/угол/протечка/формулировка/ярлык/миф/…)
          bad: {
            type: 'object', required: ['question', 'answers'],
            properties: { question: { type: 'string' }, answers: { type: 'array', items: { type: 'string' } }, correctAnswerIndex: { type: 'integer' } }
          },
          good: {
            type: 'object',
            properties: { question: { type: 'string' }, answers: { type: 'array', items: { type: 'string' } }, correctAnswerIndex: { type: 'integer' } }
          },
          why: { type: 'string' }
        }
      }
    },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rule', 'observation', 'proposedChange', 'evidenceCount'],
        properties: {
          rule: { type: 'string' },          // какой пункт свода (A.3/A.5/A.9/…) или «новый»
          observation: { type: 'string' },    // что повторяется в моих правках/дропах
          proposedChange: { type: 'string' }, // предлагаемая формулировка/дополнение
          evidenceCount: { type: 'integer' }  // на скольких случаях основано
        }
      }
    },
    summary: { type: 'string' }
  }
}

const analyzePrompt = () => `Ты аналитик качества вопросов BigQuiz. Тебе дан журнал последних
действий ревьюера-человека: что он отправил на доработку, что переписал руками, что выбросил,
с указанием прежнего текста (before), нового текста (after) и причины (reason/проблема/теги).

Прочитай:
- scripts/analysis-in/batch.json — пачка записей журнала (поле entries).
- docs/category-risks.md — текущий свод правил генерации (A.0–A.10 + риски по подкатегориям).
- docs/quality-examples.md — уже накопленные примеры «как НЕ надо / как надо».

Задача — найти ПОВТОРЯЮЩИЕСЯ проблемы (тренды), а не разовые мелочи. Затем:

1) examples: для самых показательных случаев собери ❌→✅ пары.
   - bad = прежний текст (из before). good = новый текст (из after), если правка была;
     для дропов good можно опустить (пример только «как НЕ надо»).
   - klass — класс ошибки (дистракторы / угол-ярлык / протечка / формулировка / миф / язык / …).
   - why — одной фразой, что именно было не так и почему правка лучше.
   - НЕ дублируй примеры, которые уже есть в docs/quality-examples.md.

2) proposals: где тренд показывает, что ПРАВИЛО недостаточно жёсткое/ясное — предложи точечную
   правку соответствующего пункта свода (A.x) или новый пункт. Это ПРЕДЛОЖЕНИЕ, не приказ:
   дай rule (какой пункт), observation (что повторяется), proposedChange (как ужесточить/дополнить
   формулировку), evidenceCount (на скольких случаях основано). Только если случаев реально несколько.

Будь строг: если тренда нет — верни пустые массивы. Лучше 2 точных примера, чем 10 случайных.
Строго по схеме.`

phase('Analyze')
const result = await agent(analyzePrompt(), { label: 'analyze', phase: 'Analyze', model: 'sonnet', effort: 'high', schema: ANALYSIS_SCHEMA })

if (!result || (!(result.examples || []).length && !(result.proposals || []).length)) {
  log('Трендов не найдено — примеров и предложений нет.')
  return { examples: 0, proposals: 0, summary: (result && result.summary) || 'пусто' }
}

phase('Save')
await agent(
  `Создай файл scripts/analysis-out/result.json (и папку scripts/analysis-out, если её нет) и запиши ДОСЛОВНО этот JSON целиком, ничего не меняя. После записи ответь только словом ok.\n\n${JSON.stringify(result)}`,
  { label: 'save', phase: 'Save', model: 'haiku' }
)

return { examples: (result.examples || []).length, proposals: (result.proposals || []).length, summary: result.summary }
