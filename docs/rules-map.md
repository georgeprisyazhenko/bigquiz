# Карта связности правил (что обновлять вместе)

Проблема: одно правило живёт прозой в нескольких местах (промпты генератора/судьи,
свод, доки, тесты). Меняешь в одном — забываешь в другом → дрейф. Эта карта делает
протяжку механической: меняешь правило → проходишь ВСЕ зависимые точки по списку.

**Дисциплина:** любое изменение правил генерации/судейства/ревью или промптов —
сначала ПРЕДЛОЖЕНИЕ на аппрув, потом правка по ВСЕМ точкам ниже, потом `npm test`.
Не коммитить молча. (См. память `feedback_pipeline_changes`.)

---

## Лимит длины ответа

- **Каноничный код (источник истины):** `src/content-rules.js` — `MAX_ANSWER_WORDS`,
  `MAX_ANSWER_CHARS`, `MAX_WORD_CHARS`, `FUNCTION_WORDS`, `contentWords`, `validateAnswerText`.
- Зависимые точки (обновлять вместе):
  - `scripts/fill-questions.workflow.js` — genPrompt (лимит при генерации) + код-гейт длины при слиянии.
  - `scripts/merge-gen.mjs` — код-гейт: длинные генерации не пускать в пул чистым keep.
  - `scripts/polish.workflow.js` — правило 9 (доводка укорачивает).
  - `scripts/lib/review-store.mjs` — `gatesOk` (промоушн в прод).
  - `src/main.js` — `validateQuestions` (мягкое предупреждение в игре).
  - `src/admin/admin.js` — предупреждение в карточке ревью.
  - `tests/content-rules.test.js`, `tests/questions-answers.test.js` — гейты.
  - `docs/category-risks.md` (A.5 + свод), `docs/GDD_LITE.md` (§4).
- **Принцип:** длина детерминирована → проверяется КОДОМ (`validateAnswerText`), НЕ LLM.

## Запрещённые темы ЯИ (3.4)

- **Каноничный код:** `src/content-rules.js` — `PROHIBITED_TOPIC_RE`, `validateNoProhibited`.
- Зависимые: `src/main.js` (validateQuestions), `fill-questions`/`polish` (флаг prohibitedYG,
  правило), `docs/category-risks.md` (A.0). Часть на LLM-судье (политика/религия — регэкспом не отсечь).

## Тире (— / – → дефис)

- **Каноничный код:** `src/content-rules.js` — `FORBIDDEN_DASH_RE`, `validateNoDashes`, `stripDashes`.
- Зависимые: merge-скрипты (автозамена), `polish` (правило 6), `docs/category-risks.md` (A.8).

## Правила показа карточки (порядок ответов, картинка)

- **Каноничный код:** `src/card-rules.js` — `orderAnswers`, `imageCandidatePaths`.
- Зависимые: `src/main.js` (игра) и `src/admin/admin.js` (превью) импортируют ОДИН модуль —
  дрейфа нет by design. `docs/GDD_LITE.md` (§4).
- **Превью админки = игра ПО ОТОБРАЖЕНИЮ.** Что нельзя в превью (иначе расхождение с продом):
  - перенос текста — ТОЛЬКО по словам: `hyphens: none`, `overflow-wrap: normal`. НИКОГДА
    `hyphens: auto`/`break-word` (рвёт слово «Папой» → «Па-пой», игра так не делает);
  - шрифт НЕ ужимать (см. лимит длины — не влезает, значит переформулировать);
  - верный ответ на карточке НЕ подсвечен (как в исходном состоянии прода).
  - **Гард:** `tests/admin-preview.test.js` ловит регрессы по исходникам (hyphens:auto,
    ужатие шрифта, отвязку от `card-rules`). Новое правило показа → добавь туда ассерт.

## Свод правил вопроса (факт-не-ярлык, sweet spot, анти-миф и т.д.)

- **Каноничный текст:** `docs/category-risks.md` (A.0–A.10 + риски по подкатегориям).
- Зависимые: genPrompt/judgePrompt (`fill-questions`) ссылаются на него; `polish` RULES (9 классов)
  дублирует операционно; `docs/quality-examples.md` — примеры. Анализатор ПРЕДЛАГАЕТ правки
  сюда (`docs/rubric-proposals/`), применяет человек.
