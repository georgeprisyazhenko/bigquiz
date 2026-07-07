import Phaser from 'phaser'
import './style.css'
import { initYsdk, loadBestRecord, saveBestRecord } from './ysdk.js'
import {
  validateAnswerText,
  validateNoProhibited,
  validateOptionsHomogeneous,
  validateNumericRanges,
  validateNumericTell,
  validateHedgeTell,
  validateExamShape,
} from './content-rules.js'
import { orderAnswers, isNumericAnswerSet, imageCandidatePaths } from './card-rules.js'
import { calculateRandomAnswerPoints, getRandomStreakMultiplier } from './score-rules.js'

const GAME_WIDTH = 1120
const GAME_HEIGHT = 640
const NEXT_QUESTION_DELAY_MS = 1500
const ANSWERS_BEFORE_AD = 5

// --- Блиц: забег на время ---
const BLITZ_DURATION_MS = 60000 // длительность одного забега
const BLITZ_COUNTDOWN_S = 3 // отсчёт 3-2-1 перед стартом
const BLITZ_TICK_MS = 100 // шаг обновления таймера/шкалы
const NEXT_QUESTION_DELAY_BLITZ_MS = 500 // короткая пауза показа ответа в Блице
const BLITZ_STATE_KEY = 'bigquiz_blitz_state' // localStorage: незавершённый забег

// Техническое имя лидерборда из Консоли разработчика (сортировка по убыванию,
// формат numeric). Без созданного в Консоли лидерборда getEntries вернёт 404.
const LEADERBOARD_ID = 'best_score'

const FONT_FAMILY = 'Roboto'

const COLORS = {
  pageBackground: 0xdff3ff,
  surface: 0xffffff,
  surfaceSoft: 0xf4fbff,
  surfaceBlue: 0xeaf7ff,
  border: 0x8bcafc,
  borderSoft: 0xb9e1ff,
  text: 0x0f172a,
  textMuted: 0x475569,
  textSoft: 0x64748b,
  graphite: 0x1f2937,
  answer: 0x8bcafc,
  answerHover: 0x6dbaf8,
  answerDisabled: 0xd8edfc,
  accentYellow: 0xfcd404,
  correct: 0x04b07b,
  wrong: 0xfb6f74,
  soundBackground: 0xdff3ff,
  soundHover: 0xcfeeff,
  adBackground: 0xcfeeff,
  adCard: 0xf8fcff,
  adImage: 0xe1f3ff,
}

// Единый радиус скругления для всех форм экрана (карточка, вкладки, кнопки
// ответов, чипы, изображение). Меняй одно значение — меняется всё.
const UNIFORM_RADIUS = 16
const RADIUS = {
  panel: UNIFORM_RADIUS,
  button: UNIFORM_RADIUS,
  answerButton: UNIFORM_RADIUS,
  // Чип категории низкий (CHIP_HEIGHT=26): радиус не должен превышать половину
  // высоты, иначе дуги углов налезают друг на друга и появляются «ушки».
  // Оставляем как было — компактное скругление.
  chip: 10,
  ad: UNIFORM_RADIUS,
  image: UNIFORM_RADIUS,
}

const FONT_SIZE_SM = '12px'
const FONT_SIZE_MD = '17px'
const FONT_SIZE_LG = '20px'

const GAP = 12
const CARD_PADDING_H = 20
const CARD_PADDING_V = 10

// --- Центрируем блок «меню + карточка вопроса»; очки уходят правее ---
const CARD_WIDTH = 580
const CARD_HEIGHT = 350
const SCORE_COL_WIDTH = 200 // правая «очковая» колонка
const GAP_CARD_SCORE = 30 // зазор между карточкой и колонкой очков

const CARD_X = Math.round((GAME_WIDTH - CARD_WIDTH) / 2)
const CARD_Y = 160

const CONTENT_X = CARD_X + 20
const CONTENT_WIDTH = 540

// Правая «очковая» колонка — рисуется прямо на фоне, без рамки/подложки
const SCORE_X = CARD_X + CARD_WIDTH + GAP_CARD_SCORE
const SCORE_RIGHT = SCORE_X + SCORE_COL_WIDTH
const SCORE_PANEL_Y = CARD_Y // колонка стартует на уровне верха карточки
const SCORE_VALUE_FONT = '34px' // единый размер значений (очки/серия/рекорд)
const SCORE_ITEM_STRIDE = 76 // вертикальный шаг между блоками колонки
const SOUND_BTN_W = 120
const SOUND_BTN_H = 38

// Панель режимов: над карточкой, той же ширины; вкладки равной ширины, слева
const TOPBAR_X = CARD_X
const TOPBAR_Y = 16
const TOPBAR_HEIGHT = 48
const TOPBAR_WIDTH = CARD_WIDTH
const TAB_PAD_H = 14 // горизонтальный отступ текста внутри вкладки
const TAB_GAP = 8 // зазор между вкладками
const TAB_HEIGHT = 34 // высота пилюли
const TAB_RADIUS = 12 // вкладки низкие: радиус меньше общего (16), иначе
// скругление смыкается в «таблетку»
const PANEL_PAD = 7 // отступ рамки панели вокруг вкладок

const CATEGORIES_Y = 180
const CHIP_HEIGHT = 26
const QUESTION_Y = 218
const QUESTION_HEIGHT = 110
const IMAGE_Y = 222
const IMAGE_HEIGHT = 250
const IMAGE_WIDTH = 333
const IMAGE_X = CONTENT_X + Math.round((CONTENT_WIDTH - IMAGE_WIDTH) / 2)
const ANSWERS_START_Y = 484
const ANSWER_BUTTON_WIDTH = 261 // 261·2 + 18 = 540 = CONTENT_WIDTH
const ANSWER_BUTTON_HEIGHT = 56
const ANSWER_GAP_X = 18
const ANSWER_GAP_Y = 12

// --- HUD Блица: полоса вверху карточки (таймер слева, счёт справа) ---
// В режиме running категории/вопрос сдвигаются вниз на BLITZ_CONTENT_OFFSET,
// а изображение ужимается на ту же величину — чтобы сетка 2×2 осталась в карточке.
const BLITZ_HUD_Y = CARD_Y + 8 // верх полосы HUD внутри карточки
const BLITZ_HUD_HEIGHT = 28 // высота полосы HUD
const BLITZ_CONTENT_OFFSET = 34 // сдвиг контента вниз под HUD
const BLITZ_BAR_X = CONTENT_X + 64 // шкала таймера: левый край (после «0:60»)
const BLITZ_BAR_WIDTH = 300 // полная ширина шкалы таймера
const BLITZ_BAR_HEIGHT = 10 // высота шкалы таймера
const BLITZ_IMAGE_HEIGHT = 210 // ужатая картинка в забеге (4:3)
const BLITZ_IMAGE_WIDTH = 280 // 210 × 4/3 — без искажения пропорций

// Параметры градиента фона — управляются через MODE_THEMES
let BG_GRADIENT_LEFT = 0xdff3ff
let BG_GRADIENT_RIGHT = 0xedebff

const MODES = [
  { key: 'random', label: 'Случайный вопрос' },
  { key: 'blitz', label: 'Блиц' },
]

const MODE_THEMES = {
  random: {
    answer: 0x8bcafc,
    answerHover: 0x6dbaf8,
    border: 0x8bcafc,
    borderSoft: 0xb9e1ff,
    surfaceBlue: 0xeaf7ff,
  },
  blitz: {
    answer: 0xa08cf0,
    answerHover: 0x8b73e8,
    border: 0xa08cf0,
    borderSoft: 0xc9bef8,
    surfaceBlue: 0xf2eeff,
  },
}

const UI_VARIANTS = {
  classic: 'classic',
  arcade: 'arcade',
}

const DEFAULT_UI_VARIANT = UI_VARIANTS.arcade

function resolveUiVariant() {
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('ui')
    if (Object.values(UI_VARIANTS).includes(fromUrl)) return fromUrl
  } catch (error) {
    // ignore: URL can be unavailable in unusual embedded contexts
  }

  return DEFAULT_UI_VARIANT
}

const UI_VARIANT = resolveUiVariant()

const ARCADE = {
  bg1: 0x10172a,
  bg2: 0x1e1b4b,
  bg3: 0x172554,
  surface: 0xf8fbff,
  surfaceStrong: 0xffffff,
  surfaceTint: 0xeaf3ff,
  ink: 0x101426,
  muted: 0x69758c,
  primary: 0x7c5cff,
  primary2: 0x25d3ff,
  success: 0x10b981,
  danger: 0xff5c7a,
  warning: 0xffd166,
  outline: 0xb8a9ff,
  shadow: 0x070b1b,
  disabled: 0xdbe5f2,
  disabledText: 0x7a8699,
  boardRadius: 32,
  tileRadius: 18,
  stickerRadius: 10,
}

const ARCADE_CARD = {
  x: 248,
  y: 120,
  width: 624,
  height: 360,
  contentX: 284,
  contentWidth: 552,
}

const ARCADE_TOPBAR = {
  x: 332,
  y: 26,
  width: 456,
  height: 58,
}

const ARCADE_SCOREBOARD = {
  x: 895,
  y: 150,
  width: 166,
  height: 184,
}

const ARCADE_QUESTION_Y = 191
const ARCADE_CATEGORIES_Y = 152
const ARCADE_CATEGORY_H = 25
const ARCADE_QUESTION_ANSWER_GAP = 32
const ARCADE_CARD_BOTTOM_PAD = 32
const ARCADE_ANSWER_W = 266
const ARCADE_ANSWER_H = 62
const ARCADE_ANSWER_GAP_X = 20
const ARCADE_ANSWER_GAP_Y = 14
const ARCADE_ANSWERS_BLOCK_H = ARCADE_ANSWER_H * 2 + ARCADE_ANSWER_GAP_Y
const ARCADE_QUESTION_MAX_HEIGHT = 168
const ARCADE_BLITZ_INTRO_SHIFT_Y = -28
const ARCADE_BLITZ_COUNTDOWN_SHIFT_Y = -42
const ARCADE_WRONG_SHAKE_X = 3
const ARCADE_WRONG_SHAKE_DURATION_MS = 48
const ARCADE_WRONG_SHAKE_REPEAT = 2
const ARCADE_EXPLANATION_GAP = 17
const ARCADE_EXPLANATION_MIN_H = 68
const ARCADE_EXPLANATION_PAD_X = 22
const ARCADE_EXPLANATION_PAD_Y = 18
const ARCADE_BUTTON_BOTTOM_OFFSET = 4
const ARCADE_NEXT_BUTTON_W = 77
const ARCADE_NEXT_BUTTON_H = 38

const EXPLANATION_GAP = 17
const EXPLANATION_MIN_H = 68
const EXPLANATION_PAD_X = 22
const EXPLANATION_PAD_Y = 18
const NEXT_BUTTON_W = 154
const NEXT_BUTTON_H = 38
const HELP_CHECKBOX_SIZE = 18
const HELP_TOGGLE_H = 32
const HELP_LABEL_GAP = 10

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene')

    this.questions = []
    this.currentQuestion = null
    this.lastQuestionId = null

    this.currentAnswers = []
    this.currentCorrectAnswerIndex = null
    this.currentAnswersQuestionId = null

    this.answerState = 'idle'
    this.answerButtons = []
    this.shownQuestionIds = new Set()
    this.explanationModeEnabled = false
    this.explanationItems = []
    this.nextQuestionEvent = null

    this.sessionId = this.createSessionId()
    this.answeredCount = 0
    this.correctCount = 0
    this.wrongCount = 0
    this.accuracy = null
    this.currentStreak = 0
    this.maxStreak = 0
    this.isCurrentStreakRecord = false
    this.questionsSinceAd = 0

    this.score = 0
    this.currentMode = 'random'
    this.questionShownAt = 0

    // Блиц: жизненный цикл забега ('idle' вне режима | 'intro' | 'countdown' |
    // 'running' | 'result') и его собственные счётчики, отдельные от сессионных.
    this.blitzPhase = 'idle'
    this.blitzTimeLeftMs = BLITZ_DURATION_MS
    this.blitzTimerEvent = null
    this.blitzCountdownEvent = null
    this.blitzCountdownLeftMs = 0
    this.blitzCorrect = 0
    this.blitzAnswered = 0
    this.blitzBest = 0
    // Таймеры ведём по реальным часам (performance.now), а Phaser-событие — только
    // как «тик» перерисовки: Phaser-часы сглаживают/обрезают дельту кадров и на
    // лагах (например, сразу после загрузки) идут медленнее реального времени.
    this._blitzLastTick = 0
    // Живые объекты HUD — обновляются на месте по тику таймера, без ре-рендера
    this.blitzTimerText = null
    this.blitzTimerBar = null
    this.blitzCounterText = null
    this.blitzCountdownText = null
    this.blitzResultOverlay = null
    this.explanationItems = []
    this._blitzBarWidth = null
    this._blitzBarHeight = null
    this.interactiveObjects = new Set()

    // Ссылки на тексты правой панели — обновляем на месте после ответа
    this.scoreText = null
    this.streakMultText = null
    this.recordText = null

    this.soundEnabled = true
    this.adOverlay = null

    // Yandex Games SDK (или mock-фасад вне платформы) и данные игрока
    this.ysdk = null
    this.player = null
    this.lang = 'ru'
    this.bestScore = 0
    this.leaderboardOverlay = null

    // Динамические позиции изображения и ответов (зависят от высоты вопроса)
    this._imageY = IMAGE_Y
    this._answersY = ANSWERS_START_Y
    this._cardBottomY = CARD_Y + CARD_HEIGHT
  }

  preload() {
    this.logEvent('game_load_started')
    this.load.json('questionsData', '/questions.json')
    this.load.json('categoriesData', '/categories.json')
  }

  create() {
    this.ysdk = this.registry.get('ysdk')

    // Автоопределение языка обязательно даже для одноязычной игры (требование 2.14 —
    // зеленит индикатор «I18N is used» в debug-панели). UI пока только русский.
    this.lang = this.ysdk?.environment?.i18n?.lang || 'ru'
    this.logEvent('lang_detected', { lang: this.lang })

    this.cameras.main.setBackgroundColor(COLORS.pageBackground)

    // Буфер крупнее логической сетки в RESOLUTION раз — зумом возвращаем
    // координатам прежний масштаб 1120×640, но рисуем уже в высоком разрешении.
    this.cameras.main.setZoom(RESOLUTION)
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2)

    const data = this.cache.json.get('questionsData')

    if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
      this.logEvent('questions_json_load_error', {
        reason: 'questions.json is missing, empty, or has invalid structure',
      })

      this.showError('Не удалось загрузить questions.json')
      return
    }

    this.buildCategoryIndex(this.cache.json.get('categoriesData'))

    const validationResult = this.validateQuestions(data.questions)

    if (!validationResult.isValid) {
      this.logEvent('questions_validation_error', {
        errors: validationResult.errors,
      })

      this.showError('Ошибка в структуре questions.json')
      return
    }

    if (validationResult.warnings.length > 0) {
      this.logEvent('questions_validation_warning', {
        warnings: validationResult.warnings,
      })
    }

    this.questions = data.questions

    // Восстанавливаем незавершённый забег Блица (если есть). Иначе — обычный старт.
    const restored = this.tryRestoreBlitz()
    if (!restored) {
      this.currentQuestion = this.getRandomQuestion()
    }

    this.logEvent('game_loaded', {
      questionsCount: this.questions.length,
      restoredBlitz: restored,
    })

    // При восстановлении не перемешиваем ответы — порядок берём из сохранения.
    this.renderScreen(!restored)
    if (restored && this.blitzPhase === 'running') {
      this.startBlitzTicker()
    }

    this.trackPageLeave()
    this.setupLifecycle()

    // Dev-хук для отладки из консоли браузера (window.__scene.openLeaderboard() и т.п.).
    // import.meta.env.DEV ложно в production-сборке — строка туда не попадёт.
    if (import.meta.env?.DEV) {
      window.__scene = this
    }

    // Сигнал «игра готова» — после первого рендера, когда всё интерактивно
    // (требование 1.19.2, ≤90 c). Затем отмечаем начало геймплея.
    this.ysdk?.features?.LoadingAPI?.ready?.()
    this.ysdk?.features?.GameplayAPI?.start?.()

    // Тихая авторизация, загрузка рекорда и sticky-баннер — асинхронно, не блокируя рендер.
    this.initSdkFeatures()
  }

  // Тихо поднимает игрока (без диалога логина — требование 1.2.1), мерджит рекорд
  // из safeStorage и облака, показывает sticky-баннер.
  async initSdkFeatures() {
    if (!this.ysdk) return

    try {
      this.player = await this.ysdk.getPlayer()
    } catch (error) {
      this.player = null
    }

    try {
      const record = await loadBestRecord(this.ysdk, this.player)
      this.bestScore = Math.max(this.bestScore, record.bestScore)
      this.blitzBest = Math.max(this.blitzBest, record.blitzBest ?? 0)
      if (record.maxStreak > this.maxStreak) {
        this.maxStreak = record.maxStreak
      }
      this.refreshScorePanel(false, 0, this.getMultiplier(this.currentStreak))
    } catch (error) {
      // ignore — играем с нулевым рекордом
    }

    // Sticky-баннер (требует включения опции в Консоли; п. 4.6 — только sticky).
    try {
      await this.ysdk.adv?.showBannerAdv?.()
    } catch (error) {
      // ignore
    }
  }

  // Сохраняет рекорд сразу после действия (требования 1.9, 2.6) и обновляет лидерборд.
  persistRecord() {
    this.bestScore = Math.max(this.bestScore, this.score)
    const record = {
      bestScore: this.bestScore,
      maxStreak: this.maxStreak,
      blitzBest: this.blitzBest,
    }

    saveBestRecord(this.ysdk, this.player, record).catch(() => {})
    this.submitLeaderboardScore()
  }

  async submitLeaderboardScore() {
    if (!this.ysdk || !this.player?.isAuthorized?.()) return

    try {
      const available = await this.ysdk.isAvailableMethod?.('leaderboards.setScore')
      if (available === false) return
      await this.ysdk.leaderboards?.setScore?.(LEADERBOARD_ID, this.bestScore)
    } catch (error) {
      // ignore — рекорд уже сохранён локально/в облаке
    }
  }

  createSessionId() {
    return `session_${Date.now()}_${Phaser.Math.Between(1000, 9999)}`
  }

  logEvent(eventName, payload = {}) {
    try {
      const event = {
        eventName,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        ...payload,
      }

      console.log('[BigQuiz event]', event)
    } catch (error) {
      console.error('[BigQuiz logger error]', {
        eventName,
        error,
      })
    }
  }

  trackPageLeave() {
    window.addEventListener('beforeunload', () => {
      // Фиксируем остаток времени забега, чтобы продолжить с того же места.
      // Если таймер на паузе — остаток уже актуален (синхронизирован при паузе).
      if (this.currentMode === 'blitz' && this.blitzPhase === 'running') {
        if (this.blitzTimerEvent && !this.blitzTimerEvent.paused) {
          this.syncBlitzRemaining()
        }
        this.saveBlitzState()
      }

      this.logEvent('page_leave', {
        answeredCount: this.answeredCount,
        currentQuestionId: this.currentQuestion?.id ?? null,
        score: this.score,
        currentStreak: this.currentStreak,
        maxStreak: this.maxStreak,
      })
    })
  }

  // Пауза/возобновление геймплея и звука. Звук обязан замолкать при сворачивании
  // и смене вкладки (требование 1.3). game_api_pause/resume платформа шлёт сама
  // при рекламе/покупке/смене вкладки (docs/sdk/html5.md §8).
  setupLifecycle() {
    const pause = () => {
      this.muteSound()
      this.ysdk?.features?.GameplayAPI?.stop?.()
      // Таймер Блица намеренно НЕ замораживаем при сворачивании вкладки — иначе
      // можно было бы спокойно подсмотреть ответ в соседней вкладке «на паузе».
      // Время продолжает идти: syncBlitzRemaining() по performance.now() при
      // возврате спишет реально прошедшее время. Заморозка — только при
      // перезагрузке страницы (остаток сохраняется в beforeunload).
    }
    const resume = () => {
      this.unmuteSound()
      this.ysdk?.features?.GameplayAPI?.start?.()
    }

    this.ysdk?.on?.('game_api_pause', pause)
    this.ysdk?.on?.('game_api_resume', resume)

    // Дублируем браузерными событиями — на случай отсутствия SDK-событий.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pause()
      } else {
        resume()
      }
    })
    window.addEventListener('blur', () => this.muteSound())
    window.addEventListener('focus', () => this.unmuteSound())
  }

  // Звука в игре пока нет (тумблер soundEnabled только логирует). Хуки заведены,
  // чтобы поведение паузы было готово к появлению реального аудио-менеджера.
  muteSound() {
    if (this.sound && this.sound.mute !== undefined) {
      this.sound.mute = true
    }
  }

  unmuteSound() {
    if (this.sound && this.sound.mute !== undefined) {
      this.sound.mute = this.soundEnabled ? false : true
    }
  }

  drawRoundedBox(graphics, width, height, fillColor, options = {}) {
    const { radius = RADIUS.panel, alpha = 1, strokeColor = null, strokeWidth = 0 } = options

    graphics.clear()
    graphics.fillStyle(fillColor, alpha)
    graphics.fillRoundedRect(0, 0, width, height, radius)

    if (strokeColor !== null && strokeWidth > 0) {
      graphics.lineStyle(strokeWidth, strokeColor, 1)
      graphics.strokeRoundedRect(0, 0, width, height, radius)
    }
  }

  createRoundedBox(x, y, width, height, fillColor, options = {}) {
    const graphics = this.add.graphics({ x, y })
    this.drawRoundedBox(graphics, width, height, fillColor, options)
    return graphics
  }

  makeInteractiveBox(graphics, width, height) {
    graphics.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains
    )
    this.interactiveObjects.add(graphics)

    return graphics
  }

  clearInteractiveObjects() {
    this.interactiveObjects.forEach((gameObject) => {
      if (!gameObject?.input) return
      gameObject.disableInteractive(true)
      gameObject.removeInteractive(true)
    })
    this.interactiveObjects.clear()
    this.game.canvas.style.cursor = 'default'
  }

  setCursorPointer(gameObject) {
    gameObject.on('pointerover', () => {
      this.game.canvas.style.cursor = 'pointer'
    })
    gameObject.on('pointerout', () => {
      this.game.canvas.style.cursor = 'default'
    })
  }

  colorToHex(color) {
    return `#${color.toString(16).padStart(6, '0')}`
  }

  formatScore(value) {
    return Math.round(value).toLocaleString('ru-RU')
  }

  formatMultiplier(value) {
    return Number.isInteger(value) ? `${value}` : `${value}`
  }

  formatStreakDisplay() {
    if (this.isCurrentStreakRecord && this.currentStreak > 0) {
      return `${this.currentStreak}`
    }

    return `${this.currentStreak} / ${this.maxStreak}`
  }

  isArcadeUi() {
    return UI_VARIANT === UI_VARIANTS.arcade
  }

  drawArcadeBackground() {
    const bg = this.add.graphics()
    bg.fillGradientStyle(ARCADE.bg1, ARCADE.bg2, ARCADE.bg1, ARCADE.bg3, 1)
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

    const glow = this.add.graphics()
    glow.fillStyle(ARCADE.primary2, 0.14)
    glow.fillCircle(210, 130, 170)
    glow.fillStyle(ARCADE.primary, 0.16)
    glow.fillCircle(940, 500, 210)
    glow.fillStyle(ARCADE.warning, 0.08)
    glow.fillCircle(590, 90, 130)

    const shards = this.add.graphics()
    shards.fillStyle(0xffffff, 0.06)
    shards.fillTriangle(94, 350, 145, 312, 160, 390)
    shards.fillTriangle(1010, 80, 1064, 124, 984, 148)
    shards.fillTriangle(875, 594, 930, 552, 952, 626)
  }

  drawArcadePanel(x, y, width, height, radius = ARCADE.boardRadius) {
    const shadow = this.createRoundedBox(x + 8, y + 12, width, height, ARCADE.shadow, {
      radius,
      alpha: 0.26,
    })
    const base = this.createRoundedBox(x, y, width, height, ARCADE.surface, {
      radius,
      strokeColor: ARCADE.outline,
      strokeWidth: 2,
    })
    const shine = this.add.graphics({ x, y })
    shine.fillStyle(0xffffff, 0.38)
    shine.fillRoundedRect(14, 10, width - 28, Math.max(24, height * 0.14), radius - 10)
    shine.lineStyle(2, 0xffffff, 0.36)
    shine.strokeRoundedRect(10, 10, width - 20, height - 20, radius - 8)
    return { shadow, base, shine }
  }

  drawArcadeOverlayPanel(items, x, y, width, height, radius = 30) {
    const shade = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, ARCADE.shadow, 0.68)
      .setOrigin(0)
      .setDepth(100)
      .setInteractive()
    const panel = this.createRoundedBox(x, y, width, height, ARCADE.surface, {
      radius,
      strokeColor: ARCADE.outline,
      strokeWidth: 3,
    }).setDepth(101)
    const shine = this.add.graphics({ x, y }).setDepth(102)
    shine.fillStyle(0xffffff, 0.34)
    shine.fillRoundedRect(18, 14, width - 36, 58, radius - 10)
    shine.lineStyle(2, 0xffffff, 0.42)
    shine.strokeRoundedRect(12, 12, width - 24, height - 24, radius - 8)

    items.push(shade, panel, shine)
    return { shade, panel, shine }
  }

  drawArcadeBoard(height = ARCADE_CARD.height) {
    this.drawArcadePanel(ARCADE_CARD.x, ARCADE_CARD.y, ARCADE_CARD.width, height)

    const rim = this.add.graphics()
    rim.lineStyle(4, ARCADE.primary2, 0.18)
    rim.strokeRoundedRect(
      ARCADE_CARD.x - 8,
      ARCADE_CARD.y - 8,
      ARCADE_CARD.width + 16,
      height + 16,
      ARCADE.boardRadius + 8
    )
  }

  drawArcadeButtonSurface(graphics, width, height, state = 'default') {
    const bottomOffset = ARCADE_BUTTON_BOTTOM_OFFSET
    const palette = {
      default: {
        fill: ARCADE.surfaceStrong,
        stroke: ARCADE.outline,
        bottom: ARCADE.primary,
        alpha: 1,
      },
      hover: {
        fill: 0xf1f7ff,
        stroke: ARCADE.primary2,
        bottom: ARCADE.primary,
        alpha: 1,
      },
      selected: {
        fill: 0xeee9ff,
        stroke: ARCADE.primary,
        bottom: ARCADE.primary2,
        alpha: 1,
      },
      cta: {
        fill: ARCADE.primary,
        stroke: ARCADE.primary2,
        bottom: 0x16bfe9,
        alpha: 1,
      },
      ctaHover: {
        fill: 0x6f4ff0,
        stroke: 0x7ee8ff,
        bottom: ARCADE.primary2,
        alpha: 1,
      },
      rating: {
        fill: ARCADE.surfaceStrong,
        stroke: ARCADE.outline,
        bottom: 0xd9d1ff,
        alpha: 1,
      },
      ratingHover: {
        fill: ARCADE.surfaceTint,
        stroke: ARCADE.primary,
        bottom: ARCADE.outline,
        alpha: 1,
      },
      next: {
        fill: ARCADE.surfaceStrong,
        stroke: ARCADE.primary2,
        bottom: 0x19a7c9,
        alpha: 1,
      },
      nextHover: {
        fill: ARCADE.surfaceTint,
        stroke: ARCADE.primary2,
        bottom: 0x25c5e8,
        alpha: 1,
      },
      correct: {
        fill: ARCADE.success,
        stroke: 0x6ee7b7,
        bottom: 0x047857,
        alpha: 1,
      },
      wrong: {
        fill: ARCADE.danger,
        stroke: 0xffb0bd,
        bottom: 0xbe123c,
        alpha: 1,
      },
      disabled: {
        fill: ARCADE.disabled,
        stroke: 0xc3cfdf,
        bottom: 0x98a7bb,
        alpha: 0.76,
      },
    }[state]

    graphics.clear()
    graphics.fillStyle(palette.bottom, palette.alpha)
    graphics.fillRoundedRect(0, bottomOffset, width, height, ARCADE.tileRadius)
    graphics.fillStyle(palette.fill, palette.alpha)
    graphics.fillRoundedRect(0, 0, width, height - bottomOffset, ARCADE.tileRadius)
    graphics.lineStyle(2, palette.stroke, 0.95)
    graphics.strokeRoundedRect(1, 1, width - 2, height - (bottomOffset + 2), ARCADE.tileRadius - 2)
    graphics.lineStyle(2, 0xffffff, state === 'disabled' ? 0.24 : 0.5)
    graphics.lineBetween(18, 8, width - 18, 8)
  }

  drawNextArrowIcon(graphics, width, height, state = 'next') {
    const color = state === 'nextHover' ? ARCADE.primary : ARCADE.muted
    const centerX = width / 2
    const centerY = (height - ARCADE_BUTTON_BOTTOM_OFFSET) / 2
    const shaftStartX = centerX - 10
    const shaftEndX = centerX + 2
    const tipX = centerX + 11
    const arrowH = 15

    graphics.lineStyle(4, color, 1)
    graphics.lineBetween(shaftStartX, centerY, shaftEndX, centerY)
    graphics.fillStyle(color, 1)
    graphics.fillTriangle(
      shaftEndX,
      centerY - arrowH / 2,
      shaftEndX,
      centerY + arrowH / 2,
      tipX,
      centerY
    )
  }

  drawCheckboxCheck(graphics, color) {
    graphics.lineStyle(3, color, 1)
    graphics.beginPath()
    graphics.moveTo(5, 9)
    graphics.lineTo(8, 13)
    graphics.lineTo(14, 5)
    graphics.strokePath()
  }

  // Текст всегда генерируется в высоком разрешении (resolution = RESOLUTION),
  // иначе при зуме камеры его текстура растягивается и выглядит размытой.
  makeText(x, y, content, style = {}) {
    return this.add.text(x, y, content, { resolution: RESOLUTION, ...style })
  }

  // Плоский индекс id → имя по всем верхним категориям и подкатегориям из
  // categories.json. Используется для валидации ссылок и отрисовки названий.
  // Если файл отсутствует/невалиден — индекс пустой, cross-ref проверка тихо
  // пропускается (игра не должна падать из-за categories.json).
  buildCategoryIndex(categoriesData) {
    this.categoryIndex = new Map()

    if (!categoriesData || !Array.isArray(categoriesData.categories)) {
      this.logEvent('categories_json_load_error', {
        reason: 'categories.json is missing, empty, or has invalid structure',
      })
      return
    }

    categoriesData.categories.forEach((category) => {
      if (category?.id) {
        this.categoryIndex.set(category.id, category.name || category.id)
      }

      if (Array.isArray(category?.subcategories)) {
        category.subcategories.forEach((sub) => {
          if (sub?.id) {
            this.categoryIndex.set(sub.id, sub.name || sub.id)
          }
        })
      }
    })
  }

  // Имя категории для отображения: по id из индекса, иначе сам value
  // (поддержка вопросов со старыми текстовыми категориями).
  getCategoryLabel(category) {
    return this.categoryIndex?.get(category) || category
  }

  validateQuestions(questions) {
    const errors = []
    const warnings = []
    const hasCategoryIndex = this.categoryIndex && this.categoryIndex.size > 0

    questions.forEach((question, questionIndex) => {
      if (!question.id) {
        errors.push(`Question at index ${questionIndex} has no id`)
      }

      if (!question.question) {
        errors.push(`Question ${question.id || questionIndex} has no question text`)
      }

      if (!Array.isArray(question.answers) || question.answers.length !== 4) {
        errors.push(`Question ${question.id || questionIndex} must have exactly 4 answers`)
      }

      // Длина вариантов — мягкое предупреждение (не роняем игру: отображение
      // прикрыто гарантией ≤2 строк в makeAnswerLabel). Жёсткий гейт — тесты.
      if (Array.isArray(question.answers)) {
        question.answers.forEach((answer, answerIndex) => {
          const { ok, reasons } = validateAnswerText(answer)
          if (!ok) {
            warnings.push(
              `Question ${question.id || questionIndex} answer[${answerIndex}] "${answer}": ${reasons.join(', ')}`
            )
          }
        })
      }

      // Гейты уровня вопроса («около»-спам, вложенные диапазоны) — мягкое предупреждение
      // в игре, жёсткий гейт в тестах/промоушне (см. docs/rules-map.md).
      if (Array.isArray(question.answers)) {
        for (const res of [
          validateOptionsHomogeneous(question.answers),
          validateNumericRanges(question.answers),
          validateNumericTell(question.answers, question.correctAnswerIndex),
          validateHedgeTell(question.answers),
          validateExamShape(question.question, question.answers),
        ]) {
          if (!res.ok)
            warnings.push(`Question ${question.id || questionIndex}: ${res.reasons.join(', ')}`)
        }
      }

      // Запрещённые ЯИ темы (3.4, эзотерика/гадания) — мягкое предупреждение в игре,
      // жёсткий гейт в тестах. Политику/религию здесь не ловим (нужен LLM-судья, A.0).
      for (const text of [question.question, question.explanation]) {
        const res = validateNoProhibited(text)
        if (!res.ok)
          warnings.push(`Question ${question.id || questionIndex}: ${res.reasons.join(', ')}`)
      }

      if (
        typeof question.correctAnswerIndex !== 'number' ||
        question.correctAnswerIndex < 0 ||
        question.correctAnswerIndex > 3
      ) {
        errors.push(`Question ${question.id || questionIndex} has invalid correctAnswerIndex`)
      }

      if (!Array.isArray(question.categories) || question.categories.length === 0) {
        errors.push(`Question ${question.id || questionIndex} has no categories`)
      }

      if (Array.isArray(question.categories) && question.categories.length > 3) {
        errors.push(`Question ${question.id || questionIndex} has more than 3 categories`)
      }

      // Cross-ref с categories.json: неизвестные id — мягкое предупреждение,
      // а не ошибка, чтобы не ломать вопросы со старыми текстовыми категориями.
      if (hasCategoryIndex && Array.isArray(question.categories)) {
        question.categories.forEach((category) => {
          if (!this.categoryIndex.has(category)) {
            warnings.push(
              `Question ${question.id || questionIndex} references unknown category "${category}"`
            )
          }
        })
      }

      if (typeof question.requiresImage !== 'boolean') {
        errors.push(`Question ${question.id || questionIndex} has invalid requiresImage`)
      }

      // explanation — «факт-награда». Обязателен для новых вопросов, но
      // отсутствие — мягкое предупреждение (миграция старых данных), а
      // невалидный тип — ошибка.
      if (question.explanation === undefined || question.explanation === null) {
        warnings.push(`Question ${question.id || questionIndex} has no explanation`)
      } else if (typeof question.explanation !== 'string' || question.explanation.trim() === '') {
        errors.push(`Question ${question.id || questionIndex} has invalid explanation`)
      }

      // imageSearchQuery — опционально; если задано, должно быть строкой.
      if (
        question.imageSearchQuery !== undefined &&
        question.imageSearchQuery !== null &&
        typeof question.imageSearchQuery !== 'string'
      ) {
        errors.push(`Question ${question.id || questionIndex} has invalid imageSearchQuery`)
      }

      // reviewStatus — жизненный цикл ревью (см. админку). Игра показывает только
      // 'approved' (см. getRandomQuestion). Прочие статусы живут в пуле ревью,
      // в прод-json их быть не должно; проверяем лишь корректность значений.
      if (
        question.reviewStatus !== undefined &&
        question.reviewStatus !== null &&
        !['pending', 'approved', 'rework', 'discard'].includes(question.reviewStatus)
      ) {
        errors.push(`Question ${question.id || questionIndex} has invalid reviewStatus`)
      }

      if (
        question.reviewNote !== undefined &&
        question.reviewNote !== null &&
        typeof question.reviewNote !== 'string'
      ) {
        errors.push(`Question ${question.id || questionIndex} has invalid reviewNote`)
      }
    })

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  getRandomQuestion() {
    // Гейт прода: показываем только одобренные ревью вопросы. Прод-json должен
    // содержать только их (см. scripts/promote-to-prod.mjs), но фильтр — страховка
    // на случай, если в файл просочилось что-то со статусом ниже approved.
    let playable = this.questions.filter((q) => q.reviewStatus === 'approved')
    if (playable.length === 0) {
      // Прод собран без статусов (старые данные/ошибка сборки) — не оставляем
      // игрока с пустым экраном, играем всем, что есть.
      console.warn('[BigQuiz] нет вопросов со статусом approved — играю всеми вопросами')
      playable = this.questions
    }

    let availableQuestions = playable.filter((question) => {
      return !this.shownQuestionIds.has(question.id)
    })

    if (availableQuestions.length === 0) {
      this.shownQuestionIds = new Set()

      availableQuestions = playable.filter((question) => {
        return question.id !== this.lastQuestionId
      })

      if (availableQuestions.length === 0) {
        availableQuestions = [...playable]
      }
    }

    const randomIndex = Phaser.Math.Between(0, availableQuestions.length - 1)
    const selectedQuestion = availableQuestions[randomIndex]

    this.shownQuestionIds.add(selectedQuestion.id)
    this.lastQuestionId = selectedQuestion.id

    return selectedQuestion
  }

  prepareShuffledAnswers(question) {
    // Правила показа — единый источник src/card-rules.js (их же применяет админка-препрод).
    // Числовой набор показываем по убыванию (детерминированно), не перемешивая.
    if (isNumericAnswerSet(question.answers)) {
      const ordered = orderAnswers(question)
      this.currentAnswers = ordered.answers
      this.currentCorrectAnswerIndex = ordered.correctAnswerIndex
      this.currentAnswersQuestionId = question.id
      return
    }

    // Нечисловые перемешиваем — анти-чит позиции верного ответа.
    const answerItems = question.answers.map((answer, index) => ({
      text: answer,
      originalIndex: index,
      isCorrect: index === question.correctAnswerIndex,
    }))

    Phaser.Utils.Array.Shuffle(answerItems)

    this.currentAnswers = answerItems.map((item) => item.text)
    this.currentCorrectAnswerIndex = answerItems.findIndex((item) => item.isCorrect)
    this.currentAnswersQuestionId = question.id
  }

  hasPreparedAnswers(question) {
    return (
      this.currentAnswersQuestionId === question.id &&
      Array.isArray(this.currentAnswers) &&
      this.currentAnswers.length === 4 &&
      Number.isInteger(this.currentCorrectAnswerIndex) &&
      this.currentCorrectAnswerIndex >= 0 &&
      this.currentCorrectAnswerIndex < 4
    )
  }

  goToNextQuestion() {
    this.clearNextQuestionTimer()
    this.currentQuestion = this.getRandomQuestion()
    this.renderScreen()
  }

  clearNextQuestionTimer() {
    if (!this.nextQuestionEvent) return
    this.nextQuestionEvent.remove(false)
    this.nextQuestionEvent = null
  }

  scheduleRandomAdvance(delay = NEXT_QUESTION_DELAY_MS) {
    this.clearNextQuestionTimer()
    const timerId = window.setTimeout(() => {
      this.nextQuestionEvent = null
      this.advanceRandomAfterAnswer()
    }, delay)
    this.nextQuestionEvent = {
      remove: () => window.clearTimeout(timerId),
    }
  }

  advanceRandomAfterAnswer() {
    if (this.shouldShowAd()) {
      this.showAd()
    } else {
      this.goToNextQuestion()
    }
  }

  applyModeTheme() {
    const theme = MODE_THEMES[this.currentMode] || MODE_THEMES.random
    Object.assign(COLORS, {
      answer: theme.answer,
      answerHover: theme.answerHover,
      border: theme.border,
      borderSoft: theme.borderSoft,
      surfaceBlue: theme.surfaceBlue,
    })
  }

  renderScreen(reshuffleAnswers = true) {
    this.clearInteractiveObjects()
    this.children.removeAll(true)
    this.game.canvas.style.cursor = 'default'

    // HUD-объекты и оверлей результата уничтожены вместе со сценой — сбрасываем ссылки.
    this.blitzTimerText = null
    this.blitzTimerBar = null
    this.blitzCounterText = null
    this.blitzCountdownText = null
    this.blitzResultOverlay = null

    this.applyModeTheme()

    this.answerState = 'idle'
    this.answerButtons = []
    this.adOverlay = null
    this._cardBottomY = this.isArcadeUi()
      ? ARCADE_CARD.y + ARCADE_CARD.height
      : CARD_Y + CARD_HEIGHT

    if (this.isArcadeUi()) {
      this.drawArcadeBackground()
    } else {
      const bg = this.add.graphics()
      bg.fillGradientStyle(
        BG_GRADIENT_LEFT,
        BG_GRADIENT_RIGHT,
        BG_GRADIENT_LEFT,
        BG_GRADIENT_RIGHT,
        1
      )
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    }

    this.renderModeTabs()

    if (!this.isArcadeUi()) {
      this.createRoundedBox(CARD_X, CARD_Y, CARD_WIDTH, CARD_HEIGHT, COLORS.surface, {
        radius: RADIUS.panel,
        strokeColor: COLORS.borderSoft,
        strokeWidth: 2,
      })
    }

    // Блиц вне забега не показывает вопрос: приглашение или отсчёт занимают карточку.
    if (this.currentMode === 'blitz' && this.blitzPhase === 'intro') {
      if (this.isArcadeUi()) this.drawArcadeBoard()
      this.renderScorePanel()
      this.renderLeaderboardButton()
      this.renderBlitzIntro()
      this.saveBlitzState()
      return
    }
    if (this.currentMode === 'blitz' && this.blitzPhase === 'countdown') {
      if (this.isArcadeUi()) this.drawArcadeBoard()
      this.renderScorePanel()
      this.renderLeaderboardButton()
      this.renderBlitzCountdown()
      return
    }

    const q = this.currentQuestion
    if (reshuffleAnswers || !this.hasPreparedAnswers(q)) this.prepareShuffledAnswers(q)

    // В забеге сверху появляется HUD-полоса: контент сдвигается вниз под неё, а
    // изображение ужимается (с сохранением 4:3), чтобы сетка 2×2 осталась внутри карточки.
    const isBlitzRun = this.currentMode === 'blitz' && this.blitzPhase === 'running'
    const contentOffset = isBlitzRun ? BLITZ_CONTENT_OFFSET : 0
    this._imageW = isBlitzRun ? BLITZ_IMAGE_WIDTH : IMAGE_WIDTH
    this._imageH = isBlitzRun ? BLITZ_IMAGE_HEIGHT : IMAGE_HEIGHT
    this._imageX = CONTENT_X + Math.round((CONTENT_WIDTH - this._imageW) / 2)

    if (isBlitzRun && !this.isArcadeUi()) this.renderBlitzHud()

    let measuredQuestionHeight = null
    if (this.isArcadeUi()) {
      measuredQuestionHeight = this.measureArcadeQuestionHeight(q.question, contentOffset)
      this._answersY =
        ARCADE_QUESTION_Y + contentOffset + measuredQuestionHeight + ARCADE_QUESTION_ANSWER_GAP
      const arcadeBoardHeight =
        this._answersY + ARCADE_ANSWERS_BLOCK_H + ARCADE_CARD_BOTTOM_PAD - ARCADE_CARD.y
      this.drawArcadeBoard(arcadeBoardHeight)
      this._cardBottomY = ARCADE_CARD.y + arcadeBoardHeight
    }

    this.renderScorePanel()
    this.renderLeaderboardButton()
    this.renderExplanationToggle()
    if (isBlitzRun && this.isArcadeUi()) this.renderBlitzHud()
    this.renderCategories(q.categories, contentOffset)
    const questionHeight = this.renderQuestion(q.question, contentOffset)
    if (!this.isArcadeUi()) {
      this._answersY = QUESTION_Y + contentOffset + questionHeight + GAP
    } else if (measuredQuestionHeight === null) {
      this._answersY =
        ARCADE_QUESTION_Y + contentOffset + questionHeight + ARCADE_QUESTION_ANSWER_GAP
    }
    // renderQuestionImage убран: картинки отключены в V1
    this.renderAnswers(this.currentAnswers)
    this.renderExplanationArea(false)
    this.questionShownAt = performance.now()

    this.logEvent('question_shown', {
      questionId: q.id,
      categories: q.categories,
      questionIndex: this.answeredCount + 1,
      image: q.image,
      imageRole: q.imageRole,
      requiresImage: q.requiresImage,
      shuffledCorrectAnswerIndex: this.currentCorrectAnswerIndex,
    })

    // В забеге сохраняем точку восстановления (вопрос + порядок ответов + счётчики).
    if (this.currentMode === 'blitz' && this.blitzPhase === 'running') {
      this.saveBlitzState()
    }
  }

  getMultiplier(streak) {
    return getRandomStreakMultiplier(streak)
  }

  streakMultLabel() {
    return `×${this.getMultiplier(this.currentStreak)}`
  }

  renderModeTabs() {
    if (this.isArcadeUi()) {
      this.renderArcadeModeTabs()
      return
    }

    const labelFont = {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_SM,
      fontStyle: 'bold',
    }

    // Ширина по самой широкой вкладке («Случайный вопрос»)
    let tabWidth = 0
    MODES.forEach((mode) => {
      const probe = this.makeText(0, 0, mode.label, labelFont)
      tabWidth = Math.max(tabWidth, Math.ceil(probe.width) + TAB_PAD_H * 2)
      probe.destroy()
    })

    const tabY = TOPBAR_Y + (TOPBAR_HEIGHT - TAB_HEIGHT) / 2
    let x = TOPBAR_X + PANEL_PAD

    MODES.forEach((mode) => {
      const isActive = mode.key === this.currentMode
      const tabX = x // захватываем позицию по значению, не по ссылке
      const t = MODE_THEMES[mode.key] || MODE_THEMES.random

      const tabLabel = mode.label

      if (mode.disabled) {
        this.createRoundedBox(tabX, tabY, tabWidth, TAB_HEIGHT, COLORS.answerDisabled, {
          radius: TAB_RADIUS,
          strokeColor: COLORS.borderSoft,
          strokeWidth: 2,
        })
        this.makeText(tabX + tabWidth / 2, tabY + TAB_HEIGHT / 2, tabLabel, {
          ...labelFont,
          color: this.colorToHex(COLORS.textSoft),
        }).setOrigin(0.5)
        x += tabWidth + TAB_GAP
        return
      }

      const pill = this.createRoundedBox(
        tabX,
        tabY,
        tabWidth,
        TAB_HEIGHT,
        isActive ? t.answer : t.surfaceBlue,
        {
          radius: TAB_RADIUS,
          strokeColor: isActive ? t.border : t.borderSoft,
          strokeWidth: 2,
        }
      )

      this.makeText(tabX + tabWidth / 2, tabY + TAB_HEIGHT / 2, tabLabel, {
        ...labelFont,
        color: this.colorToHex(COLORS.text),
      }).setOrigin(0.5)

      this.makeInteractiveBox(pill, tabWidth, TAB_HEIGHT)
      this.setCursorPointer(pill)

      pill.on('pointerover', () => {
        if (!isActive) {
          this.drawRoundedBox(pill, tabWidth, TAB_HEIGHT, t.answer, {
            radius: TAB_RADIUS,
            strokeColor: t.border,
            strokeWidth: 2,
          })
        }
      })
      pill.on('pointerout', () => {
        if (!isActive) {
          this.drawRoundedBox(pill, tabWidth, TAB_HEIGHT, t.surfaceBlue, {
            radius: TAB_RADIUS,
            strokeColor: t.borderSoft,
            strokeWidth: 2,
          })
        }
      })

      pill.on('pointerdown', () => {
        if (isActive) return
        this.switchMode(mode.key)
      })

      x += tabWidth + TAB_GAP
    })
  }

  renderArcadeModeTabs() {
    this.drawArcadePanel(
      ARCADE_TOPBAR.x,
      ARCADE_TOPBAR.y,
      ARCADE_TOPBAR.width,
      ARCADE_TOPBAR.height,
      24
    )

    const tabW = Math.floor(
      (ARCADE_TOPBAR.width - 24 - TAB_GAP * (MODES.length - 1)) / MODES.length
    )
    const tabH = 40
    const tabY = ARCADE_TOPBAR.y + 9
    let x = ARCADE_TOPBAR.x + 12

    MODES.forEach((mode) => {
      const isActive = mode.key === this.currentMode
      const tab = this.add.graphics({ x, y: tabY })
      const fill = mode.disabled ? 0x2a3150 : isActive ? ARCADE.primary : 0x27335f
      const stroke = isActive ? ARCADE.primary2 : 0x56628f
      tab.fillStyle(fill, mode.disabled ? 0.62 : 0.96)
      tab.fillRoundedRect(0, 0, tabW, tabH, 16)
      tab.lineStyle(2, stroke, mode.disabled ? 0.28 : 0.8)
      tab.strokeRoundedRect(1, 1, tabW - 2, tabH - 2, 15)
      if (isActive) {
        tab.lineStyle(2, 0xffffff, 0.36)
        tab.lineBetween(16, 7, tabW - 16, 7)
      }

      const text = this.makeText(x + tabW / 2, tabY + tabH / 2, mode.label, {
        fontFamily: FONT_FAMILY,
        fontSize: mode.label.length > 12 ? '13px' : '14px',
        color: mode.disabled ? '#9aa4bd' : '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5)

      if (!mode.disabled) {
        this.makeInteractiveBox(tab, tabW, tabH)
        this.setCursorPointer(tab)
        tab.on('pointerover', () => {
          if (!isActive) {
            tab.clear()
            tab.fillStyle(0x34437a, 1)
            tab.fillRoundedRect(0, 0, tabW, tabH, 16)
            tab.lineStyle(2, ARCADE.primary2, 0.72)
            tab.strokeRoundedRect(1, 1, tabW - 2, tabH - 2, 15)
          }
        })
        tab.on('pointerout', () => {
          if (!isActive) {
            tab.clear()
            tab.fillStyle(0x27335f, 0.96)
            tab.fillRoundedRect(0, 0, tabW, tabH, 16)
            tab.lineStyle(2, 0x56628f, 0.8)
            tab.strokeRoundedRect(1, 1, tabW - 2, tabH - 2, 15)
          }
        })
        tab.on('pointerdown', () => {
          this.tweens.add({ targets: [tab, text], y: '+=2', duration: 70, yoyo: true })
          if (!isActive) this.switchMode(mode.key)
        })
      }

      x += tabW + TAB_GAP
    })
  }

  // Переключение режима по вкладке. Уход из Блица гасит таймер и оверлей результата;
  // вход в Блиц всегда начинается с экрана-приглашения (фаза intro).
  switchMode(key) {
    this.clearNextQuestionTimer()
    if (this.currentMode === 'blitz') {
      this.stopBlitzTimer()
      this.closeBlitzResult()
      this.clearBlitzState()
    }

    this.currentMode = key
    this.blitzPhase = key === 'blitz' ? 'intro' : 'idle'
    this.logEvent('mode_switched', { mode: key })
    this.renderScreen(false)
  }

  // ---- Блиц: жизненный цикл забега ----

  // Экран-приглашение внутри карточки: правила забега + кнопка «Старт».
  renderBlitzIntro() {
    if (this.isArcadeUi()) {
      this.renderArcadeBlitzIntro()
      return
    }

    const cx = CARD_X + CARD_WIDTH / 2

    this.makeText(cx, CARD_Y + 160, 'Ответь на как можно больше вопросов\nза 60 секунд', {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_MD,
      color: this.colorToHex(COLORS.textMuted),
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5)

    if (this.blitzBest > 0) {
      this.makeText(cx, CARD_Y + 224, `Твой рекорд: ${this.blitzBest}`, {
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE_SM,
        color: this.colorToHex(COLORS.textSoft),
        fontStyle: 'bold',
      }).setOrigin(0.5)
    }

    const w = 220,
      h = 60
    const x = cx - w / 2,
      y = CARD_Y + 260
    const btn = this.createRoundedBox(x, y, w, h, COLORS.answer, {
      radius: RADIUS.button,
      strokeColor: COLORS.border,
      strokeWidth: 2,
    })
    this.makeInteractiveBox(btn, w, h)
    this.setCursorPointer(btn)
    this.makeText(cx, y + h / 2, 'Старт', {
      fontFamily: FONT_FAMILY,
      fontSize: '24px',
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    btn.on('pointerover', () =>
      this.drawRoundedBox(btn, w, h, COLORS.answerHover, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })
    )
    btn.on('pointerout', () =>
      this.drawRoundedBox(btn, w, h, COLORS.answer, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })
    )
    btn.on('pointerdown', () => this.startBlitzCountdown())
  }

  renderArcadeBlitzIntro() {
    const cx = ARCADE_CARD.x + ARCADE_CARD.width / 2
    const y = ARCADE_CARD.y + ARCADE_BLITZ_INTRO_SHIFT_Y

    this.makeText(cx, y + 146, 'Ответь на как можно больше вопросов\nза 60 секунд', {
      fontFamily: FONT_FAMILY,
      fontSize: '18px',
      color: this.colorToHex(ARCADE.muted),
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5)

    if (this.blitzBest > 0) {
      this.makeText(cx, y + 214, `Твой рекорд: ${this.blitzBest}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        color: this.colorToHex(ARCADE.primary),
        fontStyle: 'bold',
      }).setOrigin(0.5)
    }

    const w = 232
    const h = 58
    const x = cx - w / 2
    const buttonY = y + 254
    const btn = this.add.graphics({ x, y: buttonY })
    this.drawArcadeButtonSurface(btn, w, h, 'cta')
    this.makeInteractiveBox(btn, w, h)
    this.setCursorPointer(btn)
    const label = this.makeText(cx, buttonY + h / 2 - 3, 'Старт', {
      fontFamily: FONT_FAMILY,
      fontSize: '24px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    btn.on('pointerover', () => this.drawArcadeButtonSurface(btn, w, h, 'ctaHover'))
    btn.on('pointerout', () => this.drawArcadeButtonSurface(btn, w, h, 'cta'))
    btn.on('pointerdown', () => {
      this.tweens.add({ targets: [btn, label], y: '+=3', duration: 90, yoyo: true })
      this.startBlitzCountdown()
    })
  }

  // Отсчёт 3-2-1 в центре карточки, по завершении — старт забега.
  startBlitzCountdown() {
    if (this.currentMode !== 'blitz') return
    if (!['intro', 'result'].includes(this.blitzPhase)) return

    this.stopBlitzTimer()
    this.blitzPhase = 'countdown'
    this.renderScreen(false)
  }

  renderBlitzCountdown() {
    const cx = this.isArcadeUi() ? ARCADE_CARD.x + ARCADE_CARD.width / 2 : CARD_X + CARD_WIDTH / 2
    const baseCy = this.isArcadeUi()
      ? ARCADE_CARD.y + ARCADE_CARD.height / 2
      : CARD_Y + CARD_HEIGHT / 2
    const cy = baseCy + (this.isArcadeUi() ? ARCADE_BLITZ_COUNTDOWN_SHIFT_Y : 0)
    const accentColor = this.isArcadeUi() ? ARCADE.primary : COLORS.answer
    const mutedColor = this.isArcadeUi() ? ARCADE.muted : COLORS.textMuted

    this.makeText(cx, cy - 60, 'Приготовься', {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_LG,
      color: this.colorToHex(mutedColor),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    this.blitzCountdownText = this.makeText(cx, cy + 20, `${BLITZ_COUNTDOWN_S}`, {
      fontFamily: FONT_FAMILY,
      fontSize: '96px',
      color: this.colorToHex(accentColor),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    // Отсчёт по реальному времени (не по Phaser-дельте): иначе сразу после загрузки,
    // пока кадры лагают, цифры висят дольше реальных секунд.
    this.blitzCountdownLeftMs = BLITZ_COUNTDOWN_S * 1000
    this._blitzLastTick = performance.now()
    this.stopBlitzTimer()
    this.blitzCountdownEvent = this.time.addEvent({
      delay: 50,
      loop: true,
      callback: () => this.tickCountdown(),
    })
  }

  tickCountdown() {
    // Защита: если за время отсчёта ушли из Блица — не стартуем.
    if (this.blitzPhase !== 'countdown') return

    const now = performance.now()
    this.blitzCountdownLeftMs -= now - this._blitzLastTick
    this._blitzLastTick = now

    if (this.blitzCountdownLeftMs <= 0) {
      this.startBlitzRun()
      return
    }

    const n = Math.ceil(this.blitzCountdownLeftMs / 1000)
    if (this.blitzCountdownText) this.blitzCountdownText.setText(`${n}`)
  }

  // Старт забега: сброс счётчиков, свежий вопрос, запуск таймера.
  startBlitzRun() {
    this.blitzPhase = 'running'
    this.blitzCorrect = 0
    this.blitzAnswered = 0
    this.blitzTimeLeftMs = BLITZ_DURATION_MS
    this.currentStreak = 0
    this.currentQuestion = this.getRandomQuestion()
    this.renderScreen()

    this.logEvent('blitz_started')
    this.startBlitzTicker()
  }

  // Запуск/перезапуск тика забега. Время считаем по performance.now() — Phaser-часы
  // на лагах занижают прошедшее время, и таймер шёл бы медленнее реального.
  startBlitzTicker() {
    this.stopBlitzTimer()
    this._blitzLastTick = performance.now()
    this.blitzTimerEvent = this.time.addEvent({
      delay: BLITZ_TICK_MS,
      loop: true,
      callback: () => this.tickBlitz(),
    })
  }

  // Списываем реально прошедшее время с момента прошлого тика.
  syncBlitzRemaining() {
    const now = performance.now()
    this.blitzTimeLeftMs = Math.max(0, this.blitzTimeLeftMs - (now - this._blitzLastTick))
    this._blitzLastTick = now
  }

  tickBlitz() {
    this.syncBlitzRemaining()
    this.updateBlitzHud()
    if (this.blitzTimeLeftMs <= 0) {
      this.endBlitzRun()
    }
  }

  stopBlitzTimer() {
    if (this.blitzTimerEvent) {
      this.blitzTimerEvent.remove()
      this.blitzTimerEvent = null
    }
    if (this.blitzCountdownEvent) {
      this.blitzCountdownEvent.remove()
      this.blitzCountdownEvent = null
    }
  }

  formatBlitzTime() {
    const totalSec = Math.ceil(this.blitzTimeLeftMs / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Полоса HUD вверху карточки: слева время + убывающая шкала, справа счётчик ✓.
  renderBlitzHud() {
    if (this.isArcadeUi()) {
      this.renderArcadeBlitzHud()
      return
    }

    const midY = BLITZ_HUD_Y + BLITZ_HUD_HEIGHT / 2

    this.blitzTimerText = this.makeText(CONTENT_X, midY, this.formatBlitzTime(), {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_MD,
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
    }).setOrigin(0, 0.5)

    // Подложка шкалы
    this.createRoundedBox(
      BLITZ_BAR_X,
      midY - BLITZ_BAR_HEIGHT / 2,
      BLITZ_BAR_WIDTH,
      BLITZ_BAR_HEIGHT,
      COLORS.surfaceBlue,
      { radius: BLITZ_BAR_HEIGHT / 2 }
    )

    // Заполнение шкалы — обновляется на месте по тику таймера
    this.blitzTimerBar = this.add.graphics({ x: BLITZ_BAR_X, y: midY - BLITZ_BAR_HEIGHT / 2 })
    this.drawBlitzBar()

    this.blitzCounterText = this.makeText(
      CONTENT_X + CONTENT_WIDTH,
      midY,
      `✓ ${this.blitzCorrect}`,
      {
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE_MD,
        color: this.colorToHex(COLORS.correct),
        fontStyle: 'bold',
      }
    ).setOrigin(1, 0.5)
  }

  renderArcadeBlitzHud() {
    const x = ARCADE_CARD.contentX
    const y = ARCADE_CATEGORIES_Y
    const barX = x + 78
    const barY = y - 6
    this._blitzBarWidth = 352
    this._blitzBarHeight = 14

    const inset = this.add.graphics({ x: x - 12, y: y - 20 })
    inset.fillStyle(ARCADE.surfaceTint, 0.72)
    inset.fillRoundedRect(0, 0, ARCADE_CARD.contentWidth + 24, 40, 18)
    inset.lineStyle(2, 0xdce7f7, 0.82)
    inset.strokeRoundedRect(1, 1, ARCADE_CARD.contentWidth + 22, 38, 17)
    inset.lineStyle(2, 0xffffff, 0.7)
    inset.lineBetween(16, 4, ARCADE_CARD.contentWidth + 8, 4)

    this.blitzTimerText = this.makeText(x, y, this.formatBlitzTime(), {
      fontFamily: FONT_FAMILY,
      fontSize: '17px',
      color: this.colorToHex(ARCADE.ink),
      fontStyle: 'bold',
    }).setOrigin(0, 0.5)

    const track = this.add.graphics({ x: barX, y: barY })
    track.fillStyle(0xdce7f7, 1)
    track.fillRoundedRect(0, 0, this._blitzBarWidth, this._blitzBarHeight, 7)
    track.lineStyle(2, 0xffffff, 0.7)
    track.strokeRoundedRect(1, 1, this._blitzBarWidth - 2, this._blitzBarHeight - 2, 6)

    this.blitzTimerBar = this.add.graphics({ x: barX, y: barY })
    this.drawBlitzBar()

    this.blitzCounterText = this.makeText(
      ARCADE_CARD.contentX + ARCADE_CARD.contentWidth,
      y,
      `✓ ${this.blitzCorrect}`,
      {
        fontFamily: FONT_FAMILY,
        fontSize: '17px',
        color: this.colorToHex(ARCADE.success),
        fontStyle: 'bold',
      }
    ).setOrigin(1, 0.5)
  }

  drawBlitzBar() {
    if (!this.blitzTimerBar) return
    const frac = Math.max(0, this.blitzTimeLeftMs / BLITZ_DURATION_MS)
    const barWidth = this._blitzBarWidth || BLITZ_BAR_WIDTH
    const barHeight = this._blitzBarHeight || BLITZ_BAR_HEIGHT
    const w = Math.max(0, Math.round(barWidth * frac))
    const color = this.isArcadeUi()
      ? frac > 0.33
        ? ARCADE.primary2
        : ARCADE.danger
      : frac > 0.33
        ? COLORS.answer
        : COLORS.wrong

    this.blitzTimerBar.clear()
    if (w > 0) {
      const r = Math.min(barHeight / 2, w / 2)
      this.blitzTimerBar.fillStyle(color, 1)
      this.blitzTimerBar.fillRoundedRect(0, 0, w, barHeight, r)
      if (this.isArcadeUi()) {
        this.blitzTimerBar.lineStyle(2, 0xffffff, 0.26)
        this.blitzTimerBar.lineBetween(6, 3, Math.max(6, w - 6), 3)
      }
    }
  }

  updateBlitzHud() {
    if (this.blitzTimerText) this.blitzTimerText.setText(this.formatBlitzTime())
    this.drawBlitzBar()
  }

  updateBlitzCounter() {
    if (this.blitzCounterText) this.blitzCounterText.setText(`✓ ${this.blitzCorrect}`)
  }

  // Конец забега: гасим таймер, фиксируем рекорд, показываем рекламу, затем результат.
  endBlitzRun() {
    if (this.blitzPhase !== 'running') return
    this.stopBlitzTimer()
    this.blitzPhase = 'result'
    // Забег завершён — снимаем точку восстановления (resume больше не нужен).
    this.clearBlitzState()

    const improved = this.blitzCorrect > this.blitzBest
    if (improved) {
      this.blitzBest = this.blitzCorrect
      this.persistRecord()
    }

    const accuracy =
      this.blitzAnswered > 0 ? Math.round((this.blitzCorrect / this.blitzAnswered) * 100) : 0

    this.logEvent('blitz_finished', {
      correct: this.blitzCorrect,
      answered: this.blitzAnswered,
      accuracy,
      blitzBest: this.blitzBest,
      isRecord: improved,
    })

    this.showBlitzAd(() => this.showBlitzResult(accuracy, improved))
  }

  // Полноэкранная реклама строго в финале забега (внутри 60 секунд рекламы нет).
  showBlitzAd(onDone) {
    this.ysdk?.features?.GameplayAPI?.stop?.()
    this.muteSound()

    let done = false
    const finish = () => {
      if (done) return
      done = true
      this.unmuteSound()
      this.ysdk?.features?.GameplayAPI?.start?.()
      onDone()
    }

    if (!this.ysdk?.adv?.showFullscreenAdv) {
      finish()
      return
    }

    this.logEvent('ad_requested', { reason: 'blitz_end' })
    this.ysdk.adv.showFullscreenAdv({
      callbacks: {
        onClose: (wasShown) => {
          this.logEvent('ad_closed', { wasShown: !!wasShown, reason: 'blitz_end' })
          finish()
        },
        onError: () => finish(),
      },
    })
  }

  // Оверлей результата (паттерн openLeaderboard): итог забега + «Ещё раз» / выход.
  showBlitzResult(accuracy, isRecord) {
    if (this.isArcadeUi()) {
      this.showArcadeBlitzResult(accuracy, isRecord)
      return
    }

    this.closeBlitzResult()

    const cx = GAME_WIDTH / 2
    const cy = GAME_HEIGHT / 2
    const items = []

    items.push(
      this.add
        .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0f172a, 0.54)
        .setOrigin(0)
        .setDepth(100)
        .setInteractive()
    )
    items.push(
      this.createRoundedBox(cx - 280, cy - 200, 560, 400, COLORS.surface, {
        radius: RADIUS.panel,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      }).setDepth(101)
    )

    const title = this.blitzTimeLeftMs <= 0 ? 'Время вышло!' : 'Блиц завершён'
    items.push(
      this.makeText(cx, cy - 150, title, {
        fontFamily: FONT_FAMILY,
        fontSize: '34px',
        color: this.colorToHex(COLORS.text),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(102)
    )
    items.push(
      this.makeText(cx, cy - 72, `${this.blitzCorrect}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '72px',
        color: this.colorToHex(COLORS.correct),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(102)
    )
    items.push(
      this.makeText(cx, cy - 14, 'правильных ответов', {
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE_MD,
        color: this.colorToHex(COLORS.textMuted),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(102)
    )

    const sub = isRecord
      ? `Новый рекорд!  ·  Точность ${accuracy}%`
      : `Точность ${accuracy}%  ·  Рекорд ${this.blitzBest}`
    items.push(
      this.makeText(cx, cy + 30, sub, {
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE_MD,
        color: this.colorToHex(isRecord ? COLORS.correct : COLORS.textSoft),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(102)
    )

    const mkBtn = (label, bx, fill, onClick) => {
      const w = 250,
        h = 56,
        by = cy + 90
      const btn = this.createRoundedBox(bx, by, w, h, fill, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      }).setDepth(102)
      this.makeInteractiveBox(btn, w, h)
      this.setCursorPointer(btn)
      const txt = this.makeText(bx + w / 2, by + h / 2, label, {
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE_MD,
        color: this.colorToHex(COLORS.text),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(103)
      btn.on('pointerdown', onClick)
      items.push(btn, txt)
    }

    mkBtn('Ещё раз', cx - 260, COLORS.answer, () => {
      this.closeBlitzResult()
      this.startBlitzCountdown()
    })
    mkBtn('В случайный режим', cx + 10, COLORS.surfaceBlue, () => {
      this.closeBlitzResult()
      this.switchMode('random')
    })

    this.blitzResultOverlay = items
  }

  showArcadeBlitzResult(accuracy, isRecord) {
    this.closeBlitzResult()

    const cx = GAME_WIDTH / 2
    const cy = GAME_HEIGHT / 2
    const items = []
    const panelW = 690
    const panelH = 420
    const panelX = cx - panelW / 2
    const panelY = cy - panelH / 2

    this.drawArcadeOverlayPanel(items, panelX, panelY, panelW, panelH, 32)

    const title = this.blitzTimeLeftMs <= 0 ? 'Время вышло!' : 'Блиц завершён'
    items.push(
      this.makeText(cx, panelY + 80, title, {
        fontFamily: FONT_FAMILY,
        fontSize: '38px',
        color: this.colorToHex(ARCADE.ink),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(104)
    )

    items.push(
      this.makeText(cx, panelY + 176, `${this.blitzCorrect}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '82px',
        color: this.colorToHex(isRecord ? ARCADE.warning : ARCADE.success),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(104)
    )

    items.push(
      this.makeText(cx, panelY + 240, 'правильных ответов', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        color: this.colorToHex(ARCADE.muted),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(104)
    )

    const sub = isRecord
      ? `Новый рекорд!  ·  Точность ${accuracy}%`
      : `Точность ${accuracy}%  ·  Рекорд ${this.blitzBest}`
    items.push(
      this.makeText(cx, panelY + 284, sub, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        color: this.colorToHex(isRecord ? ARCADE.success : ARCADE.muted),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(104)
    )

    const mkBtn = (label, bx, state, hoverState, textColor, onClick) => {
      const w = 292
      const h = 62
      const by = panelY + 330
      const btn = this.add.graphics({ x: bx, y: by }).setDepth(104)
      this.drawArcadeButtonSurface(btn, w, h, state)
      this.makeInteractiveBox(btn, w, h)
      this.setCursorPointer(btn)
      const txt = this.makeText(bx + w / 2, by + h / 2 - 3, label, {
        fontFamily: FONT_FAMILY,
        fontSize: '19px',
        color: textColor,
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(105)
      btn.on('pointerover', () => this.drawArcadeButtonSurface(btn, w, h, hoverState))
      btn.on('pointerout', () => this.drawArcadeButtonSurface(btn, w, h, state))
      btn.on('pointerdown', () => {
        this.tweens.add({ targets: [btn, txt], y: '+=3', duration: 90, yoyo: true })
        onClick()
      })
      items.push(btn, txt)
    }

    mkBtn('Ещё раз', panelX + 48, 'cta', 'ctaHover', '#ffffff', () => {
      this.closeBlitzResult()
      this.startBlitzCountdown()
    })
    mkBtn(
      'В случайный режим',
      panelX + 350,
      'rating',
      'ratingHover',
      this.colorToHex(ARCADE.muted),
      () => {
        this.closeBlitzResult()
        this.switchMode('random')
      }
    )

    this.blitzResultOverlay = items
  }

  closeBlitzResult() {
    if (!this.blitzResultOverlay) return
    this.blitzResultOverlay.forEach((item) => item.destroy())
    this.blitzResultOverlay = null
  }

  // ---- Блиц: сохранение/восстановление незавершённого забега (localStorage) ----
  // Используем синхронный localStorage напрямую (а не async getStorage): запись
  // нужна в т.ч. в beforeunload, где промисы не успевают выполниться.

  saveBlitzState() {
    if (this.currentMode !== 'blitz') return
    try {
      const state = {
        v: 1,
        phase: this.blitzPhase,
        timeLeftMs: this.blitzTimeLeftMs,
        correct: this.blitzCorrect,
        answered: this.blitzAnswered,
        questionId: this.currentQuestion?.id ?? null,
        answers: this.currentAnswers,
        correctIndex: this.currentCorrectAnswerIndex,
        shownIds: Array.from(this.shownQuestionIds),
      }
      window.localStorage.setItem(BLITZ_STATE_KEY, JSON.stringify(state))
    } catch (error) {
      // ignore — резюм просто не сработает
    }
  }

  loadBlitzState() {
    try {
      const raw = window.localStorage.getItem(BLITZ_STATE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (error) {
      return null
    }
  }

  clearBlitzState() {
    try {
      window.localStorage.removeItem(BLITZ_STATE_KEY)
    } catch (error) {
      // ignore
    }
  }

  // Пытается поднять забег из сохранения. Возвращает true, если вошли в режим Блиц
  // (с продолжением забега или хотя бы на экран-приглашение).
  tryRestoreBlitz() {
    const state = this.loadBlitzState()
    if (!state || state.v !== 1) return false

    // Восстанавливаем серию показанных вопросов, чтобы не было повторов.
    if (Array.isArray(state.shownIds)) {
      this.shownQuestionIds = new Set(state.shownIds)
    }

    this.currentMode = 'blitz'

    if (state.phase === 'running' && state.timeLeftMs > 0) {
      const q = this.questions.find((item) => item.id === state.questionId)
      if (!q) {
        // Вопрос пропал (questions.json изменился) — начинаем Блиц с приглашения.
        this.blitzPhase = 'intro'
        this.currentQuestion = this.getRandomQuestion()
        this.clearBlitzState()
        return true
      }

      this.currentQuestion = q
      if (Array.isArray(state.answers) && state.answers.length === 4) {
        this.currentAnswers = state.answers
        this.currentCorrectAnswerIndex = state.correctIndex
        this.currentAnswersQuestionId = q.id
      } else {
        this.prepareShuffledAnswers(q)
      }
      this.blitzPhase = 'running'
      this.blitzTimeLeftMs = state.timeLeftMs
      this.blitzCorrect = state.correct || 0
      this.blitzAnswered = state.answered || 0
      this.currentStreak = 0

      this.logEvent('blitz_resumed', {
        timeLeftMs: state.timeLeftMs,
        correct: this.blitzCorrect,
        answered: this.blitzAnswered,
      })
      return true
    }

    // Любая другая сохранённая фаза — возвращаемся на экран старта Блица.
    this.blitzPhase = 'intro'
    this.currentQuestion = this.getRandomQuestion()
    return true
  }

  // Один блок колонки: подпись сверху, значение снизу (единый размер значений)
  renderStat(x, y, caption, value, valueColor) {
    this.makeText(x, y, caption, {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_SM,
      color: this.colorToHex(COLORS.textMuted),
      fontStyle: 'bold',
    })

    return this.makeText(x, y + 18, value, {
      fontFamily: FONT_FAMILY,
      fontSize: SCORE_VALUE_FONT,
      color: this.colorToHex(valueColor),
      fontStyle: 'bold',
    })
  }

  renderScorePanel() {
    if (this.isArcadeUi()) {
      this.renderArcadeScorePanel()
      return
    }

    const x = SCORE_X

    this.scoreText = this.renderStat(
      x,
      SCORE_PANEL_Y,
      'ОЧКИ',
      this.formatScore(this.score),
      COLORS.text
    )
    this.recordText = this.renderStat(
      x,
      SCORE_PANEL_Y + SCORE_ITEM_STRIDE,
      'СЕРИЯ ОТВЕТОВ',
      this.formatStreakDisplay(),
      this.isCurrentStreakRecord ? COLORS.accentYellow : COLORS.text
    )
  }

  renderArcadeScorePanel() {
    const { x, y, width, height } = ARCADE_SCOREBOARD
    this.drawArcadePanel(x, y, width, height, 24)

    this.makeText(x + width / 2, y + 26, 'ОЧКИ', {
      fontFamily: FONT_FAMILY,
      fontSize: '13px',
      color: this.colorToHex(ARCADE.muted),
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0.5)

    this.scoreText = this.makeText(x + width / 2, y + 62, this.formatScore(this.score), {
      fontFamily: FONT_FAMILY,
      fontSize: '34px',
      color: this.colorToHex(ARCADE.ink),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    this.makeText(x + width / 2, y + 106, 'СЕРИЯ ОТВЕТОВ', {
      fontFamily: FONT_FAMILY,
      fontSize: '13px',
      color: this.colorToHex(ARCADE.muted),
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0.5)

    this.recordText = this.makeText(x + width / 2, y + 142, this.formatStreakDisplay(), {
      fontFamily: FONT_FAMILY,
      fontSize: '30px',
      color: this.colorToHex(this.isCurrentStreakRecord ? ARCADE.warning : ARCADE.ink),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    this.streakMultText = this.makeText(
      x + width / 2,
      y + 170,
      `x${this.getMultiplier(this.currentStreak)}`,
      {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        color: this.colorToHex(ARCADE.primary),
        fontStyle: 'bold',
      }
    ).setOrigin(0.5)
  }

  renderSoundToggle() {
    const width = SOUND_BTN_W
    const height = SOUND_BTN_H
    const x = SCORE_X
    const y = SCORE_PANEL_Y + SCORE_ITEM_STRIDE * 3
    const label = this.soundEnabled ? 'Звук: вкл' : 'Звук: выкл'

    const button = this.createRoundedBox(x, y, width, height, COLORS.soundBackground, {
      radius: RADIUS.button,
      strokeColor: COLORS.border,
      strokeWidth: 2,
    })

    this.makeInteractiveBox(button, width, height)
    this.setCursorPointer(button)

    const text = this.makeText(x + width / 2, y + height / 2, label, {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_SM,
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    button.on('pointerover', () => {
      this.drawRoundedBox(button, width, height, COLORS.soundHover, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })
    })

    button.on('pointerout', () => {
      this.drawRoundedBox(button, width, height, COLORS.soundBackground, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })
    })

    button.on('pointerdown', () => {
      this.soundEnabled = !this.soundEnabled
      this.logEvent('sound_toggled', { soundEnabled: this.soundEnabled })
      button.destroy()
      text.destroy()
      this.renderSoundToggle()
    })
  }

  // Кнопка-вход в рейтинг под блоком рекорда в правой колонке.
  renderLeaderboardButton() {
    if (this.isArcadeUi()) {
      this.renderArcadeLeaderboardButton()
      return
    }

    const width = SOUND_BTN_W
    const height = SOUND_BTN_H
    const x = SCORE_X
    const y = SCORE_PANEL_Y + SCORE_ITEM_STRIDE * 2

    const button = this.createRoundedBox(x, y, width, height, COLORS.soundBackground, {
      radius: RADIUS.button,
      strokeColor: COLORS.border,
      strokeWidth: 2,
    })

    this.makeInteractiveBox(button, width, height)
    this.setCursorPointer(button)

    this.makeText(x + width / 2, y + height / 2, 'Рейтинг', {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_SM,
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    button.on('pointerover', () => {
      this.drawRoundedBox(button, width, height, COLORS.soundHover, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })
    })
    button.on('pointerout', () => {
      this.drawRoundedBox(button, width, height, COLORS.soundBackground, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })
    })
    button.on('pointerdown', () => this.openLeaderboard())
  }

  renderArcadeLeaderboardButton() {
    const width = ARCADE_SCOREBOARD.width
    const height = 48
    const x = ARCADE_SCOREBOARD.x
    const y = ARCADE_SCOREBOARD.y + ARCADE_SCOREBOARD.height + 16

    const button = this.add.graphics({ x, y })
    this.drawArcadeButtonSurface(button, width, height, 'rating')
    this.makeInteractiveBox(button, width, height)
    this.setCursorPointer(button)

    const label = this.makeText(x + width / 2, y + height / 2 - 2, 'Рейтинг', {
      fontFamily: FONT_FAMILY,
      fontSize: '15px',
      color: this.colorToHex(ARCADE.muted),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    button.on('pointerover', () =>
      this.drawArcadeButtonSurface(button, width, height, 'ratingHover')
    )
    button.on('pointerout', () => this.drawArcadeButtonSurface(button, width, height, 'rating'))
    button.on('pointerdown', () => {
      this.tweens.add({ targets: [button, label], y: '+=2', duration: 80, yoyo: true })
      this.openLeaderboard()
    })
  }

  isExplanationAnswerState() {
    return ['answeredCorrect', 'answeredWrong'].includes(this.answerState)
  }

  renderExplanationToggle() {
    if (this.currentMode !== 'random') return

    if (this.isArcadeUi()) {
      this.renderArcadeExplanationToggle()
      return
    }

    const x = SCORE_X
    const y = SCORE_PANEL_Y + SCORE_ITEM_STRIDE * 2 + SOUND_BTN_H + 12
    const hitWidth = 154
    const hit = this.add.graphics({ x, y })
    hit.fillStyle(0xffffff, 0.001)
    hit.fillRect(0, 0, hitWidth, HELP_TOGGLE_H)
    this.makeInteractiveBox(hit, hitWidth, HELP_TOGGLE_H)
    this.setCursorPointer(hit)

    const label = this.makeText(x, y + HELP_TOGGLE_H / 2, 'Справка', {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_SM,
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
    }).setOrigin(0, 0.5)
    const boxX = x + Math.ceil(label.width) + HELP_LABEL_GAP
    const box = this.add.graphics({
      x: boxX,
      y: y + Math.round((HELP_TOGGLE_H - HELP_CHECKBOX_SIZE) / 2),
    })

    const draw = (active, hover = false) => {
      box.clear()
      box.fillStyle(active ? COLORS.answer : COLORS.surface, 1)
      box.fillRoundedRect(0, 0, HELP_CHECKBOX_SIZE, HELP_CHECKBOX_SIZE, 5)
      box.lineStyle(2, hover || active ? COLORS.border : COLORS.borderSoft, 1)
      box.strokeRoundedRect(1, 1, HELP_CHECKBOX_SIZE - 2, HELP_CHECKBOX_SIZE - 2, 4)
      if (active) {
        this.drawCheckboxCheck(box, COLORS.text)
      }
    }
    draw(this.explanationModeEnabled)

    hit.on('pointerover', () => draw(this.explanationModeEnabled, true))
    hit.on('pointerout', () => draw(this.explanationModeEnabled, false))
    hit.on('pointerdown', () => {
      this.toggleExplanationMode()
      draw(this.explanationModeEnabled, false)
    })
  }

  renderArcadeExplanationToggle() {
    const x = ARCADE_SCOREBOARD.x
    const y = ARCADE_SCOREBOARD.y + ARCADE_SCOREBOARD.height + 16 + 48 + 12
    const hitWidth = ARCADE_SCOREBOARD.width
    const hit = this.add.graphics({ x, y })
    hit.fillStyle(0xffffff, 0.001)
    hit.fillRect(0, 0, hitWidth, HELP_TOGGLE_H)
    this.makeInteractiveBox(hit, hitWidth, HELP_TOGGLE_H)
    this.setCursorPointer(hit)

    const label = this.makeText(x, y + HELP_TOGGLE_H / 2 - 1, 'Справка', {
      fontFamily: FONT_FAMILY,
      fontSize: '13px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0, 0.5)
    const boxX = x + Math.ceil(label.width) + HELP_LABEL_GAP
    const box = this.add.graphics({
      x: boxX,
      y: y + Math.round((HELP_TOGGLE_H - HELP_CHECKBOX_SIZE) / 2),
    })

    const draw = (active, hover = false) => {
      box.clear()
      box.fillStyle(active ? ARCADE.primary : ARCADE.surfaceStrong, 1)
      box.fillRoundedRect(0, 0, HELP_CHECKBOX_SIZE, HELP_CHECKBOX_SIZE, 5)
      box.lineStyle(2, hover || active ? ARCADE.primary2 : ARCADE.outline, 1)
      box.strokeRoundedRect(1, 1, HELP_CHECKBOX_SIZE - 2, HELP_CHECKBOX_SIZE - 2, 4)
      if (active) {
        this.drawCheckboxCheck(box, 0xffffff)
      }
    }
    draw(this.explanationModeEnabled)

    hit.on('pointerover', () => draw(this.explanationModeEnabled, true))
    hit.on('pointerout', () => draw(this.explanationModeEnabled, false))
    hit.on('pointerdown', () => {
      this.toggleExplanationMode()
      draw(this.explanationModeEnabled, false)
    })
  }

  toggleExplanationMode() {
    if (this.currentMode !== 'random') return

    this.explanationModeEnabled = !this.explanationModeEnabled
    this.logEvent('explanations_toggled', { enabled: this.explanationModeEnabled })

    if (this.explanationModeEnabled) {
      this.clearNextQuestionTimer()
      this.renderExplanationArea(this.isExplanationAnswerState())
      return
    }

    this.destroyExplanationArea()
    if (this.isExplanationAnswerState()) {
      this.scheduleRandomAdvance(NEXT_QUESTION_DELAY_MS)
    }
  }

  destroyExplanationArea() {
    this.explanationItems.forEach((item) => {
      if (item?.input) {
        item.disableInteractive(true)
        item.removeInteractive(true)
      }
      item?.destroy?.()
    })
    this.explanationItems = []
  }

  renderExplanationArea(showExplanation) {
    if (this.currentMode !== 'random' || !this.explanationModeEnabled) return

    this.destroyExplanationArea()

    const isArcade = this.isArcadeUi()
    const x = isArcade ? ARCADE_CARD.x : CARD_X
    const width = isArcade ? ARCADE_CARD.width : CARD_WIDTH
    const gap = isArcade ? ARCADE_EXPLANATION_GAP : EXPLANATION_GAP
    const minHeight = isArcade ? ARCADE_EXPLANATION_MIN_H : EXPLANATION_MIN_H
    const y = this._cardBottomY + gap
    const radius = isArcade ? 18 : RADIUS.panel
    const fill = isArcade ? ARCADE.surfaceTint : COLORS.surfaceBlue
    const stroke = isArcade ? ARCADE.outline : COLORS.borderSoft
    const padX = isArcade ? ARCADE_EXPLANATION_PAD_X : EXPLANATION_PAD_X
    const padY = isArcade ? ARCADE_EXPLANATION_PAD_Y : EXPLANATION_PAD_Y
    const hasNextButton = showExplanation
    const nextButtonWidth = isArcade ? ARCADE_NEXT_BUTTON_W : NEXT_BUTTON_W
    const textRightPad = hasNextButton ? nextButtonWidth + 38 : 0
    const explanation = this.currentQuestion?.explanation?.trim() || 'Справка не добавлена.'
    const bodyText = showExplanation ? explanation : 'Справка появится после ответа'
    const bodyWidth = width - padX * 2 - textRightPad
    const bodyStyle = {
      fontFamily: FONT_FAMILY,
      fontSize: isArcade ? '13px' : FONT_SIZE_SM,
      color: this.colorToHex(
        showExplanation ? (isArcade ? ARCADE.ink : COLORS.textMuted) : COLORS.textSoft
      ),
      lineSpacing: 2,
      wordWrap: { width: bodyWidth },
    }
    const probe = this.makeText(0, 0, bodyText, bodyStyle)
    const desiredHeight = Math.ceil(probe.height) + padY * 2 + 6
    probe.destroy()
    const height = Math.max(minHeight, desiredHeight)

    const panel = this.createRoundedBox(x, y, width, height, fill, {
      radius,
      alpha: isArcade ? 0.96 : 1,
      strokeColor: stroke,
      strokeWidth: 2,
    })
    this.explanationItems.push(panel)

    const body = this.makeText(x + padX, y + height / 2, bodyText, bodyStyle).setOrigin(0, 0.5)
    this.explanationItems.push(body)

    if (hasNextButton) {
      this.renderNextQuestionButton(
        x + width - nextButtonWidth - 16,
        y + height / 2,
        nextButtonWidth
      )
    }
  }

  renderNextQuestionButton(x, centerY, width) {
    const isArcade = this.isArcadeUi()
    const height = isArcade ? ARCADE_NEXT_BUTTON_H : NEXT_BUTTON_H
    const visualHeight = height + (isArcade ? ARCADE_BUTTON_BOTTOM_OFFSET : 0)
    const y = centerY - visualHeight / 2
    const button = isArcade
      ? this.add.graphics({ x, y })
      : this.createRoundedBox(x, y, width, height, COLORS.answer, {
          radius: RADIUS.button,
          strokeColor: COLORS.border,
          strokeWidth: 2,
        })

    if (isArcade) {
      this.drawArcadeButtonSurface(button, width, height, 'next')
      this.drawNextArrowIcon(button, width, height, 'next')
    }
    this.makeInteractiveBox(button, width, visualHeight)
    this.setCursorPointer(button)

    const label = isArcade
      ? null
      : this.makeText(x + width / 2, y + height / 2, 'Следующий', {
          fontFamily: FONT_FAMILY,
          fontSize: FONT_SIZE_SM,
          color: this.colorToHex(COLORS.text),
          fontStyle: 'bold',
        }).setOrigin(0.5)

    const drawClassic = (hover = false) => {
      this.drawRoundedBox(button, width, height, hover ? COLORS.answerHover : COLORS.answer, {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })
    }

    button.on('pointerover', () => {
      if (isArcade) {
        this.drawArcadeButtonSurface(button, width, height, 'nextHover')
        this.drawNextArrowIcon(button, width, height, 'nextHover')
      } else drawClassic(true)
    })
    button.on('pointerout', () => {
      if (isArcade) {
        this.drawArcadeButtonSurface(button, width, height, 'next')
        this.drawNextArrowIcon(button, width, height, 'next')
      } else drawClassic(false)
    })
    button.on('pointerdown', () => {
      if (isArcade) {
        this.tweens.add({ targets: [button], y: '+=2', duration: 80, yoyo: true })
      }
      this.clearNextQuestionTimer()
      this.advanceRandomAfterAnswer()
    })

    this.explanationItems.push(...(label ? [button, label] : [button]))
  }

  // Оверлей рейтинга. Гостю (не авторизован) показываем кнопку входа с объяснением
  // выгоды — логин только по осознанному действию (требование 1.2.1).
  async openLeaderboard() {
    if (this.isArcadeUi()) {
      await this.openArcadeLeaderboard()
      return
    }

    if (this.leaderboardOverlay) return
    this.logEvent('leaderboard_opened')
    this.ysdk?.features?.GameplayAPI?.stop?.()

    const items = []
    // Фон интерактивен — перехватывает клики, чтобы кнопки ответов под оверлеем
    // не срабатывали (answerState при этом остаётся 'idle').
    items.push(
      this.add
        .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0f172a, 0.54)
        .setOrigin(0)
        .setDepth(100)
        .setInteractive()
    )
    items.push(
      this.createRoundedBox(GAME_WIDTH / 2 - 300, GAME_HEIGHT / 2 - 230, 600, 460, COLORS.surface, {
        radius: RADIUS.panel,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      }).setDepth(101)
    )
    items.push(
      this.makeText(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 188, 'Рейтинг — очки', {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        color: this.colorToHex(COLORS.text),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(102)
    )

    // Кнопка закрытия
    const closeBtn = this.createRoundedBox(
      GAME_WIDTH / 2 + 250,
      GAME_HEIGHT / 2 - 210,
      36,
      36,
      COLORS.soundBackground,
      {
        radius: RADIUS.button,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      }
    ).setDepth(103)
    this.makeInteractiveBox(closeBtn, 36, 36)
    this.setCursorPointer(closeBtn)
    items.push(closeBtn)
    items.push(
      this.makeText(GAME_WIDTH / 2 + 268, GAME_HEIGHT / 2 - 192, 'X', {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color: this.colorToHex(COLORS.text),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(104)
    )
    closeBtn.on('pointerdown', () => this.closeLeaderboard())

    this.leaderboardOverlay = items

    const isAuthorized = this.player?.isAuthorized?.()
    if (!isAuthorized) {
      this.renderLeaderboardLogin()
      return
    }

    await this.renderLeaderboardEntries()
  }

  async openArcadeLeaderboard() {
    if (this.leaderboardOverlay) return
    this.logEvent('leaderboard_opened')
    this.ysdk?.features?.GameplayAPI?.stop?.()

    const items = []
    const panelW = 700
    const panelH = 470
    const panelX = GAME_WIDTH / 2 - panelW / 2
    const panelY = GAME_HEIGHT / 2 - panelH / 2

    this.drawArcadeOverlayPanel(items, panelX, panelY, panelW, panelH, 32)

    items.push(
      this.makeText(GAME_WIDTH / 2, panelY + 70, 'Рейтинг — очки', {
        fontFamily: FONT_FAMILY,
        fontSize: '34px',
        color: this.colorToHex(ARCADE.ink),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(104)
    )

    const closeSize = 46
    const closeX = panelX + panelW - 74
    const closeY = panelY + 36
    const closeBtn = this.add.graphics({ x: closeX, y: closeY }).setDepth(104)
    closeBtn.fillStyle(0xeaf7ff, 1)
    closeBtn.fillRoundedRect(0, 0, closeSize, closeSize, 17)
    closeBtn.lineStyle(3, ARCADE.primary2, 0.9)
    closeBtn.strokeRoundedRect(1, 1, closeSize - 2, closeSize - 2, 16)
    this.makeInteractiveBox(closeBtn, closeSize, closeSize)
    this.setCursorPointer(closeBtn)
    items.push(closeBtn)
    items.push(
      this.makeText(closeX + closeSize / 2, closeY + closeSize / 2 - 1, 'X', {
        fontFamily: FONT_FAMILY,
        fontSize: '22px',
        color: this.colorToHex(ARCADE.ink),
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setDepth(105)
    )
    closeBtn.on('pointerdown', () => this.closeLeaderboard())

    this.leaderboardOverlay = items

    const isAuthorized = this.player?.isAuthorized?.()
    if (!isAuthorized) {
      this.renderLeaderboardLogin()
      return
    }

    await this.renderLeaderboardEntries()
  }

  // Записи рейтинга через SDK. Гость авторизацию здесь не требует (getEntries без логина).
  async renderLeaderboardEntries() {
    const centerX = GAME_WIDTH / 2
    let entries = []
    try {
      const result = await this.ysdk.leaderboards.getEntries(LEADERBOARD_ID, {
        quantityTop: 10,
        includeUser: true,
        quantityAround: 3,
      })
      entries = result?.entries || []
    } catch (error) {
      this.addLeaderboardText(centerX, GAME_HEIGHT / 2, 'Рейтинг недоступен', COLORS.textMuted)
      return
    }

    if (entries.length === 0) {
      this.addLeaderboardText(
        centerX,
        GAME_HEIGHT / 2,
        'Пока нет результатов — будь первым!',
        COLORS.textMuted
      )
      return
    }

    let y = GAME_HEIGHT / 2 - 130
    entries.forEach((entry) => {
      const name = entry.player?.publicName || 'Аноним'
      const row = `${entry.rank}.  ${name}`
      this.addLeaderboardText(GAME_WIDTH / 2 - 250, y, row, COLORS.text, 0)
      this.addLeaderboardText(GAME_WIDTH / 2 + 250, y, `${entry.score}`, COLORS.text, 1)
      y += 34
    })
  }

  renderLeaderboardLogin() {
    if (this.isArcadeUi()) {
      this.renderArcadeLeaderboardLogin()
      return
    }

    const centerX = GAME_WIDTH / 2
    this.addLeaderboardText(
      centerX,
      GAME_HEIGHT / 2 - 40,
      'Войдите через Яндекс ID, чтобы попасть\nв рейтинг и сохранять рекорд между устройствами',
      COLORS.textMuted
    )

    const w = 280
    const h = 56
    const x = centerX - w / 2
    const y = GAME_HEIGHT / 2 + 50

    const loginBtn = this.createRoundedBox(x, y, w, h, COLORS.answer, {
      radius: RADIUS.button,
      strokeColor: 0x5eb8f5,
      strokeWidth: 1,
    }).setDepth(103)
    this.makeInteractiveBox(loginBtn, w, h)
    this.setCursorPointer(loginBtn)
    this.leaderboardOverlay.push(loginBtn)

    const loginText = this.makeText(centerX, y + h / 2, 'Войти', {
      fontFamily: FONT_FAMILY,
      fontSize: '22px',
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(104)
    this.leaderboardOverlay.push(loginText)

    loginBtn.on('pointerdown', async () => {
      try {
        await this.ysdk.auth.openAuthDialog()
        this.player = await this.ysdk.getPlayer()
        if (this.player?.isAuthorized?.()) {
          const record = await loadBestRecord(this.ysdk, this.player)
          this.maxStreak = Math.max(this.maxStreak, record.maxStreak)
          this.bestScore = Math.max(this.bestScore, record.bestScore)
          this.persistRecord()
          // Перерисовываем содержимое оверлея с записями
          this.closeLeaderboard()
          this.openLeaderboard()
        }
      } catch (error) {
        this.logEvent('auth_dialog_dismissed')
      }
    })
  }

  renderArcadeLeaderboardLogin() {
    const centerX = GAME_WIDTH / 2
    this.addLeaderboardText(
      centerX,
      GAME_HEIGHT / 2 - 24,
      'Войдите через Яндекс ID, чтобы попасть\nв рейтинг и сохранять рекорд между устройствами',
      ARCADE.muted
    )

    const w = 300
    const h = 62
    const x = centerX - w / 2
    const y = GAME_HEIGHT / 2 + 78

    const loginBtn = this.add.graphics({ x, y }).setDepth(104)
    this.drawArcadeButtonSurface(loginBtn, w, h, 'cta')
    this.makeInteractiveBox(loginBtn, w, h)
    this.setCursorPointer(loginBtn)
    this.leaderboardOverlay.push(loginBtn)

    const loginText = this.makeText(centerX, y + h / 2 - 3, 'Войти', {
      fontFamily: FONT_FAMILY,
      fontSize: '22px',
      color: '#ffffff',
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(105)
    this.leaderboardOverlay.push(loginText)

    loginBtn.on('pointerover', () => this.drawArcadeButtonSurface(loginBtn, w, h, 'ctaHover'))
    loginBtn.on('pointerout', () => this.drawArcadeButtonSurface(loginBtn, w, h, 'cta'))
    loginBtn.on('pointerdown', async () => {
      this.tweens.add({ targets: [loginBtn, loginText], y: '+=3', duration: 90, yoyo: true })
      try {
        await this.ysdk.auth.openAuthDialog()
        this.player = await this.ysdk.getPlayer()
        if (this.player?.isAuthorized?.()) {
          const record = await loadBestRecord(this.ysdk, this.player)
          this.maxStreak = Math.max(this.maxStreak, record.maxStreak)
          this.bestScore = Math.max(this.bestScore, record.bestScore)
          this.persistRecord()
          this.closeLeaderboard()
          this.openLeaderboard()
        }
      } catch (error) {
        this.logEvent('auth_dialog_dismissed')
      }
    })
  }

  // Вспомогательное: текст внутри оверлея рейтинга (origin 0 — слева, 0.5 — центр, 1 — справа).
  addLeaderboardText(x, y, value, color, alignOrigin = 0.5) {
    const text = this.makeText(x, y, value, {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_MD,
      color: this.colorToHex(color),
      fontStyle: 'bold',
      align: 'center',
    })
      .setOrigin(alignOrigin, 0.5)
      .setDepth(103)
    this.leaderboardOverlay?.push(text)
    return text
  }

  closeLeaderboard() {
    if (!this.leaderboardOverlay) return
    this.leaderboardOverlay.forEach((item) => item.destroy())
    this.leaderboardOverlay = null
    this.ysdk?.features?.GameplayAPI?.start?.()
  }

  renderCategories(categories, yOffset = 0) {
    if (this.isArcadeUi()) {
      this.renderArcadeCategories(categories, yOffset)
      return
    }

    const startX = CONTENT_X
    const y = CATEGORIES_Y + yOffset
    let currentX = startX

    categories.forEach((category) => {
      const text = this.makeText(currentX + 12, y + 7, this.getCategoryLabel(category), {
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE_SM,
        color: '#ffffff',
        fontStyle: 'bold',
      })

      const chipWidth = text.width + 24
      const chipHeight = CHIP_HEIGHT

      const chip = this.createRoundedBox(currentX, y, chipWidth, chipHeight, COLORS.textSoft, {
        radius: RADIUS.chip,
      })

      chip.setDepth(0)
      text.setDepth(1)

      currentX += chipWidth + 10
    })
  }

  renderArcadeCategories(categories, yOffset = 0) {
    const y = ARCADE_CATEGORIES_Y + yOffset
    let currentX = ARCADE_CARD.contentX
    const gap = 10
    const minWidth = 116
    const rightEdge = ARCADE_CARD.contentX + ARCADE_CARD.contentWidth

    categories.forEach((category, index) => {
      const label = this.getCategoryLabel(category)
      const remaining = categories.length - index
      const remainingWidth = rightEdge - currentX - gap * (remaining - 1)
      const maxWidth = Math.max(minWidth, Math.floor(remainingWidth / remaining))
      const probe = this.makeText(0, 0, label, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
      })
      const width = Math.max(minWidth, Math.min(Math.ceil(probe.width) + 30, maxWidth))
      probe.destroy()

      const sticker = this.add.graphics({ x: currentX, y })
      sticker.fillStyle(COLORS.textSoft, 1)
      sticker.fillRoundedRect(0, 0, width, ARCADE_CATEGORY_H, ARCADE.stickerRadius)

      const text = this.makeText(currentX + width / 2, y + ARCADE_CATEGORY_H / 2, label, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5)

      if (text.width > width - 20) {
        let trimmed = label
        while (trimmed.length > 1) {
          trimmed = trimmed.slice(0, -1).trimEnd()
          text.setText(`${trimmed}…`)
          if (text.width <= width - 20) break
        }
      }

      text.setDepth(sticker.depth + 1)
      currentX += width + gap
    })
  }

  renderQuestion(questionText, yOffset = 0) {
    if (this.isArcadeUi()) {
      return this.renderArcadeQuestion(questionText, yOffset)
    }

    const x = CONTENT_X
    const y = QUESTION_Y + yOffset
    const width = CONTENT_WIDTH

    const textObj = this.makeText(x, y, questionText, {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_LG,
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
      wordWrap: { width },
      lineSpacing: 3,
      fixedWidth: width,
    })

    const actualHeight = Math.min(textObj.height, QUESTION_HEIGHT)
    if (textObj.height > QUESTION_HEIGHT) {
      textObj.setFixedSize(width, QUESTION_HEIGHT)
    }
    return actualHeight
  }

  measureArcadeQuestionHeight(questionText, yOffset = 0) {
    const textObj = this.makeText(ARCADE_CARD.contentX, ARCADE_QUESTION_Y + yOffset, questionText, {
      fontFamily: FONT_FAMILY,
      fontSize: '24px',
      color: this.colorToHex(ARCADE.ink),
      fontStyle: 'bold',
      wordWrap: { width: ARCADE_CARD.contentWidth },
      lineSpacing: 4,
      fixedWidth: ARCADE_CARD.contentWidth,
    })

    const actualHeight = Math.min(textObj.height, ARCADE_QUESTION_MAX_HEIGHT)
    textObj.destroy()
    return actualHeight
  }

  renderArcadeQuestion(questionText, yOffset = 0) {
    const x = ARCADE_CARD.contentX
    const y = ARCADE_QUESTION_Y + yOffset
    const width = ARCADE_CARD.contentWidth

    const textObj = this.makeText(x, y, questionText, {
      fontFamily: FONT_FAMILY,
      fontSize: '24px',
      color: this.colorToHex(ARCADE.ink),
      fontStyle: 'bold',
      wordWrap: { width },
      lineSpacing: 4,
      fixedWidth: width,
    })

    const actualHeight = Math.min(textObj.height, ARCADE_QUESTION_MAX_HEIGHT)
    if (textObj.height > ARCADE_QUESTION_MAX_HEIGHT) {
      textObj.setFixedSize(width, ARCADE_QUESTION_MAX_HEIGHT)
    }
    return actualHeight
  }

  renderQuestionImage(question) {
    const placeholderItems = this.renderImagePlaceholder('загрузка изображения...')

    if (!question.image) {
      this.logEvent('image_missing_in_question', {
        questionId: question.id,
      })

      this.replacePlaceholderWithFallback(placeholderItems, 'изображение не указано')
      return
    }

    const textureKey = `question_image_${question.id}`
    const candidatePaths = this.getImageCandidatePaths(question.image)

    if (this.textures.exists(textureKey)) {
      placeholderItems.forEach((item) => item.destroy())
      this.renderLoadedImage(textureKey)
      return
    }

    this.logEvent('image_load_started', {
      questionId: question.id,
      candidatePaths,
    })

    this.loadImageFromCandidates({
      question,
      textureKey,
      candidatePaths,
      placeholderItems,
      candidateIndex: 0,
    })
  }

  loadImageFromCandidates({
    question,
    textureKey,
    candidatePaths,
    placeholderItems,
    candidateIndex,
  }) {
    const imagePath = candidatePaths[candidateIndex]

    if (!imagePath) {
      this.handleImageLoadFailure(question, candidatePaths, placeholderItems)
      return
    }

    const image = new Image()

    image.onload = () => {
      if (this.currentQuestion?.id !== question.id) {
        return
      }

      this.bakeRoundedImageTexture(image, textureKey)
      placeholderItems.forEach((item) => item.destroy())
      this.renderLoadedImage(textureKey)

      this.logEvent('image_loaded', {
        questionId: question.id,
        imagePath,
      })
    }

    image.onerror = () => {
      this.logEvent('image_candidate_load_error', {
        questionId: question.id,
        imagePath,
      })

      this.loadImageFromCandidates({
        question,
        textureKey,
        candidatePaths,
        placeholderItems,
        candidateIndex: candidateIndex + 1,
      })
    }

    image.src = imagePath
  }

  handleImageLoadFailure(question, candidatePaths, placeholderItems) {
    if (this.currentQuestion?.id !== question.id) {
      return
    }

    this.logEvent('image_load_error', {
      questionId: question.id,
      candidatePaths,
      requiresImage: question.requiresImage,
    })

    if (question.requiresImage) {
      this.logEvent('question_replaced_due_to_missing_image', {
        questionId: question.id,
      })

      this.goToNextQuestion()
      return
    }

    this.replacePlaceholderWithFallback(placeholderItems, 'изображение не загрузилось')

    this.logEvent('image_placeholder_shown', {
      questionId: question.id,
    })
  }

  getImageCandidatePaths(imagePath) {
    // Логика кандидатов вынесена в src/card-rules.js (та же, что в админке-препроде).
    return imageCandidatePaths(imagePath)
  }

  normalizeImagePath(imagePath) {
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return imagePath
    }

    if (imagePath.startsWith('/')) {
      return imagePath
    }

    return `/${imagePath}`
  }

  // Запекаем скруглённые углы прямо в текстуру через offscreen-canvas:
  // GeometryMask в Phaser 4 не работает на WebGL. Заодно вписываем картинку
  // в рамку 4:3 по принципу cover (заполнить, обрезать лишнее) и рендерим
  // в RESOLUTION раз крупнее — чтобы оставалась чёткой при зуме камеры.
  bakeRoundedImageTexture(sourceImage, textureKey) {
    const w = Math.round(IMAGE_WIDTH * RESOLUTION)
    const h = Math.round(IMAGE_HEIGHT * RESOLUTION)
    const r = RADIUS.image * RESOLUTION

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h

    const ctx = canvas.getContext('2d')

    ctx.beginPath()
    this.traceRoundedRect(ctx, w, h, r)
    ctx.clip()

    // cover: масштаб по большей стороне, центрирование, лишнее обрезается клипом
    const coverScale = Math.max(w / sourceImage.width, h / sourceImage.height)
    const drawW = sourceImage.width * coverScale
    const drawH = sourceImage.height * coverScale
    ctx.drawImage(sourceImage, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH)

    if (this.textures.exists(textureKey)) {
      this.textures.remove(textureKey)
    }

    this.textures.addCanvas(textureKey, canvas)
  }

  traceRoundedRect(ctx, w, h, r) {
    if (ctx.roundRect) {
      ctx.roundRect(0, 0, w, h, r)
      return
    }

    ctx.moveTo(r, 0)
    ctx.arcTo(w, 0, w, h, r)
    ctx.arcTo(w, h, 0, h, r)
    ctx.arcTo(0, h, 0, 0, r)
    ctx.arcTo(0, 0, w, 0, r)
    ctx.closePath()
  }

  renderLoadedImage(textureKey) {
    const iy = this._imageY
    const ix = this._imageX ?? IMAGE_X
    const iw = this._imageW ?? IMAGE_WIDTH
    const ih = this._imageH ?? IMAGE_HEIGHT

    const image = this.add.image(ix + iw / 2, iy + ih / 2, textureKey)

    // Текстура запечена 4:3 в RESOLUTION раз крупнее — показываем в логическом размере
    // (в Блице меньше, но та же пропорция, поэтому без искажений).
    image.setDisplaySize(iw, ih)
  }

  replacePlaceholderWithFallback(placeholderItems, message) {
    placeholderItems.forEach((item) => item.destroy())
    this.renderImagePlaceholder(message)
  }

  renderImagePlaceholder(message = 'здесь будет изображение вопроса') {
    const items = []

    const iy = this._imageY
    const ix = this._imageX ?? IMAGE_X
    const iw = this._imageW ?? IMAGE_WIDTH
    const ih = this._imageH ?? IMAGE_HEIGHT

    const background = this.createRoundedBox(ix, iy, iw, ih, COLORS.surfaceBlue, {
      radius: RADIUS.image,
    })

    const subtitle = this.makeText(ix + iw / 2, iy + ih / 2, message, {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_SM,
      color: this.colorToHex(COLORS.textSoft),
      fontStyle: 'bold',
    }).setOrigin(0.5)

    items.push(background, subtitle)

    return items
  }

  // Подпись варианта ответа. Многословные ответы переносятся автопереносом;
  // длинное слово с дефисом (нет пробела — автоперенос не срабатывает) ломаем
  // по дефису. Гарантия: текст никогда не занимает >2 строк и не шире плашки —
  // если не влезает, ужимаем шрифт. Для валидных ответов (см. content-rules.js)
  // ужатие не требуется; это страховка от просочившихся длинных ответов.
  makeAnswerLabel(centerX, centerY, answer, maxWidth) {
    const label = this.makeText(centerX, centerY, answer, {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE_MD,
      color: this.colorToHex(COLORS.text),
      fontStyle: 'bold',
      wordWrap: { width: maxWidth },
      align: 'center',
    }).setOrigin(0.5)

    // Перенос по дефису, если не влезает в ширину. Шрифт НЕ ужимаем: валидный ответ
    // (≤3 значимых слова / ≤44 симв., src/content-rules.js) и так влезает в 2 строки.
    // Если не влезает — это сигнал переформулировать ответ, а не мельчить текст.
    if (label.width > maxWidth && answer.includes('-')) {
      label.setText(answer.replace('-', '-\n'))
    }

    return label
  }

  renderAnswers(answers) {
    if (this.isArcadeUi()) {
      this.renderArcadeAnswers(answers)
      return
    }

    const startX = CONTENT_X
    const startY = this._answersY
    const buttonWidth = ANSWER_BUTTON_WIDTH
    const buttonHeight = ANSWER_BUTTON_HEIGHT
    const gapX = ANSWER_GAP_X
    const gapY = ANSWER_GAP_Y

    answers.forEach((answer, index) => {
      const col = index % 2
      const row = Math.floor(index / 2)

      const x = startX + col * (buttonWidth + gapX)
      const y = startY + row * (buttonHeight + gapY)

      const button = this.createRoundedBox(x, y, buttonWidth, buttonHeight, COLORS.surface, {
        radius: RADIUS.answerButton,
        strokeColor: COLORS.border,
        strokeWidth: 2,
      })

      this.makeInteractiveBox(button, buttonWidth, buttonHeight)
      this.setCursorPointer(button)

      const label = this.makeAnswerLabel(
        x + buttonWidth / 2,
        y + buttonHeight / 2,
        answer,
        buttonWidth - 24
      )

      button.on('pointerover', () => {
        if (this.answerState === 'idle') {
          this.drawRoundedBox(button, buttonWidth, buttonHeight, COLORS.surfaceBlue, {
            radius: RADIUS.answerButton,
            strokeColor: COLORS.border,
            strokeWidth: 2,
          })
        }
      })

      button.on('pointerout', () => {
        if (this.answerState === 'idle') {
          this.drawRoundedBox(button, buttonWidth, buttonHeight, COLORS.surface, {
            radius: RADIUS.answerButton,
            strokeColor: COLORS.border,
            strokeWidth: 2,
          })
        }
      })

      button.on('pointerdown', () => {
        this.handleAnswerClick(index)
      })

      this.answerButtons.push({
        index,
        button,
        label,
        width: buttonWidth,
        height: buttonHeight,
      })
    })
  }

  renderArcadeAnswers(answers) {
    const startX = ARCADE_CARD.contentX
    const startY = this._answersY
    const letters = ['A', 'B', 'C', 'D']

    answers.forEach((answer, index) => {
      const col = index % 2
      const row = Math.floor(index / 2)
      const x = startX + col * (ARCADE_ANSWER_W + ARCADE_ANSWER_GAP_X)
      const y = startY + row * (ARCADE_ANSWER_H + ARCADE_ANSWER_GAP_Y)

      const button = this.add.graphics({ x, y })
      this.drawArcadeButtonSurface(button, ARCADE_ANSWER_W, ARCADE_ANSWER_H, 'default')
      this.makeInteractiveBox(button, ARCADE_ANSWER_W, ARCADE_ANSWER_H)
      this.setCursorPointer(button)

      const badgeSize = 36
      const badgeX = x + 14
      const badgeY = y + Math.round((ARCADE_ANSWER_H - badgeSize) / 2)
      const badge = this.add.graphics({ x: badgeX, y: badgeY })
      badge.fillStyle(ARCADE.primary, 1)
      badge.fillRoundedRect(0, 0, badgeSize, badgeSize, 12)
      badge.lineStyle(2, 0xffffff, 0.35)
      badge.strokeRoundedRect(1, 1, badgeSize - 2, badgeSize - 2, 11)

      const badgeText = this.makeText(
        badgeX + badgeSize / 2,
        y + ARCADE_ANSWER_H / 2,
        letters[index],
        {
          fontFamily: FONT_FAMILY,
          fontSize: '17px',
          color: '#ffffff',
          fontStyle: 'bold',
        }
      ).setOrigin(0.5)

      const answerFontSize = answer.length > 34 ? '14px' : '16px'
      const label = this.makeText(x + 62, y + ARCADE_ANSWER_H / 2, answer, {
        fontFamily: FONT_FAMILY,
        fontSize: answerFontSize,
        color: this.colorToHex(ARCADE.ink),
        fontStyle: 'bold',
        wordWrap: { width: ARCADE_ANSWER_W - 78 },
        fixedWidth: ARCADE_ANSWER_W - 78,
      }).setOrigin(0, 0.5)

      const setState = (state) => {
        this.drawArcadeButtonSurface(button, ARCADE_ANSWER_W, ARCADE_ANSWER_H, state)
      }

      button.on('pointerover', () => {
        if (this.answerState === 'idle') setState('hover')
      })
      button.on('pointerout', () => {
        if (this.answerState === 'idle') setState('default')
      })
      button.on('pointerdown', () => {
        if (this.answerState !== 'idle') return
        setState('selected')
        this.tweens.add({
          targets: [button, badge, badgeText, label],
          y: '+=3',
          duration: 90,
          yoyo: true,
          ease: 'Sine.out',
        })
        this.handleAnswerClick(index)
      })

      this.answerButtons.push({
        index,
        button,
        label,
        badge,
        badgeText,
        width: ARCADE_ANSWER_W,
        height: ARCADE_ANSWER_H,
      })
    })
  }

  handleAnswerClick(selectedAnswerIndex) {
    if (this.answerState !== 'idle') {
      return
    }

    this.game.canvas.style.cursor = 'default'

    const correctAnswerIndex = this.currentCorrectAnswerIndex
    const isCorrect = selectedAnswerIndex === correctAnswerIndex

    this.answerState = isCorrect ? 'answeredCorrect' : 'answeredWrong'

    const answerTimeMs = Math.max(0, performance.now() - this.questionShownAt)
    const { gained, mult, speedBonus } = this.updateSessionStats(isCorrect, answerTimeMs)
    this.highlightAnswers(selectedAnswerIndex, correctAnswerIndex, isCorrect)
    this.refreshScorePanel(isCorrect, gained, mult, selectedAnswerIndex)

    const isBlitzRun = this.currentMode === 'blitz' && this.blitzPhase === 'running'
    if (isBlitzRun) {
      this.blitzAnswered += 1
      if (isCorrect) this.blitzCorrect += 1
      this.updateBlitzCounter()
    }

    this.logEvent('answer_selected', {
      questionId: this.currentQuestion.id,
      questionIndex: this.answeredCount,
      categories: this.currentQuestion.categories,
      selectedAnswerIndex,
      correctAnswerIndex,
      isCorrect,
      score: this.score,
      gainedPoints: gained,
      multiplier: mult,
      speedBonus,
      answerTimeMs: Math.round(answerTimeMs),
      sessionAccuracy: this.accuracy,
      currentStreak: this.currentStreak,
      maxStreak: this.maxStreak,
      questionsSinceAd: this.questionsSinceAd,
      mode: this.currentMode,
    })

    // В Блице: короткая пауза, без рекламы внутри забега; следующий вопрос только
    // если забег ещё идёт (таймер мог истечь во время показа ответа).
    if (isBlitzRun) {
      this.time.delayedCall(NEXT_QUESTION_DELAY_BLITZ_MS, () => {
        if (this.blitzPhase === 'running') this.goToNextQuestion()
      })
      return
    }

    if (this.explanationModeEnabled) {
      this.renderExplanationArea(true)
      return
    }

    this.scheduleRandomAdvance()
  }

  updateSessionStats(isCorrect, answerTimeMs = 0) {
    this.answeredCount += 1
    this.questionsSinceAd += 1

    let mult = this.getMultiplier(this.currentStreak)
    let gained = 0
    let speedBonus = 0

    const prevMaxStreak = this.maxStreak
    const prevBestScore = this.bestScore

    if (isCorrect) {
      this.correctCount += 1
      if (this.currentMode === 'random') {
        this.currentStreak += 1
        const points = calculateRandomAnswerPoints(answerTimeMs, this.currentStreak)
        gained = points.gained
        mult = points.multiplier
        speedBonus = points.speedBonus
        this.score += gained
        this.maxStreak = Math.max(this.maxStreak, this.currentStreak)
        this.isCurrentStreakRecord = this.currentStreak > prevMaxStreak
      }
    } else {
      this.wrongCount += 1
      if (this.currentMode === 'random') {
        this.currentStreak = 0
        this.isCurrentStreakRecord = false
      }
    }

    this.accuracy = Math.round((this.correctCount / this.answeredCount) * 100)

    // Сохраняем только при реальном улучшении — щадим лимиты setStats (60/мин).
    if (this.maxStreak > prevMaxStreak || this.score > prevBestScore) {
      this.persistRecord()
    }

    return { gained, mult, speedBonus }
  }

  refreshScorePanel(isCorrect, gained, mult, selectedAnswerIndex = null) {
    if (this.scoreText) {
      this.scoreText.setText(this.formatScore(this.score))
    }
    if (this.recordText) {
      this.recordText.setText(this.formatStreakDisplay())
      this.recordText.setColor(
        this.colorToHex(
          this.isCurrentStreakRecord
            ? this.isArcadeUi()
              ? ARCADE.warning
              : COLORS.accentYellow
            : this.isArcadeUi()
              ? ARCADE.ink
              : COLORS.text
        )
      )
    }
    if (this.streakMultText) {
      this.streakMultText.setText(
        `x${this.formatMultiplier(this.getMultiplier(this.currentStreak))}`
      )
    }
    if (isCorrect && gained > 0) this.spawnScorePopup(gained, selectedAnswerIndex)
  }

  // Плавающий «+200» над выбранным ответом — награда появляется в фокусе клика.
  spawnScorePopup(gained, selectedAnswerIndex = null) {
    const answerButton = this.answerButtons.find(({ index }) => index === selectedAnswerIndex)
    if (!answerButton) return

    const label = `+${gained}`
    const startX = answerButton.button.x + answerButton.width / 2
    const startY = answerButton.button.y - 6

    const popup = this.makeText(startX, startY, label, {
      fontFamily: FONT_FAMILY,
      fontSize: '22px',
      color: this.colorToHex(COLORS.correct),
      fontStyle: 'bold',
      stroke: '#ffffff',
      strokeThickness: 3,
    })
      .setOrigin(0.5, 1)
      .setDepth(50)

    const clampedX = Phaser.Math.Clamp(
      startX,
      answerButton.button.x + popup.width / 2 + 8,
      answerButton.button.x + answerButton.width - popup.width / 2 - 8
    )
    popup.setX(clampedX)

    this.tweens.add({
      targets: popup,
      y: startY - 14,
      alpha: { from: 1, to: 0 },
      duration: 1250,
      ease: 'Quad.out',
      onComplete: () => popup.destroy(),
    })
  }

  shouldShowAd() {
    return this.questionsSinceAd >= ANSWERS_BEFORE_AD
  }

  // Полноэкранная реклама через SDK (требования 1.5, 4.7). Платформа рисует блок
  // сама — своего оверлея не строим. Перед показом ставим геймплей на паузу,
  // после закрытия (или ошибки) продолжаем. wasShown=false при троттлинге — норма.
  showAd() {
    this.answerState = 'adShown'
    this.questionsSinceAd = 0

    this.logEvent('ad_requested', { answeredCount: this.answeredCount })

    this.ysdk?.features?.GameplayAPI?.stop?.()
    this.muteSound()

    let resumed = false
    const resume = (wasShown) => {
      if (resumed) return
      resumed = true
      this.afterAd(wasShown)
    }

    if (!this.ysdk?.adv?.showFullscreenAdv) {
      resume(false)
      return
    }

    this.ysdk.adv.showFullscreenAdv({
      callbacks: {
        onClose: (wasShown) => resume(wasShown),
        onError: () => resume(false),
      },
    })
  }

  afterAd(wasShown) {
    this.logEvent('ad_closed', { wasShown: !!wasShown, answeredCount: this.answeredCount })
    this.unmuteSound()
    this.ysdk?.features?.GameplayAPI?.start?.()
    this.goToNextQuestion()
  }

  highlightAnswers(selectedAnswerIndex, correctAnswerIndex, isCorrect) {
    if (this.isArcadeUi()) {
      this.highlightArcadeAnswers(selectedAnswerIndex, correctAnswerIndex, isCorrect)
      return
    }

    this.answerButtons.forEach(({ index, button, label, width, height }) => {
      button.disableInteractive()

      if (index === correctAnswerIndex) {
        this.drawRoundedBox(button, width, height, COLORS.correct, {
          radius: RADIUS.answerButton,
          strokeColor: 0x038d63,
          strokeWidth: 2,
        })
        button.setAlpha(1)
        label.setColor('#ffffff')
        return
      }

      if (index === selectedAnswerIndex && !isCorrect) {
        this.drawRoundedBox(button, width, height, COLORS.wrong, {
          radius: RADIUS.answerButton,
          strokeColor: 0xe85f64,
          strokeWidth: 2,
        })
        button.setAlpha(1)
        label.setColor('#ffffff')
        return
      }

      this.drawRoundedBox(button, width, height, COLORS.surface, {
        radius: RADIUS.answerButton,
        strokeColor: COLORS.borderSoft,
        strokeWidth: 1,
      })

      button.setAlpha(0.5)
      label.setColor(this.colorToHex(COLORS.textSoft))
    })
  }

  highlightArcadeAnswers(selectedAnswerIndex, correctAnswerIndex, isCorrect) {
    this.answerButtons.forEach(({ index, button, label, badge, badgeText, width, height }) => {
      button.disableInteractive()
      const visualTargets = [button, badge, badgeText, label].filter(Boolean)

      if (index === correctAnswerIndex) {
        this.drawArcadeButtonSurface(button, width, height, 'correct')
        label.setColor('#ffffff')
        badge?.clear()
        badge?.fillStyle(0x047857, 1)
        badge?.fillRoundedRect(0, 0, 36, 36, 12)
        badgeText?.setColor('#ffffff')
        if (isCorrect) {
          this.tweens.add({
            targets: visualTargets,
            scaleX: { from: 1, to: 1.035 },
            scaleY: { from: 1, to: 1.035 },
            duration: 130,
            yoyo: true,
            ease: 'Sine.out',
          })
        }
        return
      }

      if (index === selectedAnswerIndex && !isCorrect) {
        this.drawArcadeButtonSurface(button, width, height, 'wrong')
        label.setColor('#ffffff')
        badge?.clear()
        badge?.fillStyle(0xbe123c, 1)
        badge?.fillRoundedRect(0, 0, 36, 36, 12)
        badgeText?.setColor('#ffffff')
        this.tweens.add({
          targets: visualTargets,
          x: `+=${ARCADE_WRONG_SHAKE_X}`,
          duration: ARCADE_WRONG_SHAKE_DURATION_MS,
          yoyo: true,
          repeat: ARCADE_WRONG_SHAKE_REPEAT,
          ease: 'Sine.inOut',
        })
        return
      }

      this.drawArcadeButtonSurface(button, width, height, 'disabled')
      button.setAlpha(0.72)
      badge?.setAlpha(0.55)
      badgeText?.setAlpha(0.72)
      label.setColor(this.colorToHex(ARCADE.disabledText))
      label.setAlpha(0.82)
    })
  }

  showError(message) {
    this.makeText(GAME_WIDTH / 2, GAME_HEIGHT / 2, message, {
      fontFamily: FONT_FAMILY,
      fontSize: '24px',
      color: this.colorToHex(COLORS.wrong),
      fontStyle: 'bold',
    }).setOrigin(0.5)
  }
}

// Чёткость на любом экране: рендерим во внутренний буфер высокого разрешения,
// а не в базовый 1120×640, который потом растягивается браузером (отсюда размытие,
// особенно на Retina). RESOLUTION = во сколько раз буфер крупнее логической сетки.
// Считаем от реального размера окна × плотности пикселей дисплея.
// Подкрутить качество/производительность: меняй нижнюю (2) и верхнюю (4) границы.
const DEVICE_PIXEL_RATIO = window.devicePixelRatio || 1
const FIT_SCALE = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT)
const RESOLUTION = Math.min(Math.max(Math.ceil(FIT_SCALE * DEVICE_PIXEL_RATIO), 2), 4)

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH * RESOLUTION,
  height: GAME_HEIGHT * RESOLUTION,
  parent: 'app',
  backgroundColor: COLORS.pageBackground,
  scene: GameScene,
  render: {
    antialias: true,
    roundPixels: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
}

// Фон страницы (пилларбокс по краям центрированного канваса) — тем же градиентом,
// что и в игре. Иначе на широком окне справа видна полоса: голубой фон body
// упирается в сиреневый край канваса (заметно в Chrome, в Safari окно у́же).
const toCssHex = (color) => `#${color.toString(16).padStart(6, '0')}`
document.body.style.background =
  UI_VARIANT === UI_VARIANTS.arcade
    ? `radial-gradient(circle at 20% 15%, ${toCssHex(ARCADE.bg3)}, transparent 34%), linear-gradient(135deg, ${toCssHex(ARCADE.bg1)}, ${toCssHex(ARCADE.bg2)})`
    : `linear-gradient(to right, ${toCssHex(BG_GRADIENT_LEFT)}, ${toCssHex(BG_GRADIENT_RIGHT)})`

// Явно грузим веса Roboto до старта Phaser. document.fonts.ready недостаточно:
// Chrome не инициирует загрузку @font-face, пока шрифт никто не «использует»
// в DOM (canvas не считается), и промис резолвится до загрузки — отсюда Arial.
// SDK поднимаем параллельно со шрифтами — initYsdk() никогда не бросает (вернёт
// mock вне платформы). Кладём фасад в реестр игры: сцена берёт его как
// this.registry.get('ysdk'). Игра стартует даже если SDK не поднялся.
Promise.all([
  document.fonts.load('400 1em "Roboto"'),
  document.fonts.load('500 1em "Roboto"'),
  document.fonts.load('700 1em "Roboto"'),
])
  .catch(() => {})
  .then(() => initYsdk())
  .then((ysdk) => {
    const game = new Phaser.Game(config)
    game.registry.set('ysdk', ysdk)
  })
