// Локальная админка ревью вопросов BigQuiz (только dev, см. admin.html).
// Чистый DOM, без Phaser. Два источника: ПРОД (public/questions.json, в игре) и
// ПУЛ (data/review-pool.json, на ревью). Грузит дерево категорий и оба набора,
// даёт проваливаться в ветку, листать карточки и ставить вердикт.
//
// Карточка: LLM-вердикт (read-only) · мой вердикт (Хорошо/На доработку/На выброс) ·
// Проблема и Предложение (пишу только я) · причины-чипы.
// Кнопки-батч: перенести ОК в прод · удалить дропы · отправить на доработку.
// Сохранение в нужный файл через dev-плагин Vite (scripts/lib/review-store.mjs).

import { orderAnswers, imageCandidatePaths } from '../card-rules.js'
import { validateAnswerText } from '../content-rules.js'

const ALL = '__all__'

// Причины «На доработку / На выброс» — маппинг на наш свод правил (1 клик, мультивыбор).
const TAGS = [
  ['distractors', 'Плохие дистракторы'],
  ['leak', 'Ответ виден в вопросе'],
  ['banal', 'Банально'],
  ['niche', 'Ультраниша'],
  ['label', 'Ярлык, не факт'],
  ['myth', 'Миф / неверно'],
  ['wording', 'Кривая формулировка'],
  ['boring', 'Скучно, не цепляет'],
  ['language', 'Язык / тире'],
  ['prohibited', 'Запрещено ЯИ']
]

const STATUS_LABEL = { approved: 'Хорошо', rework: 'На доработку', discard: 'На выброс', pending: 'не смотрел' }

const state = {
  categories: [],
  questions: [],
  catIndex: new Map(),
  selectedNode: ALL,
  statusFilter: 'all',
  sourceFilter: 'all',
  view: 'list',
  currentId: null,
  editing: null,
  expanded: new Set(),
  saveState: 'idle'
}

// ---------- localStorage-страховка отметок ----------
const LS_KEY = 'bigquiz-admin-review'
const lsLoad = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} } }
const lsWrite = (all) => { try { localStorage.setItem(LS_KEY, JSON.stringify(all)) } catch {} }
function lsSaveMark(q) {
  const all = lsLoad()
  all.ours = all.ours || {}
  const empty = (!q.reviewStatus || q.reviewStatus === 'pending') &&
    !(q.reviewProblem || '').trim() && !(q.reviewSuggestion || '').trim() && !(q.reviewTags || []).length
  if (empty) delete all.ours[q.id]
  else all.ours[q.id] = {
    reviewStatus: q.reviewStatus,
    reviewProblem: q.reviewProblem || '',
    reviewSuggestion: q.reviewSuggestion || '',
    reviewTags: q.reviewTags || []
  }
  lsWrite(all)
}

const $tree = document.getElementById('tree-panel')
const $main = document.getElementById('main-panel')

// ---------- Загрузка ----------
async function boot() {
  const [cats, prod, pool] = await Promise.all([
    fetch('/categories.json').then((r) => r.json()),
    fetch('/questions.json').then((r) => r.json()),
    fetch('/__admin/pool').then((r) => r.json()).catch(() => ({ questions: [] }))
  ])
  state.categories = cats.categories || []
  const tag = (arr, source) => (arr || []).map((q) => ({
    ...q, _source: source, reviewStatus: q.reviewStatus || 'pending', reviewTags: q.reviewTags || []
  }))
  state.questions = [...tag(prod.questions, 'prod'), ...tag(pool.questions, 'pool')]
  buildCatIndex()
  restoreFromLocal()
  renderAll()
}

async function reload() {
  const keepNode = state.selectedNode, keepFilter = state.statusFilter, keepView = state.view, keepSrc = state.sourceFilter
  await boot()
  state.selectedNode = keepNode; state.statusFilter = keepFilter; state.view = keepView; state.sourceFilter = keepSrc
  renderAll()
}

function restoreFromLocal() {
  const ls = lsLoad()
  const marks = ls.ours
  if (!marks) return
  const toResync = []
  const byId = new Map(state.questions.map((q) => [q.id, q]))
  for (const [id, m] of Object.entries(marks)) {
    const q = byId.get(id)
    if (!q) continue
    const changed = q.reviewStatus !== (m.reviewStatus || 'pending') ||
      (q.reviewProblem || '') !== (m.reviewProblem || '') ||
      (q.reviewSuggestion || '') !== (m.reviewSuggestion || '') ||
      (q.reviewTags || []).join(',') !== (m.reviewTags || []).join(',')
    q.reviewStatus = m.reviewStatus || 'pending'
    q.reviewProblem = m.reviewProblem || ''
    q.reviewSuggestion = m.reviewSuggestion || ''
    q.reviewTags = m.reviewTags || []
    if (changed) toResync.push(q)
  }
  for (const q of toResync) scheduleSave(q)
  if (toResync.length) flushSaves()
}

function buildCatIndex() {
  state.catIndex.clear()
  for (const top of state.categories) {
    const memberIds = new Set([top.id])
    for (const sub of top.subcategories || []) {
      memberIds.add(sub.id)
      state.catIndex.set(sub.id, { type: 'sub', name: sub.name, topId: top.id, memberIds: new Set([sub.id]) })
    }
    state.catIndex.set(top.id, { type: 'top', name: top.name, topId: top.id, memberIds })
  }
}

// ---------- Выборки ----------
function matchesNode(q, nodeId) {
  if (nodeId === ALL) return true
  const node = state.catIndex.get(nodeId)
  if (!node) return false
  return (q.categories || []).some((c) => node.memberIds.has(c))
}

function statusOf(q) { return q.reviewStatus || 'pending' }

function filteredQuestions() {
  return state.questions.filter((q) =>
    matchesNode(q, state.selectedNode) &&
    (state.statusFilter === 'all' || statusOf(q) === state.statusFilter) &&
    (state.sourceFilter === 'all' || q._source === state.sourceFilter)
  )
}

function counts(nodeId) {
  const c = { total: 0, approved: 0, pending: 0, rework: 0, discard: 0, prod: 0 }
  for (const q of state.questions) {
    if (!matchesNode(q, nodeId)) continue
    c.total++
    c[statusOf(q)] = (c[statusOf(q)] || 0) + 1
    if (q._source === 'prod') c.prod++
  }
  return c
}

// ---------- Рендер ----------
function renderAll() { renderTree(); renderMain() }

function renderTree() {
  const frag = document.createElement('div')
  const title = document.createElement('div')
  title.className = 'tree-title'
  title.textContent = 'Категории'
  frag.appendChild(title)
  frag.appendChild(treeNode({ id: ALL, label: 'Все вопросы', level: 'top' }))
  for (const top of state.categories) {
    const isOpen = state.expanded.has(top.id)
    frag.appendChild(
      treeNode({
        id: top.id, label: top.name, level: 'top',
        twisty: (top.subcategories || []).length ? (isOpen ? '−' : '+') : '',
        onTwisty: () => { if (isOpen) state.expanded.delete(top.id); else state.expanded.add(top.id); renderTree() }
      })
    )
    const children = document.createElement('div')
    children.className = 'tree-children' + (isOpen ? '' : ' collapsed')
    for (const sub of top.subcategories || []) children.appendChild(treeNode({ id: sub.id, label: sub.name, level: 'sub' }))
    frag.appendChild(children)
  }
  $tree.replaceChildren(frag)
}

function treeNode({ id, label, level, twisty = '', onTwisty }) {
  const c = counts(id)
  const node = document.createElement('div')
  node.className = 'tree-node ' + (level === 'sub' ? 'sub' : '') + (state.selectedNode === id ? ' active' : '')
  const tw = document.createElement('span')
  tw.className = 'twisty'
  tw.textContent = twisty
  if (onTwisty) { tw.style.cursor = 'pointer'; tw.addEventListener('click', (e) => { e.stopPropagation(); onTwisty() }) }
  node.appendChild(tw)
  const lbl = document.createElement('span')
  lbl.className = 'label'
  lbl.textContent = label
  node.appendChild(lbl)
  const badge = document.createElement('span')
  const unreviewed = c.pending
  badge.className = 'count-badge' + (unreviewed === 0 && c.total > 0 ? ' all-ok' : unreviewed ? ' has-pending' : '')
  badge.textContent = `${c.prod}/${c.total}`
  badge.title = `${c.prod} в проде · ${c.total} всего`
  node.appendChild(badge)
  node.addEventListener('click', () => { state.selectedNode = id; state.currentId = null; renderAll() })
  return node
}

function renderMain() { $main.replaceChildren(renderTopbar(), renderContent()) }

function renderTopbar() {
  const bar = document.createElement('div')
  bar.className = 'topbar'
  const h1 = document.createElement('h1')
  h1.textContent = 'BigQuiz · ревью'
  bar.appendChild(h1)
  const g = counts(state.selectedNode)
  const prog = document.createElement('div')
  prog.className = 'progress'
  prog.innerHTML =
    `<span><span class="dot ok"></span><b>${g.approved}</b> хорошо</span>` +
    `<span><span class="dot rework"></span><b>${g.rework}</b> доработка</span>` +
    `<span><span class="dot no"></span><b>${g.discard}</b> выброс</span>` +
    `<span><span class="dot pending"></span><b>${g.pending}</b> не смотрел</span>` +
    `<span>· <b>${g.prod}</b> в проде</span>`
  bar.appendChild(prog)
  const spacer = document.createElement('div')
  spacer.className = 'spacer'
  bar.appendChild(spacer)
  bar.appendChild(batchBar())
  bar.appendChild(
    segmented(
      [['all', 'Все'], ['pending', 'Не смотрел'], ['approved', 'Хорошо'], ['rework', 'Доработка'], ['discard', 'Выброс']],
      state.statusFilter,
      (v) => { state.statusFilter = v; state.currentId = null; renderMain() }
    )
  )
  bar.appendChild(
    segmented(
      [['all', 'Прод+пул'], ['prod', 'Прод'], ['pool', 'Пул']],
      state.sourceFilter,
      (v) => { state.sourceFilter = v; state.currentId = null; renderMain() }
    )
  )
  bar.appendChild(
    segmented([['list', 'Список'], ['review', 'Ревью']], state.view, (v) => { state.view = v; renderMain() })
  )
  const save = document.createElement('div')
  save.className = 'save-state ' + state.saveState
  save.id = 'save-state'
  save.textContent = saveLabel(state.saveState)
  bar.appendChild(save)
  return bar
}

function batchBar() {
  const wrap = document.createElement('div')
  wrap.className = 'batch'
  const g = counts(ALL)
  wrap.appendChild(batchBtn(`В прод (${g.approved})`, 'promote',
    `Перенести все «Хорошо» из пула в прод? Будет перенесено: ${g.approved}.`, '/__admin/promote',
    (r) => `Перенесено в прод: ${r.moved}${r.blocked && r.blocked.length ? ` · заблокировано гейтом: ${r.blocked.length}` : ''}`))
  wrap.appendChild(batchBtn(`На доработку (${g.rework})`, 'rework',
    `Выгрузить ${g.rework} вопросов на доработку в scripts/polish-in? Дальше прогонишь воркфлоу polish.`, '/__admin/export-rework',
    (r) => `Выгружено на доработку: ${r.count} (${r.files} файлов). Запусти воркфлоу polish.`))
  wrap.appendChild(batchBtn(`Удалить дропы (${g.discard})`, 'drop',
    `Удалить все «На выброс» из пула? Удалится: ${g.discard}. (Без возможности отмены, бэкап создаётся.)`, '/__admin/delete-drops',
    (r) => `Удалено дропов: ${r.removed}`))
  return wrap
}

function batchBtn(label, kind, confirmMsg, endpoint, resultMsg) {
  const b = document.createElement('button')
  b.className = 'batch-btn ' + kind
  b.textContent = label
  b.addEventListener('click', async () => {
    if (!confirm(confirmMsg)) return
    b.disabled = true
    try {
      await flushSaves()
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const r = await res.json()
      if (!r.ok) throw new Error(r.error || 'ошибка')
      toast(resultMsg(r))
      await reload()
    } catch (err) {
      toast('Ошибка: ' + String(err.message || err), true)
      b.disabled = false
    }
  })
  return b
}

function toast(msg, isError) {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t) }
  t.className = 'toast' + (isError ? ' error' : '') + ' show'
  t.textContent = msg
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { t.className = 'toast' + (isError ? ' error' : '') }, 4000)
}

function saveLabel(s) { return s === 'saving' ? 'Сохранение…' : s === 'saved' ? 'Сохранено' : s === 'error' ? 'Ошибка' : '' }

function segmented(options, current, onPick) {
  const seg = document.createElement('div')
  seg.className = 'seg'
  for (const [value, label] of options) {
    const b = document.createElement('button')
    b.textContent = label
    if (value === current) b.className = 'active'
    b.addEventListener('click', () => onPick(value))
    seg.appendChild(b)
  }
  return seg
}

function renderContent() {
  const wrap = document.createElement('div')
  wrap.className = 'content'
  wrap.id = 'content'
  const list = filteredQuestions()
  if (!list.length) {
    const e = document.createElement('div')
    e.className = 'empty'
    e.textContent = 'Нет вопросов под текущим фильтром.'
    wrap.appendChild(e)
    return wrap
  }
  if (state.view === 'list') {
    for (const q of list) wrap.appendChild(listRow(q))
  } else {
    wrap.appendChild(reviewCard(list))
  }
  return wrap
}
renderContent.replaceInMain = function () {
  const old = document.getElementById('content')
  if (old) old.replaceWith(renderContent())
  else renderMain()
}

function sourcePill(source) {
  const p = document.createElement('span')
  p.className = 'src-pill ' + source
  p.textContent = source === 'prod' ? 'прод' : 'пул'
  return p
}

function verdictPill(verdict) {
  if (!verdict) return null
  const p = document.createElement('span')
  p.className = 'verdict-pill ' + verdict
  p.textContent = 'LLM: ' + verdict
  return p
}

function listRow(q) {
  const row = document.createElement('div')
  row.className = 'q-row'
  const id = document.createElement('span')
  id.className = 'q-id'
  id.textContent = q.id
  row.appendChild(id)
  row.appendChild(sourcePill(q._source))
  const text = document.createElement('span')
  text.className = 'q-text'
  text.textContent = q.question
  row.appendChild(text)
  const vp = verdictPill(q.llmVerdict)
  if (vp) row.appendChild(vp)
  row.appendChild(statusPill(statusOf(q)))
  row.addEventListener('click', () => { state.currentId = q.id; state.view = 'review'; renderMain() })
  return row
}

function statusPill(status) {
  const p = document.createElement('span')
  p.className = 'status-pill ' + status
  p.textContent = STATUS_LABEL[status] || status
  return p
}

function reviewCard(list) {
  let idx = list.findIndex((q) => q.id === state.currentId)
  if (idx < 0) idx = 0
  const q = list[idx]
  state.currentId = q.id

  const review = document.createElement('div')
  review.className = 'review'

  const nav = document.createElement('div')
  nav.className = 'review-nav'
  const prev = btn('← Назад', () => goTo(list, idx - 1))
  const next = btn('Вперёд →', () => goTo(list, idx + 1))
  prev.disabled = idx === 0
  next.disabled = idx === list.length - 1
  const counter = document.createElement('span')
  counter.className = 'counter'
  counter.textContent = `${idx + 1} / ${list.length}`
  nav.append(prev, next, counter)
  review.appendChild(nav)

  const grid = document.createElement('div')
  grid.className = 'review-grid'

  // ЛЕВО: превью как на проде (или форма ручной правки в том же месте)
  const left = document.createElement('div')
  left.className = 'preview-pane'
  if (state.editing === q.id) {
    const editCard = document.createElement('div')
    editCard.className = 'game-card edit-card'
    appendEditForm(editCard, q)
    left.appendChild(editCard)
  } else {
    left.appendChild(gamePreview(q))
  }
  grid.appendChild(left)

  // ПРАВО: вся ревью-обвязка
  grid.appendChild(reviewPane(q))
  review.appendChild(grid)
  return review
}

// Превью вопроса в пропорциях прода (категория · вопрос · картинка 4:3 · ответы 2×2),
// в админских (тёмных) цветах. Верный ответ подсвечен.
function gamePreview(q) {
  const card = document.createElement('div')
  card.className = 'game-card'

  const cats = document.createElement('div')
  cats.className = 'game-cats'
  for (const c of q.categories || []) {
    const chip = document.createElement('span')
    chip.className = 'game-chip'
    const known = state.catIndex.get(c)
    chip.textContent = known ? known.name : c
    cats.appendChild(chip)
  }
  card.appendChild(cats)

  const ques = document.createElement('div')
  ques.className = 'game-question'
  ques.textContent = q.question
  card.appendChild(ques)

  card.appendChild(gameImage(q))

  // Порядок ответов — те же правила, что в игре (src/card-rules.js): числа по убыванию,
  // нечисловые перемешаны (seed по id — стабильно, но верный не всегда первый, как на проде).
  // Подсветки верного НЕТ — на проде в исходном состоянии карточки её тоже нет
  // (иначе ответ виден). Какой верный — показано справа.
  const display = orderAnswers(q, { seed: q.id })
  const ans = document.createElement('div')
  ans.className = 'game-answers'
  ;(display.answers || []).forEach((a) => {
    const el = document.createElement('div')
    el.className = 'game-answer'
    const sp = document.createElement('span')
    sp.className = 'game-answer-text'
    sp.textContent = a
    el.appendChild(sp)
    ans.appendChild(el)
  })
  card.appendChild(ans)
  // Ужать шрифт ответов до ≤2 строк (как makeAnswerLabel в игре) — после вставки в DOM.
  requestAnimationFrame(() => ans.querySelectorAll('.game-answer-text').forEach(fitAnswerText))
  return card
}

// Повторяет makeAnswerLabel: уменьшает шрифт с 17px до 11px, пока текст не влезет в 2 строки.
function fitAnswerText(span) {
  let size = 17
  span.style.fontSize = size + 'px'
  const twoLines = () => Math.ceil((parseFloat(getComputedStyle(span).lineHeight) || size * 1.2) * 2) + 1
  while (size > 11 && span.scrollHeight > twoLines()) {
    size -= 1
    span.style.fontSize = size + 'px'
  }
}

function imageCandidates(q) {
  return imageCandidatePaths(q.image || ('assets/images/' + q.id))
}

// Картинка с перебором расширений (как в игре: .webp первым). Плейсхолдеры —
// той же формулировкой, что в игре (renderQuestionImage): «изображение не указано»
// если поля нет, «изображение не загрузилось» если ни один файл не открылся.
function gameImage(q) {
  const wrap = document.createElement('div')
  wrap.className = 'game-image'
  const placeholder = (msg) => {
    wrap.classList.add('empty')
    wrap.replaceChildren()
    const ph = document.createElement('span')
    ph.className = 'game-image-ph'
    ph.textContent = msg
    wrap.appendChild(ph)
  }
  if (!q.image) { placeholder('изображение не указано'); return wrap }
  const cands = imageCandidates(q)
  let i = 0
  const img = document.createElement('img')
  img.alt = ''
  img.addEventListener('error', () => {
    i++
    if (i < cands.length) { img.src = cands[i]; return }
    placeholder('изображение не загрузилось')
  })
  img.src = cands[0]
  wrap.appendChild(img)
  return wrap
}

// Правая колонка: статусы, вердикт, проблема/предложение, причины — всё ревью.
function reviewPane(q) {
  const pane = document.createElement('div')
  pane.className = 'review-pane'

  const head = document.createElement('div')
  head.className = 'card-head'
  const qid = document.createElement('span')
  qid.className = 'q-id'
  qid.textContent = q.id
  head.appendChild(qid)
  head.appendChild(sourcePill(q._source))
  const vp = verdictPill(q.llmVerdict)
  if (vp) head.appendChild(vp)
  if (q.reworkedAt) {
    const badge = document.createElement('span')
    badge.className = 'rework-badge'
    badge.textContent = '↻ прошёл доработку'
    head.appendChild(badge)
  }
  pane.appendChild(head)

  // Верный ответ — на превью слева не подсвечен (как на проде), поэтому показываем здесь.
  const correct = (q.answers || [])[q.correctAnswerIndex]
  if (correct != null) {
    const ca = document.createElement('div')
    ca.className = 'correct-answer'
    ca.textContent = '✓ Верный ответ: ' + correct
    pane.appendChild(ca)
  }

  // Контент-гейт длины (src/content-rules.js): ответы вне лимита на проде мельчают —
  // повод на доработку. Предупреждение здесь, чтобы превью слева осталось как на проде.
  const tooLong = (q.answers || []).filter((a) => !validateAnswerText(a).ok)
  if (tooLong.length) {
    const w = document.createElement('div')
    w.className = 'answer-warning'
    w.textContent = '⚠ Ответ длиннее лимита (≤5 слов / ≤44 симв.): ' + tooLong.map((a) => `«${a}»`).join(', ')
    pane.appendChild(w)
  }

  if (q.llmReason) {
    const reason = document.createElement('div')
    reason.className = 'llm-reason'
    reason.textContent = 'Судья: ' + q.llmReason
    pane.appendChild(reason)
  }

  if (q.explanation) {
    const ex = document.createElement('div')
    ex.className = 'explanation'
    ex.textContent = q.explanation
    pane.appendChild(ex)
  }

  if (q.reworkNote) {
    const rn = document.createElement('div')
    rn.className = 'rework-note'
    rn.textContent = 'Доработка: ' + q.reworkNote
    pane.appendChild(rn)
  }

  if (q.preReworkVersion) {
    const det = document.createElement('details')
    det.className = 'was'
    const sum = document.createElement('summary')
    sum.textContent = 'Было до доработки'
    det.appendChild(sum)
    const body = document.createElement('div')
    body.className = 'was-body'
    const wq = document.createElement('div')
    wq.className = 'was-q'
    wq.textContent = q.preReworkVersion.question
    body.appendChild(wq)
    const wa = document.createElement('div')
    wa.className = 'was-a'
    wa.textContent = (q.preReworkVersion.answers || []).join(' · ')
    body.appendChild(wa)
    if (q.preReworkVersion.reviewProblem) {
      const wp = document.createElement('div')
      wp.className = 'was-changed'
      wp.textContent = 'Проблема была: ' + q.preReworkVersion.reviewProblem
      body.appendChild(wp)
    }
    det.appendChild(body)
    pane.appendChild(det)
  }

  // Мой вердикт
  const actions = document.createElement('div')
  actions.className = 'actions'
  const status = statusOf(q)
  actions.appendChild(verdictBtn(q, 'approved', '✓ Хорошо', 'btn-ok', status))
  actions.appendChild(verdictBtn(q, 'rework', '↻ На доработку', 'btn-rework', status))
  actions.appendChild(verdictBtn(q, 'discard', '✗ На выброс', 'btn-no', status))
  const editBtn = document.createElement('button')
  editBtn.className = 'btn btn-edit'
  editBtn.textContent = state.editing === q.id ? '✕ Отмена' : '✎ Редактировать'
  editBtn.addEventListener('click', () => { state.editing = state.editing === q.id ? null : q.id; renderContent.replaceInMain() })
  actions.appendChild(editBtn)
  pane.appendChild(actions)

  // Причины-чипы
  const tagsLabel = document.createElement('div')
  tagsLabel.className = 'field-label'
  tagsLabel.textContent = 'Причины (для доработки / выброса)'
  pane.appendChild(tagsLabel)
  const tagsWrap = document.createElement('div')
  tagsWrap.className = 'tag-chips'
  for (const [key, label] of TAGS) {
    const chip = document.createElement('button')
    const on = (q.reviewTags || []).includes(key)
    chip.className = 'tag-chip' + (on ? ' on' : '')
    chip.textContent = label
    chip.addEventListener('click', () => {
      const set = new Set(q.reviewTags || [])
      if (set.has(key)) set.delete(key); else set.add(key)
      q.reviewTags = [...set]
      chip.classList.toggle('on')
      scheduleSave(q)
    })
    tagsWrap.appendChild(chip)
  }
  pane.appendChild(tagsWrap)

  // Проблема (пишу только я)
  const probLabel = document.createElement('div')
  probLabel.className = 'field-label'
  probLabel.textContent = 'Проблема — что не так'
  pane.appendChild(probLabel)
  const problem = document.createElement('textarea')
  problem.className = 'note-field'
  problem.placeholder = 'Что именно не так (увижу при доработке).'
  problem.value = q.reviewProblem || ''
  problem.addEventListener('input', () => { q.reviewProblem = problem.value; scheduleSave(q) })
  problem.addEventListener('blur', () => flushSaves())
  pane.appendChild(problem)

  // Предложение (пишу только я)
  const sugLabel = document.createElement('div')
  sugLabel.className = 'field-label'
  sugLabel.textContent = 'Предложение — как починить'
  pane.appendChild(sugLabel)
  const suggestion = document.createElement('textarea')
  suggestion.className = 'note-field'
  suggestion.placeholder = 'Как бы я это переделал.'
  suggestion.value = q.reviewSuggestion || ''
  suggestion.addEventListener('input', () => { q.reviewSuggestion = suggestion.value; scheduleSave(q) })
  suggestion.addEventListener('blur', () => flushSaves())
  pane.appendChild(suggestion)

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.innerHTML = 'Клавиши: <kbd>←</kbd> <kbd>→</kbd> листать · <kbd>A</kbd> хорошо · <kbd>R</kbd> доработка · <kbd>D</kbd> выброс'
  pane.appendChild(hint)

  return pane
}

function labeled(text, el) {
  const wrap = document.createElement('div')
  const lab = document.createElement('div')
  lab.className = 'field-label'
  lab.textContent = text
  wrap.append(lab, el)
  return wrap
}

function appendEditForm(card, q) {
  const form = document.createElement('div')
  form.className = 'edit-form'
  const qa = document.createElement('textarea')
  qa.className = 'note-field edit-question'
  qa.value = q.question
  form.appendChild(labeled('Вопрос', qa))

  const ansWrap = document.createElement('div')
  ansWrap.className = 'edit-answers'
  const inputs = []
  ;(q.answers || ['', '', '', '']).forEach((a, i) => {
    const row = document.createElement('div')
    row.className = 'edit-answer-row'
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'correct-' + q.id
    radio.checked = i === q.correctAnswerIndex
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.value = a
    inp.className = 'edit-answer'
    inputs.push({ radio, inp })
    row.append(radio, inp)
    ansWrap.appendChild(row)
  })
  form.appendChild(labeled('Ответы (точка — правильный)', ansWrap))

  const exa = document.createElement('textarea')
  exa.className = 'note-field edit-explanation'
  exa.value = q.explanation || ''
  form.appendChild(labeled('Пояснение', exa))

  const bar = document.createElement('div')
  bar.className = 'edit-bar'
  const save = document.createElement('button')
  save.className = 'btn btn-ok'
  save.textContent = 'Сохранить правку'
  save.addEventListener('click', () => {
    const correctIdx = inputs.findIndex((x) => x.radio.checked)
    saveEdit(q, {
      question: qa.value,
      answers: inputs.map((x) => x.inp.value),
      correctAnswerIndex: correctIdx < 0 ? q.correctAnswerIndex : correctIdx,
      explanation: exa.value
    })
  })
  const cancel = document.createElement('button')
  cancel.className = 'btn btn-no inactive'
  cancel.textContent = 'Отмена'
  cancel.addEventListener('click', () => { state.editing = null; renderContent.replaceInMain() })
  bar.append(save, cancel)
  form.appendChild(bar)
  card.appendChild(form)
}

async function saveEdit(q, fields) {
  try {
    await flushSaves()
    const res = await fetch('/__admin/edit-question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: q.id, ...fields })
    })
    const r = await res.json()
    if (!r.ok) throw new Error(r.error || 'ошибка')
    state.editing = null
    toast(r.gatesOk === false ? 'Сохранено, но не проходит код-гейт — в прод не пустит' : 'Правка сохранена', r.gatesOk === false)
    await reload()
  } catch (err) { toast('Ошибка: ' + String(err.message || err), true) }
}

function verdictBtn(q, value, label, cls, current) {
  const b = document.createElement('button')
  b.className = 'btn ' + cls + (current === value ? ' active' : ' inactive')
  b.textContent = label
  b.addEventListener('click', () => setStatus(q, value))
  return b
}

function goTo(list, i) {
  if (i < 0 || i >= list.length) return
  flushSaves()
  state.editing = null
  state.currentId = list[i].id
  renderContent.replaceInMain()
}

function btn(label, onClick) {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

// ---------- Изменение статуса + сохранение ----------
function setStatus(q, status) {
  const toggleOff = q.reviewStatus === status
  const list = filteredQuestions()
  const idx = list.findIndex((x) => x.id === q.id)
  q.reviewStatus = toggleOff ? 'pending' : status
  state.editing = null
  saveNow(q)
  if (!toggleOff && state.view === 'review' && idx >= 0) {
    const next = list[idx + 1] || list[idx - 1]
    if (next) state.currentId = next.id
  }
  renderTree()
  renderMain()
}

const dirty = new Map()
let saveTimer = null
let flushing = false

function payload(q) {
  return {
    id: q.id,
    reviewStatus: q.reviewStatus,
    reviewProblem: q.reviewProblem || '',
    reviewSuggestion: q.reviewSuggestion || '',
    reviewTags: q.reviewTags || []
  }
}

function scheduleSave(q) {
  lsSaveMark(q)
  dirty.set(q.id, q)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSaves, 400)
}

async function flushSaves() {
  clearTimeout(saveTimer)
  saveTimer = null
  if (flushing || !dirty.size) return
  flushing = true
  setSaveState('saving')
  try {
    while (dirty.size) {
      const [id, q] = dirty.entries().next().value
      dirty.delete(id)
      const res = await fetch('/__admin/save-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(q))
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
    }
    setSaveState('saved')
  } catch (err) {
    console.error('[admin] save failed:', err)
    setSaveState('error')
  } finally {
    flushing = false
    if (dirty.size) flushSaves()
  }
}

function saveNow(q) { scheduleSave(q); return flushSaves() }

function flushBeacon() {
  for (const [, q] of dirty) {
    navigator.sendBeacon('/__admin/save-question', new Blob([JSON.stringify(payload(q))], { type: 'application/json' }))
  }
  dirty.clear()
}
window.addEventListener('beforeunload', flushBeacon)

function setSaveState(s) {
  state.saveState = s
  const el = document.getElementById('save-state')
  if (el) { el.className = 'save-state ' + s; el.textContent = saveLabel(s) }
}

// ---------- Горячие клавиши ----------
document.addEventListener('keydown', (e) => {
  if (state.view !== 'review') return
  if (state.editing) return
  const tag = document.activeElement && document.activeElement.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT') return
  const list = filteredQuestions()
  const idx = list.findIndex((q) => q.id === state.currentId)
  if (idx < 0) return
  const q = list[idx]
  if (e.key === 'ArrowLeft') return goTo(list, idx - 1)
  if (e.key === 'ArrowRight') return goTo(list, idx + 1)
  const k = e.key.toLowerCase()
  if (k === 'a' || k === 'ф') setStatus(q, 'approved')
  else if (k === 'r' || k === 'к') setStatus(q, 'rework')
  else if (k === 'd' || k === 'в') setStatus(q, 'discard')
})

boot().catch((err) => {
  $main.innerHTML = `<div class="content"><div class="empty">Ошибка загрузки: ${String(err)}</div></div>`
})
