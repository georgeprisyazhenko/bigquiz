# Yandex Games SDK for TypeScript — Documentation

Источник: https://yandex.ru/dev/games/doc/ru/sdk/typescript/

---

## TypeScript SDK Integration Guide

### Overview

Страница документации объясняет, как интегрировать SDK Яндекс Игр в TypeScript проекты.

### Key Setup Steps

Руководство рассматривает три основных этапа установки:

## 1. Install npm

Установите npm через Node.JS с официального веб-сайта.

## 2. Add Type Definitions

Добавьте определения типов, установив пакет `@types/ysdk`:

```bash
npm install --save @types/ysdk
```

## 3. Import SDK Types

Импортируйте типы SDK в файлы вашего проекта:

```typescript
import type { SDK, Player } from 'ysdk';
```

Инициализируйте SDK с типизацией:

```typescript
const ysdk: SDK = await YaGames.init();
```

---

## Type Definitions

Пакет `@types/ysdk` предоставляет полные определения типов для всех компонентов SDK Яндекс Игр:

- **SDK** — основной интерфейс для инициализации и доступа ко всем методам
- **Player** — интерфейс для управления данными игрока
- **Advertisement** — интерфейс для работы с объявлениями
- **Leaderboards** — интерфейс для лидербордов
- **Payments** — интерфейс для внутриигровых покупок
- **Environment** — интерфейс для переменных окружения

## NPM Package Details

- **Package Name**: `@types/ysdk`
- **Repository**: [npm registry](https://www.npmjs.com/package/@types/ysdk)
- **Installation**: `npm install --save @types/ysdk`

## Support Resources

Страница направляет разработчиков к:
- Сообществу Telegram для вопросов по реализации плагина
- Ссылке на репозиторий npm пакета `@types/ysdk`

---

## Key Benefits of TypeScript Integration

1. **Type Safety** — полная типизация всех SDK методов и свойств
2. **IDE Support** — автодополнение и подсказки в редакторах кода
3. **Error Prevention** — перехват ошибок типов на этапе разработки
4. **Documentation** — встроенная документация через типы

## Typical Usage Pattern

```typescript
import type { SDK } from 'ysdk';

async function initializeGame(): Promise<void> {
    const ysdk: SDK = await YaGames.init();
    
    const player = await ysdk.getPlayer();
    const isAuthorized: boolean = player.isAuthorized();
    
    if (isAuthorized) {
        const playerData = await player.getData(['score']);
        console.log('Player score:', playerData.score);
    }
}

initializeGame();
```

---

## Navigation Context

TypeScript SDK документация является последней страницей в разделе SDK документации Яндекс Игр и следует за Defold SDK. После этой страницы идет раздел "Аккаунт разработчика" (Developer Account), выходящий из документации SDK.

---

## Summary

TypeScript SDK для Яндекс Игр предоставляет:

✓ Полные определения типов для всех компонентов SDK  
✓ Поддержку npm пакета `@types/ysdk`  
✓ Автодополнение и проверку типов в IDE  
✓ Полную совместимость с TypeScript проектами  
✓ Легкую интеграцию с существующими TypeScript приложениями

### Quick Reference

```bash
# Installation
npm install --save @types/ysdk

# Import
import type { SDK, Player } from 'ysdk';

# Initialize
const ysdk: SDK = await YaGames.init();
```

---

## Related Documentation

- [HTML5 SDK Documentation](../html5.md)
- [Unity SDK Documentation](../unity.md)
- [Cocos Creator SDK Documentation](../cocos-creator.md)
- [Construct 3 SDK Documentation](../construct3.md)
- [Defold SDK Documentation](../defold.md)
