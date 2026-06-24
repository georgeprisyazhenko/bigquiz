#!/usr/bin/env node
// PreToolUse-страж: блокирует CLI-правку прод/пула, пока запущен Vite dev-сервер.
//
// Почему: admin-плагин Vite + открытая admin-вкладка держат public/questions.json и
// data/review-pool.json в памяти и при любом действии/реконнекте ЗАТИРАЮТ правки,
// сделанные из CLI (массово сбрасывали approved→rework, теряли discard, возвращали
// снятые комменты). Поэтому при живом vite такие правки делать нельзя.
//
// Логика: читаем JSON хука со stdin. Блокируем (exit 2 + сообщение в stderr), если
// инструмент мутирует прод/пул И при этом `pgrep` находит vite. Чистые чтения и любые
// команды, не трогающие эти файлы, пропускаем.
//
// Регистрируется в .claude/settings.json как PreToolUse-хук на Bash|Edit|Write.

import { execSync } from 'node:child_process'

const POOL_FILES = /questions\.json|review-pool\.json/
// Сильные токены тулинга прод/пула — мутируют всегда (блокируем при любом упоминании).
const TOOLING = /review-store|promoteToProd|editQuestion|saveReview|deleteDrops|promote-to-prod|delete-drops|merge-gen|merge-polish|merge-rejudge/
// Жёсткие индикаторы записи рядом с файлом прод/пула (чтобы не блокировать чистые чтения).
// БЕЗ голого «>» — он ловил стрелки «=>» и сравнения в node -e (ложные срабатывания).
const HARD_WRITE = /writeFileSync|\btee\b|\bcp\b|\bmv\b|sed\s+-i|git\s+(checkout|restore|reset)/
// Шелл-редирект ПРЯМО в файл прод/пула: «> public/questions.json». Имя файла должно идти
// сразу за «>» (опц. пробел/кавычка) - стрелка «=>a.have» под это не подходит.
const REDIRECT_TO_POOL = /(?:>>?)\s*['"]?[^'"\s>|]*(?:questions|review-pool)\.json/

function viteRunning() {
  try { execSync('pgrep -f "node.*vite"', { stdio: 'ignore' }); return true } catch { return false }
}

function mutatesPoolOrProd(toolName, input) {
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    return POOL_FILES.test(String(input?.file_path || ''))
  }
  if (toolName === 'Bash') {
    const cmd = String(input?.command || '')
    if (TOOLING.test(cmd)) return true
    if (POOL_FILES.test(cmd) && HARD_WRITE.test(cmd)) return true
    if (REDIRECT_TO_POOL.test(cmd)) return true
    return false
  }
  return false
}

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let data = {}
  try { data = JSON.parse(raw || '{}') } catch { process.exit(0) } // не наш формат — не мешаем
  const toolName = data.tool_name
  const input = data.tool_input || {}

  if (mutatesPoolOrProd(toolName, input) && viteRunning()) {
    process.stderr.write(
      '⚠ Vite dev-сервер запущен - CLI-правки пула/прода будут затёрты admin-вкладкой. ' +
      'Останови dev (pkill -f vite) и закрой admin-вкладку перед правкой.\n'
    )
    process.exit(2) // exit 2 = блок PreToolUse; stderr уходит модели
  }
  process.exit(0)
})
