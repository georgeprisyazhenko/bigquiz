# Yandex Games SDK — HTML5 Documentation

Источник: https://yandex.ru/dev/games/doc/ru/sdk  
Содержит полную документацию по интеграции SDK Яндекс Игр для HTML5 игр.

---

## 1. Подключение и использование (sdk-about)

### Connection Methods

Разработчики могут подключить SDK двумя способами:

1. **Via `<script>` tag** - Добавьте `<script src="/sdk.js"></script>` в раздел head HTML
2. **Dynamic loading** - Программно создайте и добавьте элемент script для большего контроля

### Server Options

- **Yandex Server (Recommended)**: Используйте относительный путь `/sdk.js` при загрузке через Developer Console
- **Custom Domain**: Используйте абсолютный путь `https://sdk.games.s3.yandex.net/sdk.js`

### Initialization

После загрузки скрипта инициализируйте: `const ysdk = await YaGames.init();`

Документация отмечает, что "скрипт `/sdk.js` должен быть подключен перед выполнением `YaGames.init()`."

### Verification

Используйте debug panel (доступен через параметр URL `debug-mode=16`) для проверки статуса загрузчика:
- `W` = ожидание инициализации
- `IT` = SDK инициализирован корректно  
- `IF` = устаревший загрузчик

### Common Issues

Руководство рассматривает два частых ошибки:
1. **YaGames is not defined** - скрипт SDK не был загружен первым
2. **ysdk is not defined** - инициализация SDK не была ожидала перед использованием

---

## 2. Загрузка игры и разметка геймплея (sdk-game-events)

### Game Loading (`LoadingAPI.ready()`)

Разработчики должны вызвать этот метод после загрузки всех ресурсов и готовности игры к взаимодействию с игроком. Документация подчеркивает, что "все элементы должны быть готовы к взаимодействию игрока" и "не должно быть экранов загрузки" в момент вызова.

```javascript
await ysdk.features.LoadingAPI.ready();
```

### Gameplay Tracking

SDK предоставляет два дополнительных метода:

**Starting gameplay (`GameplayAPI.start()`)**: Вызывается когда игроки начинают или возобновляют игровой процесс — такие как запуск уровня, закрытие меню, снятие паузы, возобновление после реклам или возврат на вкладку браузера.

```javascript
ysdk.features.GameplayAPI.start();
```

**Stopping gameplay (`GameplayAPI.stop()`)**: Вызывается когда игровой процесс приостанавливается или заканчивается — включая завершение уровня, открытие меню, показ полноэкранной рекламы или переключение вкладок.

```javascript
ysdk.features.GameplayAPI.stop();
```

Руководство отмечает, что "после отправки события GameplayAPI.stop(), игровой процесс должен быть остановлен." При возобновлении разработчики должны вызвать `start()` снова.

---

## 3. Данные игрока (sdk-player)

### Initialization & Authorization

Инициализируйте объект `Player` через `ysdk.getPlayer()`. Передает ID пользователя для всех игроков, плюс аватар и имя для авторизованных пользователей.

```javascript
const player = await ysdk.getPlayer();
const isAuthorized = player.isAuthorized();
```

### Core Methods for Game Data

- **`player.setData(data, flush)`**: Сохраняет данные пользователя до 200 KB
- **`player.getData(keys)`**: Получает сохраненные данные игры асинхронно
- **`player.setStats(stats)`**: Сохраняет числовые значения (лимит 10 KB)
- **`player.incrementStats(increments)`**: Изменяет числовые данные
- **`player.getStats(keys)`**: Получает числовые данные

### Profile Data Methods

- **`player.getUniqueID()`**: Возвращает постоянный уникальный идентификатор
- **`player.getName()`**: Возвращает имя пользователя
- **`player.getPhoto(size)`**: Предоставляет URL аватара по размеру
- **`player.getPayingStatus()`**: Возвращает статус активности покупок

### Rate Limits & Constraints

Документация указывает ограничения частоты запросов:
- 20 запросов на инициализацию за 5 минут
- 60 запросов на операции со статистикой за минуту

### iOS Storage Solution

Рекомендует использовать `safeStorage` через `ysdk.getStorage()` для избежания потери данных на iOS.

---

## 4. Удаленная конфигурация (sdk-config)

### Remote Configuration Method

Используйте `ysdk.getFlags()` для получения удаленной конфигурации флагов:

```javascript
const ysdk = await YaGames.init();
const flags = await ysdk.getFlags();

if (flags.difficult === 'hard') {
    // Enable hard difficulty
}
```

### Configuration Approaches

**Local Configuration**: Разработчики должны всегда включать резервные флаги по умолчанию в коде игры для обработки сценариев, когда удаленная конфигурация не может быть получена из-за проблем с подключением. Удаленная конфигурация имеет приоритет над локальными настройками.

**Client Parameters**: Игры могут передавать специфичные для игрока данные (пройденные уровни, опыт, покупки в игре) как параметры клиента для включения условной конфигурации флагов на основе поведения и статуса игрока.

---

## 5. Ярлык на рабочий стол (sdk-shortcut)

### Check Availability

Метод `ysdk.shortcut.canShowPrompt()` проверяет, может ли быть добавлен ярлык на устройстве пользователя, учитывая правила браузера и ограничения платформы.

```javascript
if (await ysdk.shortcut.canShowPrompt()) {
    ysdk.shortcut.showPrompt();
}
```

### Display Prompt

Метод `ysdk.shortcut.showPrompt()` открывает нативный диалог, позволяющий пользователям добавить ярлык игры на рабочий стол. Поведение отличается в зависимости от существующих ярлыков: первый вызов создает ярлык на каталог Яндекс Игр; последующие вызовы создают ярлыки прямо на игру.

---

## 6. Переменные окружения (sdk-environment)

### Environment Structure

Объект содержит четыре ключевых компонента:

- **app**: данные игры (содержит ID)
- **i18n**: информация о локализации (язык в формате ISO 639-1)
- **payload**: опциональный параметр из URL-адреса игры
- **referrer**: данные о переходе из промоакции

### Language Detection

```javascript
const lang = ysdk.environment.i18n.lang; // 'ru', 'en', 'tr', ...
```

Разработчики могут получить язык для автоматического определения предпочтения пользователя.

### Promotional Campaigns

Когда игрок переходит из баннера акции, SDK передает параметры в объект referrer:

```javascript
if (ysdk.environment.referrer?.type === 'promo') {
    if (ysdk.environment.referrer.inappId) {
        showPurchaseScreen(ysdk.environment.referrer.inappId);
    }
}
```

---

## 7. Серверное время (sdk-server-time)

### Server Time Method

Метод `ysdk.serverTime()` предоставляет "время синхронизированное с сервером в миллисекундах, идентичное на всех устройствах." Это отличается от `Date.now()` тем, что предотвращает манипуляцию пользователями, изменяя время устройства.

```javascript
const serverTime = ysdk.serverTime();
```

### Use Cases

**Anti-fraud protection** – предотвращает эксплуатацию механик на основе времени  
**Game events** – включает надежные ежедневные/еженедельные бонусы, сезонные события

### Implementation Examples

**24-hour reward system**:
```javascript
const LAST_REWARD_KEY = 'lastRewardTime';
const REWARD_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

const lastTime = (await player.getData([LAST_REWARD_KEY]))[LAST_REWARD_KEY] || 0;
if (ysdk.serverTime() - lastTime > REWARD_INTERVAL) {
    // Grant reward
    await player.setData({ [LAST_REWARD_KEY]: ysdk.serverTime() });
}
```

**Daily calendar reward**:
```javascript
const today = new Date(ysdk.serverTime()).toISOString().split('T')[0];
const lastDay = (await player.getData(['lastRewardDay']))['lastRewardDay'];

if (today !== lastDay) {
    // Grant daily reward
    await player.setData({ lastRewardDay: today });
}
```

---

## 8. События (sdk-events)

### Main Event Categories

SDK предоставляет два основных события:

**`game_api_pause`**: Срабатывает при паузе игровой сессии (реклама, покупка, переключение вкладки)

**`game_api_resume`**: Срабатывает при возобновлении игровой сессии

### Other Events

- **`HISTORY_BACK`** (TV-only) - обнаружение нажатия кнопки "назад"
- **`EXIT`** - подтверждение выхода из игры
- **Account selection dialog events** - события при переключении аккаунтов

### Implementation

```javascript
const pauseCallback = () => {
    pauseGame();
};

ysdk.on('game_api_pause', pauseCallback);
ysdk.off('game_api_pause', pauseCallback); // unsubscribe
```

### Important Notes

Платформа автоматически показывает полноэкранную рекламу при запуске всех игр. Разработчики должны обрабатывать события паузы/возобновления, а не полагаться на прямые обратные вызовы для стартовых объявлений.

---

## 9. Ссылки на другие игры (sdk-other-games)

### Methods Available

**`getAllGames()`** - получить информацию обо всех своих играх, доступных на текущей платформе и домене.

```javascript
const response = await ysdk.gamesMetadata.getAllGames();
const games = response.games; // array of game objects
const developerURL = response.developerURL;
```

**`getGameByID()`** - получить данные о конкретной игре по ID из Developer Console.

```javascript
const response = await ysdk.gamesMetadata.getGameByID(appID);
const game = response.game;
const isAvailable = response.isAvailable;
```

### Game Object Structure (IGame)

Каждый объект игры содержит:
- **appID** - идентификатор игры из Developer Console
- **title** - имя игры
- **url** - прямая ссылка на игру
- **coverURL** - URL изображения обложки игры
- **iconURL** - URL изображения иконки игры

---

## 10. Другие объекты и параметры SDK (sdk-params)

### Screen Fullscreen Object

Объект `screen.fullscreen` управляет функциональностью полноэкранного режима браузера:

- **Constants**: `STATUS_ON` ("on") и `STATUS_OFF` ("off")
- **`status`**: Текущее состояние полноэкранного режима
- **`request()`**: Promise-based метод для входа в полноэкранный режим
- **`exit()`**: Promise-based метод для выхода из полноэкранного режима

Документация отмечает, что "многие браузеры запрещают переключение режимов без команды пользователя."

### Clipboard Object

Предоставляет возможность копирования текста через метод `writeText(text)`:

```javascript
ysdk.clipboard.writeText("Text to copy");
```

### Device Information Object

Идентифицирует тип устройства пользователя:

- **`type`** field: Возвращает "desktop", "mobile", "tablet" или "tv"
- **Methods**: `isMobile()`, `isDesktop()`, `isTablet()`, `isTV()` — каждый возвращает boolean

```javascript
if (ysdk.deviceInfo.isTV()) {
    // Handle TV-specific logic
}
```

---

## 11. Пример (sdk-example)

### Synchronous Connection

```html
<!DOCTYPE html>
<html>
<head>
    <script src="/sdk.js"></script>
</head>
<body>
    <button id="show-ad">Show Advertisement</button>
    <script>
        YaGames.init().then(ysdk => {
            document.getElementById('show-ad').onclick = () => {
                ysdk.adv.showFullscreenAdv({
                    onOpen: () => console.log('Ad opened'),
                    onClose: (wasShown) => console.log('Ad closed:', wasShown),
                    onError: (e) => console.error('Ad error:', e)
                });
            };
        });
    </script>
</body>
</html>
```

### Asynchronous Connection

```html
<!DOCTYPE html>
<html>
<head>
</head>
<body>
    <button id="show-ad">Show Advertisement</button>
    <script>
        let ysdk;
        
        const script = document.createElement('script');
        script.src = '/sdk.js';
        document.head.appendChild(script);
        
        script.onload = () => {
            YaGames.init().then(sdk => {
                ysdk = sdk;
            });
        };
        
        document.getElementById('show-ad').onclick = () => {
            if (ysdk) {
                ysdk.adv.showFullscreenAdv({
                    onOpen: () => console.log('Ad opened'),
                    onClose: (wasShown) => console.log('Ad closed:', wasShown),
                    onError: (e) => console.error('Ad error:', e)
                });
            }
        };
    </script>
</body>
</html>
```

### Key Callback Functions

- **`onClose`** — Triggered when ad closes or fails; includes `wasShown` parameter
- **`onOpen`** — Fires upon successful ad display
- **`onError`** — Called when errors occur; receives error object

---

## Резюме

Эта документация содержит полное описание интеграции SDK Яндекс Игр для HTML5 игр, включая:

✓ Подключение и инициализацию SDK  
✓ Отслеживание загрузки игры и геймплея  
✓ Управление данными игрока и профилем  
✓ Удаленную конфигурацию флагов  
✓ Функции ярлыков и ссылок  
✓ Переменные окружения и локализацию  
✓ Серверное время для защиты от читов  
✓ Управление событиями  
✓ Доступ к другим объектам (экран, буфер обмена, информация об устройстве)  
✓ Примеры синхронной и асинхронной интеграции
