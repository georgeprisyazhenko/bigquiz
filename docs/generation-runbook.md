# Runbook: полное наполнение BigQuiz вопросами

Этот файл — самодостаточная инструкция для **новой сессии Claude Code** (без предыдущего контекста), чтобы прогнать генерацию вопросов нашим воркфлоу. Прочитай его целиком и выполняй по шагам.

## Что мы делаем

Наполняем базу неизбитыми вопросами для викторины (взрослая аудитория, Яндекс Игры, русский язык). Генерации льются в **ПУЛ ревью** (`data/review-pool.json`), а не в прод — в прод (`public/questions.json`, едет в игру) попадает только одобренное мной после ревью (см. `docs/review-runbook.md`). Подход выстрадан за серию пилотов; **не импровизируй с методом** — следуй артефактам ниже.

## Источники контекста (прочитай перед запуском)

| Файл | Что это |
|---|---|
| **`docs/category-risks.md`** | ГЛАВНОЕ — инструкция генерации. Принцип «факт, а не ярлык», sweet spot, форматы, анти-миф, риски по подкатегориям (Часть C). |
| `public/categories.json` | Дерево: 23 категории / 126 подкатегорий (источник истины по `id`). |
| `docs/categories.md` | Человекочитаемое дерево. |
| `public/questions.json` | ПРОД — только `approved` (едет в игру). НЕ писать сюда напрямую. |
| `data/review-pool.json` | ПУЛ ревью — сюда льются генерации как `pending`. НЕ перезаписывать целиком. |
| `scripts/fill-questions.workflow.js` | Воркфлоу: генерация→суд→запись. |
| `scripts/merge-gen.mjs` | Слияние результатов в ПУЛ (`data/review-pool.json`). |
| `docs/review-runbook.md` | Полный цикл ревью / доработки / обучения. |

## Параметры пайплайна (не менять без причины)

- **Генерация:** модель **Sonnet**, **7 вопросов на подкатегорию** (дефолт; был 15 — снижен, т.к. усиленный genPrompt поднял keep-rate, лишние кандидаты не нужны). `effort` генератора НЕ занижать — он защищает качество.
- **Судья:** модель **Opus** (наследует дефолт сессии — НЕ задавать model), `effort: 'low'` для скорости. Судит пачку за один вызов по schema с булевыми флагами (`factOverLabel` — главный; `needsFactcheck` — ортогональный, помечает спорные факты). Если в ревью пойдёт заметный рост брака — поднять судью до `effort: 'medium'`.
- **Веб-фактчек (стадия Factcheck):** помеченные судьёй `needsFactcheck` keep И revise проходят точечный веб-фактчек (`WebSearch/WebFetch`) ДО пула; `myth`/`wrong` → авто-drop. Закрывает дыру: иначе keep-вопросы по интернету не проверялись.
- **Запись:** Haiku пишет `scripts/gen-out/<subId>.json` (по файлу на подкат, резюмируемо).
- Из 15 в пул льём `keep` И `revise` (revise = годная идея с правимым изъяном, дотачивается на доработке). `drop` не сливаем. Все приходят как `pending` с `llmVerdict`.

## Процедура (пакетами по ~15–20 подкатегорий)

Гнать все 126 за раз можно, но **пакетами лучше**: дешевле проверять, легче резюмировать после сбоя, и ты успеваешь ревьюить в админке между партиями.

### Шаг 1. Построй список ещё не покрытых подкатегорий

```bash
node -e '
const fs=require("fs");
const prod=require("./public/questions.json").questions;
const pool=fs.existsSync("./data/review-pool.json")?require("./data/review-pool.json").questions:[];
const q=[...prod,...pool], cats=require("./public/categories.json").categories;
const cnt={}; for(const x of q)for(const c of (x.categories||[]))cnt[c]=(cnt[c]||0)+1;
const out=[];
for(const c of cats)for(const s of c.subcategories||[]){ const n=cnt[s.id]||0; if(n<10) out.push({id:s.id,name:s.name,cat:c.name,have:n}); }
console.log(JSON.stringify(out,null,2)); console.error("Подкат с <10 вопросов:",out.length);
'
```

Возьми из вывода первые ~15–20 объектов как партию (убери поле `have` — воркфлоу его не использует).

### Шаг 2. Запусти воркфлоу на партию

Вызови инструмент **Workflow** так (подставь свой массив подкатегорий в `args.subcats`):

```
Workflow({
  scriptPath: "scripts/fill-questions.workflow.js",
  args: { perSubcat: 15, subcats: [
    { id: "...", name: "...", cat: "..." },
    ... 15–20 штук ...
  ] }
})
```

Воркфлоу пишет результат каждой подкатегории в `scripts/gen-out/<id>.json` и возвращает компактные метрики (keep/revise/drop по подкат). Дождись завершения (придёт уведомление).

### Шаг 3. Слей в пул ревью

```bash
node scripts/merge-gen.mjs
```

Скрипт делает бэкап пула (`data/review-pool.backup-<timestamp>.json`, игнорится git), дописывает `keep`+`revise` как `pending` с `llmVerdict`/`llmReason`, выдаёт сквозные id (max по проду и пулу) и печатает диапазон новых id. В прод ничего не попадает до моего «Хорошо» + `node scripts/promote-to-prod.mjs`.

### Шаг 3.5. Авто-полиш `revise` ДО ревью (обязательно)

**Договорённость: ревью человека идёт ВСЕГДА после полиша** — сырые `revise` ему не
показываем (память `feedback-review-after-polish`). Судья только ставит диагноз
(`llmVerdict=revise` + `llmReason`), фиксы применяет `polish`. Поэтому сразу после
слияния прогоняем `revise` через полиш с диагнозом судьи как директивой:

```
node scripts/prep-polish-revise.mjs      # pending+revise из пула (без reworkedAt) → polish-in, директива = llmReason
Workflow scripts/polish.workflow.js      # fix-first доводка
node scripts/merge-polish.mjs && npm test # починенные → пул как pending («прошёл доработку»)
```
`keep` идут на ревью напрямую (чисты). `revise` после полиша возвращаются исправленными.
Откаты по гейту длины (`reviewStatus=rework`) — добей вторым проходом полиша.
⚠ `merge-polish` мутирует пул — страж `scripts/hooks/guard-pool-edits.mjs` заблокирует
его при живом `vite`; останови dev-сервер на время слияния.

### Шаг 4. Ревью и очистка

- Открой `/admin.html` (`npm run dev`, если сервер не поднят) и прокликай новые `pending`.
- Очисти папку перед следующей партией: `rm -f scripts/gen-out/*.json`
- Повтори Шаги 1–4, пока список из Шага 1 не опустеет.

## Гардрейлы

- **Только дописывание.** `merge-gen.mjs` не трогает существующие вопросы и твои отметки ревью. Никогда не пересоздавай questions.json с нуля.
- **Бэкап есть всегда** (делает merge). Если что-то пошло не так — откат из `public/questions.backup-*.json`.
- **id без коллизий:** merge продолжает нумерацию `q_NNN` от максимума.
- **Не занижай effort генератора.** Низкий effort — только у судьи.
- **Валидация:** после слияния `public/questions.json` должен грузиться игрой без ошибок `validateQuestions()` (схема в `src/main.js`).
- При правках `categories.json` — обновляй `docs/categories.md` (правило из CLAUDE.md). Для наполнения это не нужно — дерево не меняем.

## Готовый промпт для нового терминала

> Прочитай `docs/generation-runbook.md` и выполни наполнение вопросами по нему: начни с первой партии (~15 подкатегорий из Шага 1), прогони воркфлоу `scripts/fill-questions.workflow.js`, слей через `scripts/merge-gen.mjs` и покажи метрики. Перед стартом сверься с `docs/category-risks.md`. Дальше двигайся партиями, останавливаясь после каждого слияния для моего ревью.
