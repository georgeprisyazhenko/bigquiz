# BigQuiz

BigQuiz — веб-викторина на `Phaser 4` и `Vite` с интеграцией `Yandex Games SDK`.  
Игра запускается как обычное SPA, а для локального ревью вопросов есть отдельная dev-админка.

## Стек

- `JavaScript` (ES modules)
- `Phaser 4` для игрового экрана
- `Vite` для dev-сервера, сборки и preview
- `Vitest` для тестов
- `Yandex Games SDK` для авторизации, сохранений, рекламы и лидерборда

## Быстрый старт

```bash
npm install
npm run dev
```

После этого:

- игра: `http://localhost:5173/`
- админка ревью: `http://localhost:5173/admin.html`

## Скрипты

- `npm run dev` — dev-сервер Vite с HMR
- `npm run build` — production-сборка в `dist/`
- `npm run preview` — локальный preview production-сборки
- `npm test` — запуск тестов один раз
- `npm run test:watch` — Vitest в watch-режиме
- `npm run lint` — ESLint для `src/` и `scripts/`
- `npm run lint:fix` — автопочинка ESLint
- `npm run format` — Prettier для `src/`, `scripts/`, `public/`, `tests/`
- `npm run images` — скачать и оптимизировать изображения
- `npm run optimize:images` — прогнать оптимизацию уже лежащих изображений

## Точка входа

- [index.html](./index.html) подключает [src/main.js](./src/main.js)
- [src/main.js](./src/main.js) инициализирует игру и `Phaser.Game`
- [admin.html](./admin.html) подключает [src/admin/admin.js](./src/admin/admin.js)

## Карта проекта

### `src/`

- [src/main.js](./src/main.js) — основная игра: сцена, режимы, ответы, счёт, реклама, SDK
- [src/ysdk.js](./src/ysdk.js) — адаптер Yandex Games SDK и локальный mock для dev
- [src/content-rules.js](./src/content-rules.js) — правила длины и качества ответов
- [src/card-rules.js](./src/card-rules.js) — правила показа карточки и порядка ответов
- [src/style.css](./src/style.css) — стили игры
- [src/admin/admin.js](./src/admin/admin.js) — локальная админка ревью вопросов
- [src/admin/admin.css](./src/admin/admin.css) — стили админки

### `public/`

- [public/questions.json](./public/questions.json) — прод-набор вопросов, который читает игра
- [public/categories.json](./public/categories.json) — дерево категорий
- `public/assets/images/` — изображения вопросов
- `public/fonts/` — локальные шрифты

### `data/`

- `data/review-pool.json` — пул вопросов на ревью
- `data/review-log.jsonl` — журнал действий ревью

### `scripts/`

- `scripts/lib/review-store.mjs` — общая логика операций с продом и пулом
- `scripts/*.mjs`, `scripts/*.js` — workflow-скрипты генерации, ревью, merge и обработки ассетов

### `tests/`

- `tests/questions-answers.test.js` — гейт по `public/questions.json`
- `tests/content-rules.test.js` — тесты правил контента
- `tests/card-rules.test.js` — тесты правил показа карточки
- `tests/admin-preview.test.js` — регресс-гард совпадения админ-превью с игрой

## Как это устроено

- Игра берёт данные из `public/questions.json` и `public/categories.json` во время выполнения.
- `Yandex Games SDK` поднимается через `src/ysdk.js`; вне платформы используется mock-слой, чтобы игра не падала локально.
- Для ревью есть отдельный контур: прод лежит в `public/questions.json`, пул ревью — в `data/review-pool.json`.
- Локальная админка доступна только в `npm run dev` и не попадает в production-сборку.

## Полезные документы

- [CLAUDE.md](./CLAUDE.md) — рабочие инструкции по проекту
- [docs/GDD_LITE.md](./docs/GDD_LITE.md) — краткая спецификация игры
- [docs/DoD.md](./docs/DoD.md) — чеклист готовности к публикации
- [docs/review-runbook.md](./docs/review-runbook.md) — цикл ревью вопросов
- [docs/Operating.md](./docs/Operating.md) — заметки по эксплуатации и Яндекс Играм

## Проверка

```bash
npm test
```

На текущем состоянии репозитория тесты проходят.

