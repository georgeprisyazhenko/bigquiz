// Адаптер Yandex Games SDK.
//
// На платформе Яндекс Игр SDK отдаётся по относительному пути /sdk.js. Локально
// (vite dev) этого файла нет, поэтому initYsdk() возвращает mock-фасад с теми же
// методами-ноупами — игровой код вызывает единый интерфейс и не падает вне платформы.
//
// Источник API: docs/sdk/html5.md (init, LoadingAPI/GameplayAPI, player, environment,
// events). Реклама и лидерборды — сигнатуры с офсайта yandex.ru/dev/games.

const SDK_URL = '/sdk.js'
const LOAD_TIMEOUT_MS = 7000
const RECORD_KEY = 'bigquiz_record'

// Загружает /sdk.js тегом script. Резолвит true при onload, false при ошибке/таймауте.
function loadSdkScript() {
  return new Promise((resolve) => {
    if (window.YaGames) {
      resolve(true)
      return
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true

    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    script.onload = () => done(true)
    script.onerror = () => done(false)
    setTimeout(() => done(false), LOAD_TIMEOUT_MS)

    document.head.appendChild(script)
  })
}

// Dev-переключатель: открой страницу с ?mockAuth=1 — мок притворится авторизованным
// игроком и отдаст фейковую таблицу рейтинга, чтобы посмотреть её вёрстку локально.
// Обычный адрес (без параметра) = гость с экраном «Войти». На платформу не влияет.
function isMockAuthEnabled() {
  try {
    return new URLSearchParams(window.location.search).has('mockAuth')
  } catch (error) {
    return false
  }
}

// Фейковые строки рейтинга для предпросмотра вёрстки таблицы в dev.
const MOCK_LEADERBOARD_ENTRIES = [
  { rank: 1, score: 21, player: { publicName: 'Алина' } },
  { rank: 2, score: 17, player: { publicName: 'Максим' } },
  { rank: 3, score: 12, player: { publicName: 'Вы (мок)' } },
  { rank: 4, score: 9, player: { publicName: 'Гость 128' } },
  { rank: 5, score: 6, player: { publicName: '' } }
]

// Игрок-заглушка. authorized=true только в dev при ?mockAuth=1.
function createMockPlayer(authorized) {
  return {
    isMock: true,
    isAuthorized: () => authorized,
    getName: () => (authorized ? 'Вы (мок)' : ''),
    getUniqueID: () => 'mock',
    getStats: () => Promise.resolve(authorized ? { bestScore: 1500, maxStreak: 12 } : {}),
    setStats: () => Promise.resolve(),
    incrementStats: () => Promise.resolve({}),
    getData: () => Promise.resolve({}),
    setData: () => Promise.resolve()
  }
}

// Полный mock-фасад SDK для локальной разработки. Реклама «проматывается» мгновенно.
function createMockSdk() {
  const noop = () => {}
  const authorized = isMockAuthEnabled()

  return {
    isMock: true,
    features: {
      LoadingAPI: { ready: noop },
      GameplayAPI: { start: noop, stop: noop }
    },
    adv: {
      showFullscreenAdv: (options = {}) => {
        const cb = options.callbacks || {}
        cb.onOpen?.()
        cb.onClose?.(false)
      },
      showRewardedVideo: (options = {}) => {
        const cb = options.callbacks || {}
        cb.onOpen?.()
        cb.onRewarded?.()
        cb.onClose?.(true)
      },
      showBannerAdv: () => Promise.resolve({ stickyAdvIsShowing: false }),
      hideBannerAdv: () => Promise.resolve({ stickyAdvIsShowing: false }),
      getBannerAdvStatus: () => Promise.resolve({ stickyAdvIsShowing: false })
    },
    getPlayer: () => Promise.resolve(createMockPlayer(authorized)),
    getStorage: () => Promise.resolve(window.localStorage),
    auth: { openAuthDialog: () => Promise.reject(new Error('mock: auth unavailable')) },
    environment: { i18n: { lang: 'ru' }, app: { id: 'mock' } },
    leaderboards: {
      setScore: () => Promise.resolve(),
      getEntries: () => Promise.resolve({ entries: authorized ? MOCK_LEADERBOARD_ENTRIES : [] }),
      getPlayerEntry: () => Promise.reject(new Error('mock: no entry'))
    },
    isAvailableMethod: () => Promise.resolve(false),
    on: noop,
    off: noop,
    serverTime: () => Date.now()
  }
}

// Поднимает реальный SDK либо возвращает mock. Никогда не бросает — игра всегда стартует.
export async function initYsdk() {
  try {
    const loaded = await loadSdkScript()
    if (loaded && window.YaGames) {
      return await window.YaGames.init()
    }
  } catch (error) {
    console.warn('[ysdk] init failed, falling back to mock', error)
  }

  return createMockSdk()
}

// safeStorage чинит потерю данных на iOS (docs/sdk/html5.md §3). Фолбэк — localStorage.
async function getSafeStorage(ysdk) {
  try {
    if (ysdk && typeof ysdk.getStorage === 'function') {
      return await ysdk.getStorage()
    }
  } catch (error) {
    // ignore — упадём на localStorage
  }
  return window.localStorage
}

async function loadLocalRecord(ysdk) {
  try {
    const storage = await getSafeStorage(ysdk)
    const raw = storage.getItem(RECORD_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        bestScore: parsed.bestScore ?? 0,
        maxStreak: parsed.maxStreak ?? 0,
        blitzBest: parsed.blitzBest ?? 0
      }
    }
  } catch (error) {
    // ignore — вернём нули
  }
  return { bestScore: 0, maxStreak: 0, blitzBest: 0 }
}

async function saveLocalRecord(ysdk, record) {
  try {
    const storage = await getSafeStorage(ysdk)
    storage.setItem(RECORD_KEY, JSON.stringify(record))
  } catch (error) {
    // ignore
  }
}

// Гибрид: гость → safeStorage; авторизован → ещё и облачные stats, берём max.
export async function loadBestRecord(ysdk, player) {
  const local = await loadLocalRecord(ysdk)
  let cloud = { bestScore: 0, maxStreak: 0, blitzBest: 0 }

  if (player && player.isAuthorized()) {
    try {
      const stats = await player.getStats(['bestScore', 'maxStreak', 'blitzBest'])
      cloud = {
        bestScore: stats?.bestScore ?? 0,
        maxStreak: stats?.maxStreak ?? 0,
        blitzBest: stats?.blitzBest ?? 0
      }
    } catch (error) {
      // ignore — останутся нули
    }
  }

  return {
    bestScore: Math.max(local.bestScore, cloud.bestScore),
    maxStreak: Math.max(local.maxStreak, cloud.maxStreak),
    blitzBest: Math.max(local.blitzBest, cloud.blitzBest)
  }
}

// Пишем рекорд сразу после действия (требование 1.9): локально + в облако, если вошли.
export async function saveBestRecord(ysdk, player, record) {
  await saveLocalRecord(ysdk, record)

  if (player && player.isAuthorized()) {
    try {
      await player.setStats({
        bestScore: record.bestScore,
        maxStreak: record.maxStreak,
        blitzBest: record.blitzBest ?? 0
      })
    } catch (error) {
      // ignore — локальная копия уже сохранена
    }
  }
}
