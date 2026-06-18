# Runbook: полный аудит вопросов под текущий свод правил

Инструкция для **новой сессии Claude Code**. Цель — проверить КАЖДЫЙ вопрос в `public/questions.json` под полный текущий свод правил и исправить провалившиеся. Это ловит то, что прошло старого, более мягкого судью или вообще не пересматривалось (критерии за время работы выросли).

## Зачем

Жёсткие правила (длина ответа, отсутствие тире) уже гарантированы по всему файлу через `npm test`. А семантические — «ровно один верный», «зачем/почему», банальность, мифы A.9, логика дистракторов — проверялись только у вопросов, прошедших судью/редактор. Многие одобренные вопросы под финальный свод НЕ пересматривались. Этот аудит закрывает дыру.

## Контекст (прочитать перед стартом)

| Файл | Что |
|---|---|
| **`docs/category-risks.md`** | полный свод правил (A.2 банальность, A.3 «факт, не ярлык», A.5 ответы/дистракторы, A.8 язык, A.9 мифы) |
| `src/content-rules.js` | кодовые лимиты (длина, тире) — проверяются `npm test` |
| `public/questions.json` | вопросы (НЕ пересоздавать; только патч на месте) |
| `scripts/audit-questions.workflow.js` | воркфлоу: аудит → правка провалов → проверка |
| `scripts/merge-audit.mjs` | слияние: патч исправленных, перевод в `pending`, бэкап |

## Параметры

- **Аудитор** — Opus (наследует дефолт; НЕ задавать model), судит под все критерии.
- **Правка провалов** — Sonnet. **Перепроверка** — Opus `effort: 'low'`.
- Исправленные вопросы уходят в **`reviewStatus: 'pending'`** — на твоё повторное ревью. Прошедшие аудит не трогаются.
- Гнать **пакетами ~30-40 id** (Opus по всем 268 — дорого и долго; пакеты проще ревьюить и пережить сбой).

## Процедура

### Шаг 1. Подготовь данные аудита (один раз)

```bash
mkdir -p scripts/audit-in && find scripts/audit-in -name '*.json' -delete
node -e '
const fs=require("fs");
const q=JSON.parse(fs.readFileSync("public/questions.json","utf8")).questions;
for(const x of q){
  const it={id:x.id,status:x.reviewStatus||"pending",question:x.question,answers:x.answers,correctAnswerIndex:x.correctAnswerIndex,explanation:x.explanation};
  fs.writeFileSync("scripts/audit-in/"+x.id+".json",JSON.stringify(it,null,2)+"\n");
}
console.log("audit-in готов:",q.length,"вопросов");
'
```

### Шаг 2. Возьми пакет id и прогони воркфлоу

Список всех id (режь на пакеты ~30-40):
```bash
node -e 'console.log(JSON.stringify(require("./public/questions.json").questions.map(q=>q.id)))'
```

Вызови **Workflow** на пакет:
```
Workflow({ scriptPath: "scripts/audit-questions.workflow.js", args: { ids: ["q_001","q_002", ... ~35 штук ] } })
```
Воркфлоу пишет `scripts/audit-out/<id>.json` и возвращает сводку (passed / failed / fixed / removeSuggested / verifyFailed).

### Шаг 3. Слей исправленные

```bash
node scripts/merge-audit.mjs
```
Бэкап + патч исправленных (с авто-зачисткой тире) + перевод их в `pending` + отчёт `docs/audit-report.md`. Прошедшие аудит остаются как были.

### Шаг 4. Проверь и двигайся дальше

```bash
npm test                       # длина/тире зелёные
rm -f scripts/audit-out/*.json # очистка перед следующим пакетом
```
Открой `/admin.html` и пересмотри новые `pending` (исправленные аудитом). Повтори Шаги 2-4 для следующего пакета, пока не пройдут все id.

## Гардрейлы

- **Только патч на месте** (`merge-audit.mjs` не пересоздаёт файл) + бэкап `public/questions.backup-*.json` каждый раз.
- Исправленные → `pending`: ты их ПЕРЕсматриваешь, аудит не «одобряет» молча.
- `removeSuggested` срабатывает только на реально неспасаемых (миф/нет верного ответа) — смотри отчёт.
- После каждого пакета — `npm test` зелёный и `rm scripts/audit-out/*.json`.

## Готовый промпт для нового терминала

> Прочитай `docs/audit-runbook.md` и выполни полный аудит вопросов по нему. Сделай Шаг 1 (подготовка `audit-in`), затем гони пакетами по ~35 id: воркфлоу `scripts/audit-questions.workflow.js` → `node scripts/merge-audit.mjs` → `npm test`, очищая `scripts/audit-out` между пакетами. Показывай сводку после каждого пакета и останавливайся для моего ревью новых `pending`. Перед стартом сверься с `docs/category-risks.md`.
