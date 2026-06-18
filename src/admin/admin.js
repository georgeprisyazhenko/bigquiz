// Локальная админка ревью вопросов BigQuiz (только dev, см. admin.html).
// Чистый DOM, без Phaser. Грузит дерево категорий и вопросы, даёт проваливаться
// в любую ветку и пролистывать вопросы с отметкой «ок / не ок» + заметка.
// Отметки сохраняются в public/questions.json через dev-плагин Vite.

const ALL = '__all__'

const state = {
  categories: [],
  questions: [],
  catIndex: new Map(), // id -> { type, name, topId, memberIds:Set }
  selectedNode: ALL,
  statusFilter: 'all', // all | pending | approved | rejected
  view: 'list', // list | review
  currentId: null, // id вопроса в режиме ревью
  expanded: new Set(), // раскрытые верхние категории
  saveState: 'idle' // idle | saving | saved | error
}

const $tree = document.getElementById('tree-panel')
const $main = document.getElementById('main-panel')

// ---------- Загрузка ----------
async function boot() {
  const [cats, qs] = await Promise.all([
    fetch('/categories.json').then((r) => r.json()),
    fetch('/questions.json').then((r) => r.json())
  ])
  state.categories = cats.categories || []
  state.questions = (qs.questions || []).map((q) => ({
    ...q,
    reviewStatus: q.reviewStatus || 'pending'
  }))
  buildCatIndex()
  renderAll()
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

function statusOf(q) {
  return q.reviewStatus || 'pending'
}

function filteredQuestions() {
  return state.questions.filter(
    (q) => matchesNode(q, state.selectedNode) && (state.statusFilter === 'all' || statusOf(q) === state.statusFilter)
  )
}

function counts(nodeId) {
  let total = 0
  let approved = 0
  let pending = 0
  for (const q of state.questions) {
    if (!matchesNode(q, nodeId)) continue
    total++
    const s = statusOf(q)
    if (s === 'approved') approved++
    else if (s === 'pending') pending++
  }
  return { total, approved, pending }
}

// ---------- Рендер ----------
function renderAll() {
  renderTree()
  renderMain()
}

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
        id: top.id,
        label: top.name,
        level: 'top',
        twisty: (top.subcategories || []).length ? (isOpen ? '−' : '+') : '',
        onTwisty: () => {
          if (isOpen) state.expanded.delete(top.id)
          else state.expanded.add(top.id)
          renderTree()
        }
      })
    )

    const children = document.createElement('div')
    children.className = 'tree-children' + (isOpen ? '' : ' collapsed')
    for (const sub of top.subcategories || []) {
      children.appendChild(treeNode({ id: sub.id, label: sub.name, level: 'sub' }))
    }
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
  if (onTwisty) {
    tw.style.cursor = 'pointer'
    tw.addEventListener('click', (e) => {
      e.stopPropagation()
      onTwisty()
    })
  }
  node.appendChild(tw)

  const lbl = document.createElement('span')
  lbl.className = 'label'
  lbl.textContent = label
  node.appendChild(lbl)

  const badge = document.createElement('span')
  badge.className = 'count-badge' + (c.pending === 0 && c.total > 0 ? ' all-ok' : c.pending ? ' has-pending' : '')
  badge.textContent = `${c.approved}/${c.total}`
  node.appendChild(badge)

  node.addEventListener('click', () => {
    state.selectedNode = id
    state.currentId = null
    renderAll()
  })
  return node
}

function renderMain() {
  $main.replaceChildren(renderTopbar(), renderContent())
}

function renderTopbar() {
  const bar = document.createElement('div')
  bar.className = 'topbar'

  const h1 = document.createElement('h1')
  h1.innerHTML = 'BigQuiz · <span class="scope">ревью</span>'
  bar.appendChild(h1)

  const g = counts(state.selectedNode)
  const rejected = filteredAllStatus('rejected')
  const prog = document.createElement('div')
  prog.className = 'progress'
  prog.innerHTML =
    `<span><span class="dot ok"></span><b>${g.approved}</b> одобрено</span>` +
    `<span><span class="dot no"></span><b>${rejected}</b> отклонено</span>` +
    `<span><span class="dot pending"></span><b>${g.pending}</b> в ожидании</span>` +
    `<span>из <b>${g.total}</b></span>`
  bar.appendChild(prog)

  const spacer = document.createElement('div')
  spacer.className = 'spacer'
  bar.appendChild(spacer)

  // Фильтр статуса
  bar.appendChild(
    segmented(
      [
        ['all', 'Все'],
        ['pending', 'В ожидании'],
        ['approved', 'Одобрено'],
        ['rejected', 'Отклонено']
      ],
      state.statusFilter,
      (v) => {
        state.statusFilter = v
        state.currentId = null
        renderMain()
      }
    )
  )

  // Вид
  bar.appendChild(
    segmented(
      [
        ['list', 'Список'],
        ['review', 'Ревью']
      ],
      state.view,
      (v) => {
        state.view = v
        renderMain()
      }
    )
  )

  const save = document.createElement('div')
  save.className = 'save-state ' + state.saveState
  save.id = 'save-state'
  save.textContent =
    state.saveState === 'saving' ? 'Сохранение…' : state.saveState === 'saved' ? 'Сохранено' : state.saveState === 'error' ? 'Ошибка' : ''
  bar.appendChild(save)

  return bar
}

function filteredAllStatus(status) {
  return state.questions.filter((q) => matchesNode(q, state.selectedNode) && statusOf(q) === status).length
}

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

// renderContent возвращает узел; helper для частичного апдейта
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
// Перерисовать только область контента (без сброса фокуса в дереве/топбаре)
renderContent.replaceInMain = function () {
  const old = document.getElementById('content')
  if (old) old.replaceWith(renderContent())
  else renderMain()
}

function listRow(q) {
  const row = document.createElement('div')
  row.className = 'q-row'

  const id = document.createElement('span')
  id.className = 'q-id'
  id.textContent = q.id
  row.appendChild(id)

  const text = document.createElement('span')
  text.className = 'q-text'
  text.textContent = q.question
  row.appendChild(text)

  row.appendChild(statusPill(statusOf(q)))

  row.addEventListener('click', () => {
    state.currentId = q.id
    state.view = 'review'
    renderMain()
  })
  return row
}

function statusPill(status) {
  const p = document.createElement('span')
  p.className = 'status-pill ' + status
  p.textContent = status === 'approved' ? 'окей' : status === 'rejected' ? 'не окей' : 'в ожидании'
  return p
}

function reviewCard(list) {
  let idx = list.findIndex((q) => q.id === state.currentId)
  if (idx < 0) idx = 0
  const q = list[idx]
  state.currentId = q.id

  const review = document.createElement('div')
  review.className = 'review'

  // Навигация
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

  // Карточка
  const card = document.createElement('div')
  card.className = 'card'

  const qid = document.createElement('div')
  qid.className = 'q-id'
  qid.textContent = q.id
  card.appendChild(qid)

  const question = document.createElement('div')
  question.className = 'question'
  question.textContent = q.question
  card.appendChild(question)

  const answers = document.createElement('div')
  answers.className = 'answers'
  ;(q.answers || []).forEach((a, i) => {
    const el = document.createElement('div')
    el.className = 'answer' + (i === q.correctAnswerIndex ? ' correct' : '')
    el.textContent = a
    answers.appendChild(el)
  })
  card.appendChild(answers)

  if (q.explanation) {
    const ex = document.createElement('div')
    ex.className = 'explanation'
    ex.textContent = q.explanation
    card.appendChild(ex)
  }

  const meta = document.createElement('div')
  meta.className = 'meta'
  for (const c of q.categories || []) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    const known = state.catIndex.get(c)
    chip.textContent = known ? known.name : c
    meta.appendChild(chip)
  }
  if (q.imageSearchQuery) {
    const chip = document.createElement('span')
    chip.className = 'chip img'
    chip.textContent = '🖼 ' + q.imageSearchQuery
    meta.appendChild(chip)
  }
  card.appendChild(meta)

  // Действия
  const actions = document.createElement('div')
  actions.className = 'actions'
  const status = statusOf(q)
  const okBtn = document.createElement('button')
  okBtn.className = 'btn btn-ok' + (status === 'approved' ? ' active' : ' inactive')
  okBtn.textContent = '✓ Окей'
  okBtn.addEventListener('click', () => setStatus(q, 'approved'))
  const noBtn = document.createElement('button')
  noBtn.className = 'btn btn-no' + (status === 'rejected' ? ' active' : ' inactive')
  noBtn.textContent = '✗ Не окей'
  noBtn.addEventListener('click', () => setStatus(q, 'rejected'))
  actions.append(okBtn, noBtn)
  card.appendChild(actions)

  // Заметка
  const note = document.createElement('textarea')
  note.className = 'note-field'
  note.placeholder = 'Заметка (что не так — увижу при правке). Обязательна для «не окей».'
  note.value = q.reviewNote || ''
  note.addEventListener('input', () => {
    q.reviewNote = note.value
    scheduleSave(q)
  })
  card.appendChild(note)

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.innerHTML = 'Клавиши: <kbd>←</kbd> <kbd>→</kbd> листать · <kbd>A</kbd> окей · <kbd>R</kbd> не окей'
  card.appendChild(hint)

  review.appendChild(card)
  return review
}

function goTo(list, i) {
  if (i < 0 || i >= list.length) return
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
  const toggleOff = q.reviewStatus === status // повторный клик по активному снимает отметку
  const list = filteredQuestions()
  const idx = list.findIndex((x) => x.id === q.id)

  q.reviewStatus = toggleOff ? 'pending' : status
  saveNow(q)

  // Автопереход к следующему вопросу при выставлении отметки (не при снятии).
  if (!toggleOff && state.view === 'review' && idx >= 0) {
    const next = list[idx + 1] || list[idx - 1]
    if (next) state.currentId = next.id
  }

  renderTree()
  renderMain()
}

let saveTimer = null
function scheduleSave(q) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveNow(q), 400)
}

async function saveNow(q) {
  clearTimeout(saveTimer)
  setSaveState('saving')
  try {
    const res = await fetch('/__admin/save-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: q.id, reviewStatus: q.reviewStatus, reviewNote: q.reviewNote || '' })
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error)
    setSaveState('saved')
  } catch (err) {
    console.error('[admin] save failed:', err)
    setSaveState('error')
  }
}

function setSaveState(s) {
  state.saveState = s
  const el = document.getElementById('save-state')
  if (el) {
    el.className = 'save-state ' + s
    el.textContent = s === 'saving' ? 'Сохранение…' : s === 'saved' ? 'Сохранено' : s === 'error' ? 'Ошибка' : ''
  }
}

// ---------- Горячие клавиши ----------
document.addEventListener('keydown', (e) => {
  if (state.view !== 'review') return
  const typing = document.activeElement && document.activeElement.tagName === 'TEXTAREA'
  if (typing) return
  const list = filteredQuestions()
  const idx = list.findIndex((q) => q.id === state.currentId)
  if (idx < 0) return
  const q = list[idx]
  if (e.key === 'ArrowLeft') goTo(list, idx - 1)
  else if (e.key === 'ArrowRight') goTo(list, idx + 1)
  else if (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') setStatus(q, 'approved')
  else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') setStatus(q, 'rejected')
})

boot().catch((err) => {
  $main.innerHTML = `<div class="content"><div class="empty">Ошибка загрузки: ${String(err)}</div></div>`
})
