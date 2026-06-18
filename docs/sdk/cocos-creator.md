# Yandex Games SDK for Cocos Creator — Documentation

Источник: https://yandex.ru/dev/games/doc/ru/sdk/cocos/

---

## 1. Установка (cocos/install)

### Installation Methods

Документация описывает три метода установки плагина Яндекс Игр для Cocos Creator:

**Cocos Store Installation**: Пользователи могут установить напрямую из официального магазина Cocos Store.

**Repository Installation**: Разработчики могут загрузить плагин с GitHub releases, затем использовать Extension Manager Cocos Creator для импорта .zip файла через меню: Extension > Extension Manager > Import Extension File(.zip).

### Template Configuration

После установки плагин может отображать предупреждения, связанные с шаблонами. Как указано в документации: "Яндекс Игры требуют SDK Яндекс Игр для импорта напрямую в файлы, такие как index.html".

Для разрешения этого разработчики должны перейти в раздел SDK Яндекс Игр и выбрать опцию генерации шаблона. Успешная конфигурация выдает сообщение: "Templates looks fine!"

### Additional Resources

Страница включает ссылки на:
- Документацию Cocos Creator по build templates и web preview конфигурации
- Сообщество Telegram для поддержки и вопросов
- Официальный GitHub репозиторий плагина

---

## 2. API SDK Яндекс Игр (cocos/ysdk)

### Overview

Документация объясняет, как использовать SDK Яндекс Игр в проектах Cocos Creator. После установки плагина разработчики получают доступ к типизированному объекту `ysdk`, который отражает основную функциональность SDK.

### Key Components

**Environment Variables Example:**

Руководство показывает, как получить доступ к конфигурации приложения, такой как "App ID: ${ysdk.environment.app.id}" и параметры языка через объект environment.

**Rewarded Ads Implementation:**

Документация включает практический пример создания компонента кнопки, который запускает rewarded video объявления. Разработчики определяют метод callback `onReward()` и передают его в `ysdk.adv.showRewardedVideo()` для обработки логики награды, когда пользователи завершают просмотр объявлений.

### Resources

- **GitHub Repository:** Доступен для примеров кода и обновлений плагина
- **Support:** Сообщество Telegram связано для устранения неполадок и вопросов
- **Testing:** Раздел для упрощенных рабочих процессов тестирования объявлений

---

## 3. Локализация (cocos/localization)

### Localization Editor

Плагин включает встроенный редактор для управления переводами, хранящимися в JSON файлах. Вы можете создавать новые локализации, нажав кнопку "Create", выбрав язык и вводя пары ключ-значение.

### Two Implementation Methods

**1. l10n.t() Method** — прямой подход, где вы получаете локализованный текст, используя:

```javascript
label.string = l10n.t("title")
```

**2. L10nLabel Component** — готовый компонент, который отображает ключи переводов в редакторе с обновлениями в реальном времени. Перекомпиляция не требуется при редактировании переводов.

### Workflow

Create JSON files with translation keys → Apply using either the method or component → Changes update automatically in the scene preview.

Документация подчеркивает использование JSON формата и рекомендует встроенный редактор для управления всеми переводами согласованно.

---

## 4. Тестирование (cocos/testing)

### Key Requirements

Перед тестированием вы должны "добавить draft игру с использованием Яндекс Игр консоли."

### Build Configuration Setup

1. Перейдите в **Project** → **Build** в Cocos Creator
2. Создайте новую конфигурацию сборки
3. Включите **Source Maps** и **Debug** опции для упрощения отладки
4. Нажмите **Build** для компиляции проекта

Скомпилированные файлы будут находиться в: `Project name/build/debug/index.html`

### Local Server Configuration

Детальные инструкции доступны в разделе "Launch from Local Server" документации.

### Testing Your Game

После запуска локального сервера используйте следующий формат URL для тестирования:

```
https://yandex.ru/games/app/XXXXXX?draft=true&game_url=https://localhost:6577
```

Замените XXXXXX на код вашего черновика.

Для тестирования обновленных версий пересоберите проект через панель Build и обновите браузер после завершения компиляции.

---

## Резюме

Документация Cocos Creator SDK для Яндекс Игр включает:

✓ Установку плагина из Cocos Store или GitHub  
✓ Конфигурацию шаблонов для корректной интеграции SDK  
✓ Использование API SDK Яндекс Игр  
✓ Интеграцию rewarded video объявлений  
✓ Локализацию текста через встроенный редактор  
✓ Тестирование игры локально на dev сервере  
✓ Поддержку сообщества и GitHub ресурсы
