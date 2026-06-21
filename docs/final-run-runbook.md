# Runbook: ФИНАЛЬНЫЙ прогон вопросов (старые + guestion → единая база)

Инструкция для запуска, когда вернутся токены (возможно, в новой сессии). Цель — довести
**ВСЕ** вопросы (старые non-rejected + guestion 599 clean) до **полного** соответствия своду
(не «робко похоже», а реально), затем влить guestion в `public/questions.json` → единая
проверенная база.

## Стандарт качества (КЛЮЧЕВОЕ)
Каждый вопрос на выходе — ЛИБО уже идеален (не трогать), ЛИБО **доведён полностью**, ЛИБО
**дропнут**. «Подправлено, но всё ещё с изъяном» = ПРОВАЛ. Гарантия этого — отдельная
стадия строгой верификации (ниже).

## Свод принципов
Полный — `docs/category-risks.md` (A.0 комплаенс ЯИ, A.3 факт/угол/сюрприз-в-ответ, A.5, A.8).
Плюс 8 классов из аудита пользователя (выстраданы на ревью):
1. **Дистракторы.** Каждый правдоподобен и ОДНОЗНАЧНО неверен под формулировку; не синонимы, не off-topic, не «формально-тоже-верный» (q_002 «не ржавеет»); той же эпохи/домена, без анахронизмов/абсурда. **Если 4 чистых дистрактора не выходит → ДРОП**, а не притягивать (q_191).
2. **Угол — сюрприз в ОТВЕТ.** Если «ого»-факт в премисе, а ответ — забываемый ярлык → перевернуть (q_028/q_081/q_110). Не банал, не очевидное-из-вопроса.
3. **Протечка.** Ни ответ, ни его различающее слово не должны быть в вопросе — включая предлог («под»→«под землёй») и тавтологию имени (q_102/q_104/q_117).
4. **Формулировка.** Ясная, полная, одно предложение; без «странных» оборотов; «до скольких/во сколько» → «до какой/в котором» (q_001); **НИКОГДА не уточнять «вариантов 4 / правильный один»** (q_264).
5. **Сложность.** Не задротство/учебник/лекция (q_021/q_068/q_072); sweet spot ~45-75%; бытовой ярлык про обычные вещи — ок, школьная программа в лоб — дроп.
6. **Тире.** Вставочное/парное тире → **ЗАПЯТАЯ** (НЕ дефис): «текст — вставка —» = «текст, вставка,». Дефис только где он реально дефис. (q_105/q_139 — «10-й раз».)
7. **«Почему»-вопрос.** Ответ обязан объяснять ПРИЧИНУ (q_171/q_191); если 4 правдоподобных причинных варианта не выходит → дроп.
8. **Падеж/explanation.** Ответы в именительном; вопросительное слово согласовано с типом ответа и дистракторов; `explanation` сохранить и обновить под новый ответ (для guestion — СГЕНЕРИРОВАТЬ).

## Пайплайн (на обе базы)
1. **prep** — нарезка по категориям.
2. **Repair** (Sonnet medium) — по стандарту выше; для guestion ГЕНЕРИРОВАТЬ explanation.
3. **Proof** (Sonnet medium) — грамматика + тире→запятая.
4. **Strict-verify** (Sonnet medium) — ОТДЕЛЬНЫЙ агент перечитывает каждый kept-вопрос по всем принципам; остался изъян → `drop` или `refix`. Это и есть гарантия «не робко».
5. **Fact** (Sonnet medium + веб) — по сомнительным (factDoubt && угол>2), проверять ИМЕННО ключевой факт; соцсеть ≠ источник.
6. **Save → merge** (с код-гейтами: тире/длина/запрет; безопасный откат к оригиналу, если ремонт нарушил гейт — для старых).

## Команды (ЕДИНЫЙ флоу `final-pass.workflow.js` — всё готово, осталось запустить)
ВАЖНО: гнать по одной базе; `final-in`/`final-out` общие, между базами чистить.

**Guestion (599 clean):**
```
rm -rf scripts/final-in scripts/final-out
node scripts/prep-final.mjs --source guestion
# Workflow({ scriptPath: "scripts/final-pass.workflow.js" })
node scripts/merge-final.mjs --source guestion
```
**Старые (questions.json, 196 non-rejected):**
```
rm -rf scripts/final-in scripts/final-out
node scripts/prep-final.mjs --source old
# Workflow({ scriptPath: "scripts/final-pass.workflow.js" })
node scripts/merge-final.mjs --source old && npm test
```
**Финал — влить guestion в основную базу:**
```
node scripts/merge-guestion-into-main.mjs && npm test
```

## Готово к запуску (подготовлено, токены не тратились)
- `scripts/final-pass.workflow.js` — единый строгий флоу: Repair (стандарт + 8 классов + генерация explanation) → Proof (тире→ЗАПЯТАЯ) → **Strict-verify** (придирчивый ре-чек, изъян → drop) → Fact (веб) → Save. Синтаксис проверен.
- `scripts/prep-final.mjs --source old|guestion`, `scripts/merge-final.mjs --source old|guestion`, `scripts/merge-guestion-into-main.mjs` — готовы, проверены.
- merge безопасен: при нарушении гейта (длина/тире/запрет) откат к оригиналу → `npm test` не падает.
- (старые prep-old/process-old/merge-old и rerepair-* остаются как было, но финал — через `final-pass`.)

## RECOVERY-проход (после 1-го финала: ЧИНИТЬ, не дропать) — когда будут токены
Первый финал был слишком жаден на дроп И не читал твои комментарии. Исправлено:
final-pass теперь **fix-first** (Verify: drop только фундаментально-неспасаемое; чинимое → стадия **Refix**), ремонт выполняет **userNote** (твоё «не ок» с причиной) первым делом; prep-final --source old включает rejected-с-фидбеком (181, из них 55 с твоими заметками); prep-final --source guestion --recover берёт чинимые дропы (354). merge-final применяет к любому, кто был в прогоне; recovered guestion → disposition=clean; merge-guestion-into-main дедупит по `mergedToMain`.

```
# СТАРЫЕ (применить твои комменты + fix-first):
rm -rf scripts/final-in scripts/final-out
node scripts/prep-final.mjs --source old
# Workflow({ scriptPath: "scripts/final-pass.workflow.js" })
node scripts/merge-final.mjs --source old && npm test

# GUESTION (переобработать ЦЕЛИКОМ с комментами + вернуть дропы):
# 1) разлить преждевременно влитые 381 (они в лимбе, комменты не применены):
node scripts/unmerge-guestion.mjs
# 2) clean (382) - переобработка с твоими комментами (prep читает guestion-clean-review.json):
rm -rf scripts/final-in scripts/final-out
node scripts/prep-final.mjs --source guestion
# Workflow({ scriptPath: "scripts/final-pass.workflow.js" })
node scripts/merge-final.mjs --source guestion
# 3) чинимые дропы (354) - вернуть:
rm -rf scripts/final-in scripts/final-out
node scripts/prep-final.mjs --source guestion --recover
# Workflow({ scriptPath: "scripts/final-pass.workflow.js" })
node scripts/merge-final.mjs --source guestion
# 4) влить ВСЕ актуальные clean guestion в основную базу заново:
node scripts/merge-guestion-into-main.mjs && npm test
```
Почему так: 381 влитых guestion были в лимбе (ни в old, ни в --recover; комменты guestion не скармливались). Разлив + переобработка clean (с комментами) + возврат дропов + чистое слияние решает всё. prep-final --source guestion теперь читает guestion-clean-review.json (userNote).
Цена recovery: old 181 + guestion 354 = 535 через fix-first ≈ **~3M токенов**.

## Стоимость (первого финала)
Старые ~2-2.5M + guestion ~3-4M (с verify+explanation) ≈ **~6M токенов** — нужно свежее 5ч-окно.

## Готовые скрипты
prep-old/process-old/merge-old · prep-rerepair/rerepair-light/merge-rerepair ·
judge-categorize/merge-judge-cat/remap-categories · codefix-facts. См. их шапки.
