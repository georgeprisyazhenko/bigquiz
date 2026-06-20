// Локальная админка ревью вопросов BigQuiz (только dev, см. admin.html).
// Чистый DOM, без Phaser. Грузит дерево категорий и вопросы, даёт проваливаться
// в любую ветку и пролистывать вопросы с отметкой «ок / не ок» + заметка.
// Отметки сохраняются в public/questions.json через dev-плагин Vite.

const ALL = '__all__'

// Оси нашего судьи (docs/category-risks.md) - название + описание правила для карточки.
const AXES = [
  ['factOverLabel', 'Факт, а не ярлык', 'Ответ - интересный факт/механизм/причина, а не зубримое имя/термин/дата ради них самих. Главная ось.'],
  ['inSweetSpot', 'Sweet spot', 'Ответят ~45-75% образованных взрослых: не банальщина (>90%) и не ультранишевость (<30%).'],
  ['cleanDistractors', 'Чистые дистракторы', '4 варианта из одной области, не синонимы и не дубли, без протечки слова-ответа, ровно один верный.'],
  ['naturalLanguage', 'Живой язык', 'Разговорный грамотный русский без канцелярита, жаргона, англо-аббревиатур и знаков ударения.'],
  ['factuallyCorrect', 'Факт верен', 'Не развенчанный миф, не байка, не мисатрибуция цитаты.'],
  ['concise', 'Компактность', 'Вопрос - одно предложение ≤240 симв.; каждый ответ ≤5 слов / ≤44 символов (наш жёсткий лимит).']
]

// Уровни оценки чистовиков (вкладка «Чистовик»): ключ + ярлык + краткое описание.
const SCORE_LEVELS = [
  ['compactness', 'Компактность', 'правила длины/плашки'],
  ['language', 'Язык', 'грамматика, пунктуация, лаконичность'],
  ['distractors', 'Дистракторы', 'один верный, без протечки/дублей/синонимов'],
  ['factuality', 'Факт', 'не миф, ответ верен'],
  ['angle', 'Угол', 'сила «ого»-эффекта']
]

const state = {
  source: 'ours', // ours | guestion | clean
  categories: [],
  questions: [],
  guestion: { categories: [], questions: [] }, // вопросы guestion.ru + наша разметка
  clean: { categories: [], questions: [] }, // чистовики guestion + оценка судьи
  catIndex: new Map(), // id -> { type, name, topId, memberIds:Set }
  selectedNode: ALL,
  statusFilter: 'all', // all | pending | approved | rejected
  verdictFilter: 'all', // all | keep | revise | drop (только для guestion)
  cleanFilter: 'clean', // clean | dropped | all (только для чистовика - аудит)
  view: 'list', // list | review
  currentId: null, // id вопроса в режиме ревью
  expanded: new Set(), // раскрытые верхние категории
  saveState: 'idle' // idle | saving | saved | error
}

const isGuestion = () => state.source === 'guestion'
const isClean = () => state.source === 'clean'
const isSiteSource = () => isGuestion() || isClean() // оба используют категории/теги сайта
const activeQuestions = () => (isClean() ? state.clean.questions : isGuestion() ? state.guestion.questions : state.questions)
// Эндпоинт по ПРЕФИКСУ id (а не по текущему источнику) - надёжно при ресинке и
// при смене вкладки с непустой очередью: guestion-вопросы всегда g_*.
const endpointFor = (q) => (q.id && q.id.startsWith('g_') ? '/__admin/save-guestion' : '/__admin/save-question')

// ---------- localStorage-страховка отметок ----------
// Сервер пишет на диск только при живом dev-сервере; если он недоступен или
// вкладка релоадится (в т.ч. HMR), несохранённые отметки терялись. Теперь каждая
// отметка синхронно дублируется в localStorage и восстанавливается + дописывается
// на диск при загрузке. Ключ хранит марки по источнику + выбранный источник.
const LS_KEY = 'bigquiz-admin-review'
const lsLoad = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}
const lsWrite = (all) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all))
  } catch {}
}
function lsSaveMark(source, q) {
  const all = lsLoad()
  all[source] = all[source] || {}
  const empty = (!q.reviewStatus || q.reviewStatus === 'pending') && !(q.reviewNote || '').trim()
  if (empty) delete all[source][q.id]
  else all[source][q.id] = { reviewStatus: q.reviewStatus, reviewNote: q.reviewNote || '' }
  lsWrite(all)
}
function lsSetSource(s) {
  const all = lsLoad()
  all.__source = s
  lsWrite(all)
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
  await loadGuestion()
  await loadClean()
  restoreFromLocal()
  renderAll()
}

// Чистовики (public/guestion-clean.json) + твои баллы (public/guestion-clean-review.json).
async function loadClean() {
  try {
    const data = await fetch('/guestion-clean.json').then((r) => (r.ok ? r.json() : null))
    if (!data) return
    let review = {}
    try {
      review = (await fetch('/guestion-clean-review.json').then((r) => (r.ok ? r.json() : {}))) || {}
    } catch { review = {} }
    state.clean.categories = [...new Set((data.questions || []).map((q) => q.sourceCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'))
    state.clean.questions = (data.questions || []).map((q) => ({
      ...q,
      scores: (review[q.id] || {}).scores || {},
      reviewNote: (review[q.id] || {}).reviewNote || ''
    }))
  } catch (err) {
    console.warn('[admin] guestion-clean.json не загружен:', err)
  }
}

// Восстановить выбранный источник и несохранённые отметки из localStorage поверх
// данных с диска, затем до-сохранить их на сервер (догон, если сервер был недоступен).
function restoreFromLocal() {
  const ls = lsLoad()
  if (ls.__source === 'guestion' || ls.__source === 'ours') state.source = ls.__source
  const toResync = []
  const apply = (questions, marks) => {
    if (!marks) return
    const byId = new Map(questions.map((q) => [q.id, q]))
    for (const [id, m] of Object.entries(marks)) {
      const q = byId.get(id)
      if (!q) continue
      // localStorage - последнее слово (там самые свежие, возможно несохранённые правки).
      const changed = q.reviewStatus !== (m.reviewStatus || 'pending') || (q.reviewNote || '') !== (m.reviewNote || '')
      q.reviewStatus = m.reviewStatus || 'pending'
      q.reviewNote = m.reviewNote || ''
      if (changed) toResync.push(q)
    }
  }
  apply(state.questions, ls.ours)
  apply(state.guestion.questions, ls.guestion)
  // Догон на диск (best-effort): то, что в LS новее серверного - дописать.
  for (const q of toResync) scheduleSave(q)
  if (toResync.length) flushSaves()

  // Чистовики - своя форма ({scores, reviewNote}).
  if (ls.clean) {
    const byId = new Map(state.clean.questions.map((q) => [q.id, q]))
    let resync = 0
    for (const [id, m] of Object.entries(ls.clean)) {
      const q = byId.get(id)
      if (!q) continue
      if (m.scores) q.scores = m.scores
      if (m.reviewNote != null) q.reviewNote = m.reviewNote
      scheduleCleanSave(q)
      resync++
    }
    if (resync) flushClean()
  }
}

// Вопросы guestion.ru (public/guestion.json) + твои отметки (public/guestion-review.json).
// Оба файла могут отсутствовать (если ещё не собрано) - тогда вкладка просто пустая.
async function loadGuestion() {
  try {
    const data = await fetch('/guestion.json').then((r) => (r.ok ? r.json() : null))
    if (!data) return
    let review = {}
    try {
      review = (await fetch('/guestion-review.json').then((r) => (r.ok ? r.json() : {}))) || {}
    } catch { review = {} }
    state.guestion.categories = (data.categories || []).map((c) => c.name)
    state.guestion.questions = (data.questions || []).map((q) => ({
      ...q,
      reviewStatus: (review[q.id] || {}).reviewStatus || 'pending',
      reviewNote: (review[q.id] || {}).reviewNote || ''
    }))
  } catch (err) {
    console.warn('[admin] guestion.json не загружен:', err)
  }
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
  if (isSiteSource()) {
    // Дерево guestion/чистовик - плоский список категорий сайта (id узла = имя категории).
    return (q.tags || []).includes(nodeId) || q.sourceCategory === nodeId
  }
  const node = state.catIndex.get(nodeId)
  if (!node) return false
  return (q.categories || []).some((c) => node.memberIds.has(c))
}

function statusOf(q) {
  return q.reviewStatus || 'pending'
}

function filteredQuestions() {
  if (isClean()) {
    return activeQuestions().filter(
      (q) =>
        matchesNode(q, state.selectedNode) &&
        (state.cleanFilter === 'all' ||
          (state.cleanFilter === 'clean' ? q.disposition === 'clean' : q.disposition !== 'clean'))
    )
  }
  return activeQuestions().filter(
    (q) =>
      matchesNode(q, state.selectedNode) &&
      (state.statusFilter === 'all' || statusOf(q) === state.statusFilter) &&
      (!isGuestion() || state.verdictFilter === 'all' || q.ourVerdict === state.verdictFilter)
  )
}

function counts(nodeId) {
  let total = 0
  let approved = 0
  let pending = 0
  for (const q of activeQuestions()) {
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
  title.textContent = isClean() ? 'Категории чистовика' : isGuestion() ? 'Категории guestion' : 'Категории'
  frag.appendChild(title)

  frag.appendChild(treeNode({ id: ALL, label: 'Все вопросы', level: 'top' }))

  // guestion/чистовик: плоский список категорий сайта (без подкатегорий).
  if (isSiteSource()) {
    const cats = isClean() ? state.clean.categories : state.guestion.categories
    for (const name of cats) {
      frag.appendChild(treeNode({ id: name, label: name, level: 'top' }))
    }
    $tree.replaceChildren(frag)
    return
  }

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
  h1.innerHTML = `BigQuiz · <span class="scope">${isGuestion() ? 'guestion' : 'ревью'}</span>`
  bar.appendChild(h1)

  // Переключатель источника: наши вопросы / собранные с guestion.ru.
  bar.appendChild(
    segmented(
      [
        ['ours', 'Наши вопросы'],
        ['guestion', 'Guestion'],
        ['clean', 'Чистовик']
      ],
      state.source,
      (v) => {
        if (v === state.source) return
        flushSaves() // дописать отметки текущего источника перед сменой
        flushClean()
        state.source = v
        lsSetSource(v) // запомнить выбор - релоад не сбросит на «Наши»
        state.selectedNode = ALL
        state.currentId = null
        state.verdictFilter = 'all'
        renderAll()
      }
    )
  )

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

  // Фильтр по вердикту нашего судьи (только guestion).
  if (isGuestion()) {
    bar.appendChild(
      segmented(
        [
          ['all', 'Любой вердикт'],
          ['keep', 'keep'],
          ['revise', 'revise'],
          ['drop', 'drop']
        ],
        state.verdictFilter,
        (v) => {
          state.verdictFilter = v
          state.currentId = null
          renderMain()
        }
      )
    )
  }

  // Фильтр по судьбе чистовика (аудит): чистовики / отклонённые / все.
  if (isClean()) {
    bar.appendChild(
      segmented(
        [
          ['clean', 'Чистовики'],
          ['dropped', 'Отклонённые'],
          ['all', 'Все']
        ],
        state.cleanFilter,
        (v) => {
          state.cleanFilter = v
          state.currentId = null
          renderMain()
        }
      )
    )
  }

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

  // Экспорт одобренных guestion-вопросов в шорт-лист затравок.
  if (isGuestion()) {
    const exp = document.createElement('button')
    exp.className = 'export-btn'
    exp.textContent = '⬇ Экспорт затравок'
    exp.title = 'Записать одобренные (ок) вопросы в scripts/guestion-seeds.json'
    exp.addEventListener('click', async () => {
      exp.disabled = true
      const prev = exp.textContent
      exp.textContent = 'Экспорт…'
      try {
        const res = await fetch('/__admin/export-guestion-seeds', { method: 'POST' })
        const data = await res.json()
        exp.textContent = data.ok ? `✓ ${data.count} → guestion-seeds.json` : 'Ошибка'
      } catch {
        exp.textContent = 'Ошибка'
      }
      setTimeout(() => {
        exp.textContent = prev
        exp.disabled = false
      }, 2500)
    })
    bar.appendChild(exp)
  }

  const save = document.createElement('div')
  save.className = 'save-state ' + state.saveState
  save.id = 'save-state'
  save.textContent =
    state.saveState === 'saving' ? 'Сохранение…' : state.saveState === 'saved' ? 'Сохранено' : state.saveState === 'error' ? 'Ошибка' : ''
  bar.appendChild(save)

  return bar
}

function filteredAllStatus(status) {
  return activeQuestions().filter((q) => matchesNode(q, state.selectedNode) && statusOf(q) === status).length
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
    wrap.appendChild(isClean() ? cleanCard(list) : reviewCard(list))
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

  if (isGuestion() && q.ourVerdict) row.appendChild(verdictPill(q.ourVerdict))
  if (isClean()) {
    if (q.angle) {
      const a = document.createElement('span')
      a.className = 'seed-pill ' + (q.angle.score >= 4 ? 'high' : q.angle.score <= 2 ? 'low' : '')
      a.textContent = 'угол ' + q.angle.score
      row.appendChild(a)
    }
    if (q.disposition && q.disposition !== 'clean') row.appendChild(verdictPill('drop'))
  }
  if (!isClean()) row.appendChild(statusPill(statusOf(q)))
  else {
    const scored = q.scores && Object.keys(q.scores).length
    const p = document.createElement('span')
    p.className = 'status-pill ' + (scored ? 'approved' : 'pending')
    p.textContent = scored ? 'оценён' : 'без оценки'
    row.appendChild(p)
  }

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

function verdictPill(verdict) {
  const p = document.createElement('span')
  p.className = 'verdict-pill ' + verdict
  p.textContent = verdict
  return p
}

// Блок разметки судьи для guestion-вопроса: вердикт, 5 осей (название+описание+✓/✗),
// тип угла, ценность затравки и общий комментарий судьи.
function judgeBlock(q) {
  const box = document.createElement('div')
  box.className = 'judge'

  const head = document.createElement('div')
  head.className = 'judge-head'
  const label = document.createElement('span')
  label.className = 'judge-label'
  label.textContent = 'Судья BigQuiz'
  head.appendChild(label)
  if (q.ourVerdict) head.appendChild(verdictPill(q.ourVerdict))
  if (q.seedValue) {
    const seed = document.createElement('span')
    seed.className = 'seed-pill ' + q.seedValue
    seed.textContent = 'seed: ' + q.seedValue
    seed.title = 'Ценность темы как затравки для нашей генерации'
    head.appendChild(seed)
  }
  if (q.angleType) {
    const ang = document.createElement('span')
    ang.className = 'angle-pill'
    ang.textContent = q.angleType
    ang.title = 'Тип угла вопроса (A.10)'
    head.appendChild(ang)
  }
  box.appendChild(head)

  const axes = document.createElement('div')
  axes.className = 'axes'
  for (const [key, name, desc] of AXES) {
    const val = q.axes[key]
    const row = document.createElement('div')
    row.className = 'axis ' + (val === true ? 'pass' : val === false ? 'fail' : 'na')
    const mark = document.createElement('span')
    mark.className = 'axis-mark'
    mark.textContent = val === true ? '✓' : val === false ? '✗' : '—'
    const txt = document.createElement('span')
    txt.className = 'axis-text'
    const nm = document.createElement('b')
    nm.textContent = name
    const ds = document.createElement('span')
    ds.className = 'axis-desc'
    ds.textContent = ' — ' + desc
    txt.append(nm, ds)
    row.append(mark, txt)
    axes.appendChild(row)
  }
  box.appendChild(axes)

  if (q.note) {
    const note = document.createElement('div')
    note.className = 'judge-note'
    note.textContent = q.note
    box.appendChild(note)
  }
  return box
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
  const chipSource = isGuestion() ? q.tags || [] : q.categories || []
  for (const c of chipSource) {
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

  // Разметка нашего судьи (только guestion): вердикт + 5 осей + угол + seed + коммент.
  if (isGuestion() && q.axes) card.appendChild(judgeBlock(q))

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
  note.addEventListener('blur', () => flushSaves()) // сразу записать, не дожидаясь debounce
  card.appendChild(note)

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.innerHTML = 'Клавиши: <kbd>←</kbd> <kbd>→</kbd> листать · <kbd>A</kbd> окей · <kbd>R</kbd> не окей'
  card.appendChild(hint)

  review.appendChild(card)
  return review
}

// Карточка чистовика: переписанный вопрос + «было» + разметка судьи + баллы 1-5 по уровням.
function cleanCard(list) {
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

  const card = document.createElement('div')
  card.className = 'card' + (q.disposition && q.disposition !== 'clean' ? ' is-dropped' : '')

  // Заметный баннер, если вопрос отклонён судьёй.
  if (q.disposition && q.disposition !== 'clean') {
    const reason = {
      'drop-weak-angle': 'слабый угол (≤2) - неинтересно',
      'drop-fact': 'факт/миф - премиса или ответ недостоверны',
      'drop-unfixable': 'неспасаемо в текущем виде',
      'drop-prohibited': 'запрещённая тема ЯИ (3.4) - религия/политика/эзотерика'
    }[q.disposition] || q.disposition
    const banner = document.createElement('div')
    banner.className = 'drop-banner'
    banner.textContent = '❌ ОТКЛОНЁН СУДЬЁЙ — ' + reason
    card.appendChild(banner)
  }

  const head = document.createElement('div')
  head.className = 'q-id'
  head.textContent = q.id + ' · ' + (q.sourceCategory || '')
  card.appendChild(head)

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

  // Флаг нарушения длины ответа (код-гейт merge-clean) - на ре-ремонт.
  if (Array.isArray(q.formIssues) && q.formIssues.length) {
    const fi = document.createElement('div')
    fi.className = 'form-issues'
    fi.textContent = '⚠ Длина ответа: ' + q.formIssues.join('; ')
    card.appendChild(fi)
  }

  // «Было» - оригинал + что поменяли (сворачиваемо).
  if (q.original) {
    const det = document.createElement('details')
    det.className = 'was'
    const sum = document.createElement('summary')
    sum.textContent = 'Было (оригинал guestion)'
    det.appendChild(sum)
    const ow = document.createElement('div')
    ow.className = 'was-body'
    ow.innerHTML =
      `<div class="was-q">${escapeHtml(q.original.question)}</div>` +
      `<div class="was-a">${(q.original.answers || []).map((a) => escapeHtml(a)).join(' · ')}</div>` +
      (q.changed ? `<div class="was-changed">🔧 ${escapeHtml(q.changed)}</div>` : '')
    det.appendChild(ow)
    card.appendChild(det)
  }

  // Разметка судьи (справка).
  card.appendChild(cleanJudgeBlock(q))

  // Баллы 1-5 по уровням.
  const scoring = document.createElement('div')
  scoring.className = 'scoring'
  const sTitle = document.createElement('div')
  sTitle.className = 'scoring-title'
  sTitle.textContent = 'Твоя оценка (1-5 по уровням)'
  scoring.appendChild(sTitle)
  for (const [key, label, desc] of SCORE_LEVELS) {
    const row = document.createElement('div')
    row.className = 'score-row'
    const lbl = document.createElement('div')
    lbl.className = 'score-label'
    lbl.innerHTML = `<b>${label}</b><span class="score-desc">${desc}</span>`
    row.appendChild(lbl)
    const scale = document.createElement('div')
    scale.className = 'scale'
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement('button')
      b.className = 'score-btn' + ((q.scores || {})[key] === n ? ' active' : '')
      b.textContent = n
      b.addEventListener('click', () => {
        q.scores = q.scores || {}
        q.scores[key] = q.scores[key] === n ? undefined : n // повторный клик снимает
        if (q.scores[key] === undefined) delete q.scores[key]
        scheduleCleanSave(q)
        renderContent.replaceInMain()
      })
      scale.appendChild(b)
    }
    row.appendChild(scale)
    scoring.appendChild(row)
  }
  card.appendChild(scoring)

  const note = document.createElement('textarea')
  note.className = 'note-field'
  note.placeholder = 'Комментарий к оценке (что не так / почему такой балл).'
  note.value = q.reviewNote || ''
  note.addEventListener('input', () => {
    q.reviewNote = note.value
    scheduleCleanSave(q)
  })
  note.addEventListener('blur', () => flushClean())
  card.appendChild(note)

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.innerHTML = 'Клавиши: <kbd>←</kbd> <kbd>→</kbd> листать · баллы - кликом'
  card.appendChild(hint)

  review.appendChild(card)
  return review
}

function cleanJudgeBlock(q) {
  const box = document.createElement('div')
  box.className = 'judge'
  const head = document.createElement('div')
  head.className = 'judge-head'
  const label = document.createElement('span')
  label.className = 'judge-label'
  label.textContent = 'Судья: угол'
  head.appendChild(label)
  if (q.angle) {
    const s = document.createElement('span')
    s.className = 'seed-pill ' + (q.angle.score >= 4 ? 'high' : q.angle.score <= 2 ? 'low' : '')
    s.textContent = q.angle.score + '/5'
    head.appendChild(s)
    const t = document.createElement('span')
    t.className = 'angle-pill'
    t.textContent = q.angle.type || ''
    head.appendChild(t)
  }
  if (q.banal) {
    const b = document.createElement('span')
    b.className = 'verdict-pill revise'
    b.textContent = 'банально'
    head.appendChild(b)
  }
  box.appendChild(head)
  if (q.angle && q.angle.note) {
    const n = document.createElement('div')
    n.className = 'judge-note'
    n.textContent = q.angle.note
    box.appendChild(n)
  }
  if (q.fact) {
    const f = document.createElement('div')
    f.className = 'judge-note fact-' + q.fact.verdict
    f.innerHTML = `<b>Факт (веб): ${q.fact.verdict}</b> — ${escapeHtml(q.fact.explanation || '')}`
    box.appendChild(f)
  }
  return box
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function goTo(list, i) {
  if (i < 0 || i >= list.length) return
  flushSaves() // записать заметку покидаемого вопроса, пока не сменился currentId
  flushClean()
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

// Очередь сохранений по id. КРИТИЧНО: раньше был один общий таймер debounce —
// любое следующее действие (пометка/правка заметки ДРУГОГО вопроса) вызывало
// clearTimeout и отменяло ещё не записанную заметку предыдущего вопроса, она
// терялась навсегда. Теперь «грязные» вопросы копятся в map и сбрасываются
// целиком при навигации / пометке / уходе с поля / закрытии вкладки.
const dirty = new Map() // id -> q (ссылка на объект в state.questions)
let saveTimer = null
let flushing = false

function scheduleSave(q) {
  // Синхронная страховка: даже если сервер недоступен или вкладка сейчас релоаднется,
  // отметка уже в localStorage и восстановится при следующей загрузке.
  lsSaveMark(q.id && q.id.startsWith('g_') ? 'guestion' : 'ours', q)
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
      const res = await fetch(endpointFor(q), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: q.id, reviewStatus: q.reviewStatus, reviewNote: q.reviewNote || '' })
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
    if (dirty.size) flushSaves() // что-то накопилось за время записи
  }
}

// Совместимость: немедленное сохранение конкретного вопроса (ставит в очередь и
// сбрасывает её сразу — заодно дописывает любые ждущие заметки).
function saveNow(q) {
  scheduleSave(q)
  return flushSaves()
}

// ---------- Сохранение баллов чистовиков (отдельная очередь + LS) ----------
const cleanDirty = new Map()
let cleanTimer = null
let cleanFlushing = false

function lsSaveClean(q) {
  const all = lsLoad()
  all.clean = all.clean || {}
  const empty = !(q.scores && Object.keys(q.scores).length) && !(q.reviewNote || '').trim()
  if (empty) delete all.clean[q.id]
  else all.clean[q.id] = { scores: q.scores || {}, reviewNote: q.reviewNote || '' }
  lsWrite(all)
}

function scheduleCleanSave(q) {
  lsSaveClean(q) // синхронная страховка
  cleanDirty.set(q.id, q)
  clearTimeout(cleanTimer)
  cleanTimer = setTimeout(flushClean, 400)
}

async function flushClean() {
  clearTimeout(cleanTimer)
  cleanTimer = null
  if (cleanFlushing || !cleanDirty.size) return
  cleanFlushing = true
  setSaveState('saving')
  try {
    while (cleanDirty.size) {
      const [id, q] = cleanDirty.entries().next().value
      cleanDirty.delete(id)
      const res = await fetch('/__admin/save-clean-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: q.id, scores: q.scores || {}, reviewNote: q.reviewNote || '' })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
    }
    setSaveState('saved')
  } catch (err) {
    console.error('[admin] clean save failed:', err)
    setSaveState('error')
  } finally {
    cleanFlushing = false
  }
}

// Аварийный синхронный сброс при закрытии вкладки: обычный fetch не успеет.
function flushBeacon() {
  for (const [, q] of dirty) {
    navigator.sendBeacon(
      endpointFor(q),
      new Blob([JSON.stringify({ id: q.id, reviewStatus: q.reviewStatus, reviewNote: q.reviewNote || '' })], {
        type: 'application/json'
      })
    )
  }
  dirty.clear()
  for (const [, q] of cleanDirty) {
    navigator.sendBeacon(
      '/__admin/save-clean-review',
      new Blob([JSON.stringify({ id: q.id, scores: q.scores || {}, reviewNote: q.reviewNote || '' })], { type: 'application/json' })
    )
  }
  cleanDirty.clear()
}
window.addEventListener('beforeunload', flushBeacon)

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
  if (e.key === 'ArrowLeft') return goTo(list, idx - 1)
  if (e.key === 'ArrowRight') return goTo(list, idx + 1)
  if (isClean()) return // в чистовике ок/не ок нет - только листание и клики по баллам
  if (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') setStatus(q, 'approved')
  else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') setStatus(q, 'rejected')
})

boot().catch((err) => {
  $main.innerHTML = `<div class="content"><div class="empty">Ошибка загрузки: ${String(err)}</div></div>`
})
