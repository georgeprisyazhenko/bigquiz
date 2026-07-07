// Регресс-гард: превью карточки в админке (src/admin) ДОЛЖНО отображать вопрос так же,
// как игра (src/main.js). Превью — отдельная DOM-реализация, поэтому правила отображения
// легко «теряются» при правках. Полноценную верстку в node не отрендерить, но ключевые
// инварианты (те, что уже ломались) можно стеречь по исходникам. Ломается тест → ты внёс
// расхождение с продом. Новое правило показа — добавляй сюда ассерт. См. docs/rules-map.md.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(ROOT, 'src', 'admin', 'admin.css'), 'utf8')
const adminJs = readFileSync(join(ROOT, 'src', 'admin', 'admin.js'), 'utf8')
const gameJs = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8')

// тело CSS-правила по имени класса
const cssBlock = (name) => (css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`)) || ['', ''])[1]

describe('превью админки = отображение игры (регресс-гард)', () => {
  it('перенос текста ТОЛЬКО по словам — без авто-дефиса (игра так не делает)', () => {
    expect(css).not.toMatch(/hyphens\s*:\s*auto/i) // нигде в админке
    const ans = cssBlock('game-answer-text')
    expect(ans).toMatch(/hyphens\s*:\s*none/i)
    expect(ans).toMatch(/overflow-wrap\s*:\s*normal/i)
  })

  it('шрифт ответов в превью НЕ ужимается (не влезает → переформулировать)', () => {
    expect(adminJs).not.toMatch(/fitAnswerText/)
    expect(adminJs).not.toMatch(/\.style\.fontSize\s*=/)
  })

  it('ответы в превью держат текущие продовые ограничения arcade UI', () => {
    const ansGrid = cssBlock('game-answers')
    const ans = cssBlock('game-answer')
    const text = cssBlock('game-answer-text')

    expect(ansGrid).toMatch(/gap:\s*14px 20px/)
    expect(ans).toMatch(/min-height:\s*62px/)
    expect(ans).toMatch(/align-items:\s*center/)
    expect(text).toMatch(/font-size:\s*17px/)
    expect(text).toMatch(/-webkit-line-clamp:\s*2/)
    expect(text).toMatch(/line-clamp:\s*2/)
  })

  it('превью держит текущую arcade-геометрию вопроса и не показывает картинку', () => {
    const grid = cssBlock('review-grid')
    const card = cssBlock('game-card')
    const question = cssBlock('game-question')
    const gamePreviewBody = adminJs.match(/function gamePreview\(q\) \{([\s\S]*?)\n\}/)?.[1] || ''

    expect(grid).toMatch(/grid-template-columns:\s*624px minmax\(0, 1fr\)/)
    expect(card).toMatch(/width:\s*624px/)
    expect(card).toMatch(/padding:\s*35px/)
    expect(question).toMatch(/font-size:\s*24px/)
    expect(question).toMatch(/margin-bottom:\s*42px/)
    expect(gamePreviewBody).not.toMatch(/gameImage\(/)
  })

  it('игра тоже не ужимает шрифт ответов (makeAnswerLabel без setFontSize)', () => {
    expect(gameJs).not.toMatch(/setFontSize/)
  })

  it('превью использует общий card-rules (порядок ответов, картинка) — без дубля логики', () => {
    expect(adminJs).toMatch(/from '\.\.\/card-rules\.js'/)
    expect(gameJs).toMatch(/from '\.\/card-rules\.js'/)
  })
})
