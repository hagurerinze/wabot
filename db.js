import Database from 'better-sqlite3'

const db = new Database('bot.db')
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_ts ON messages(chat, ts);
`)

const insert = db.prepare(
  'INSERT INTO messages (chat, role, content, ts) VALUES (?, ?, ?, ?)'
)
const recent = db.prepare(
  'SELECT role, content FROM messages WHERE chat = ? ORDER BY id DESC LIMIT ?'
)
const clear = db.prepare('DELETE FROM messages WHERE chat = ?')

export function saveMessage(chat, role, content) {
  insert.run(chat, role, content, Date.now())
}

export function getHistory(chat, limit = 10) {
  return recent.all(chat, limit).reverse()
}

export function clearHistory(chat) {
  clear.run(chat)
  clearSum.run(chat)
  clearArchive(chat)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS summaries (
    chat TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
`)
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat = ?')
const oldestStmt = db.prepare(
  'SELECT id, role, content, ts FROM messages WHERE chat = ? ORDER BY id ASC LIMIT ?'
)
const delIdStmt = db.prepare('DELETE FROM messages WHERE id = ?')
const getSum = db.prepare('SELECT summary FROM summaries WHERE chat = ?')
const putSum = db.prepare(
  'INSERT INTO summaries (chat, summary, ts) VALUES (?, ?, ?) ' +
  'ON CONFLICT(chat) DO UPDATE SET summary = excluded.summary, ts = excluded.ts'
)
const clearSum = db.prepare('DELETE FROM summaries WHERE chat = ?')

export function countMessages(chat) {
  return countStmt.get(chat).n
}
export function getOldest(chat, n) {
  return oldestStmt.all(chat, n)
}
db.exec(`
  CREATE TABLE IF NOT EXISTS messages_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orig_id INTEGER,
    chat TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts INTEGER NOT NULL,
    archived_ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_arch_chat_ts ON messages_archive(chat, ts);
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat TEXT NOT NULL,
    text TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'episode',
    ts_from INTEGER,
    ts_to INTEGER NOT NULL,
    created_ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ep_chat ON episodes(chat, ts_to);
  CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(text, tags, tokenize = 'unicode61 remove_diacritics 2');
`)
// ringkasan yang sudah ada disalin sekali jadi kartu pertama
if (db.pragma('user_version', { simple: true }) < 1) {
  db.exec(`
    INSERT INTO episodes (chat, text, kind, ts_to, created_ts)
      SELECT chat, summary, 'ringkasan-lama', ts, ts FROM summaries;
    INSERT INTO episodes_fts (rowid, text, tags)
      SELECT id, text, tags FROM episodes WHERE id NOT IN (SELECT rowid FROM episodes_fts);
  `)
  db.pragma('user_version = 1')
}
const archiveStmt = db.prepare(
  'INSERT INTO messages_archive (orig_id, chat, role, content, ts, archived_ts) ' +
  'SELECT id, chat, role, content, ts, ? FROM messages WHERE id = ?'
)
const archiveAndDelete = db.transaction((list) => {
  const now = Date.now()
  for (const id of list) {
    archiveStmt.run(now, id)
    delIdStmt.run(id)
  }
})
const delArchStmt = db.prepare('DELETE FROM messages_archive WHERE chat = ?')
const delEpFtsStmt = db.prepare('DELETE FROM episodes_fts WHERE rowid IN (SELECT id FROM episodes WHERE chat = ?)')
const delEpStmt = db.prepare('DELETE FROM episodes WHERE chat = ?')
const clearArchiveTx = db.transaction((chat) => {
  delEpFtsStmt.run(chat)
  delEpStmt.run(chat)
  delArchStmt.run(chat)
})
function clearArchive(chat) {
  clearArchiveTx(chat)
}
export function deleteMessages(ids) {
  archiveAndDelete(ids)
}

const epExists = db.prepare("SELECT 1 FROM episodes WHERE chat = ? AND kind = 'episode' AND ts_to = ?")
const epInsert = db.prepare(
  'INSERT INTO episodes (chat, text, tags, kind, ts_from, ts_to, created_ts) VALUES (?, ?, ?, ?, ?, ?, ?)'
)
const epFtsInsert = db.prepare('INSERT INTO episodes_fts (rowid, text, tags) VALUES (?, ?, ?)')
const addEpisodeTx = db.transaction((chat, text, tags, tsFrom, tsTo) => {
  if (epExists.get(chat, tsTo)) return false
  const r = epInsert.run(chat, text, tags, 'episode', tsFrom ?? null, tsTo, Date.now())
  epFtsInsert.run(r.lastInsertRowid, text, tags)
  return true
})
export function addEpisode(chat, text, tags, tsFrom, tsTo) {
  return addEpisodeTx(chat, text, tags || '', tsFrom, tsTo || Date.now())
}

const STOP_WORDS = new Set(
  ('yang dan itu ini aku kamu saya gue gua lu lo yuri yurishy apa kok dong donk deh sih nih tuh dengan untuk dari pada ' +
    'ada adalah atau juga sudah udah belum tidak nggak gak bisa mau lagi kalau kalo jadi karena tapi tolong coba lalu ' +
    'terus sama bukan aja saja banget sekali dulu tadi nanti besok kemarin gimana bagaimana kenapa siapa kapan dimana').split(' ')
)
const findEpStmt = db.prepare(
  'SELECT e.id, e.text, e.ts_to FROM episodes_fts f JOIN episodes e ON e.id = f.rowid ' +
  'WHERE episodes_fts MATCH ? AND e.chat = ? ORDER BY bm25(episodes_fts) LIMIT ?'
)
export function findEpisodes(chat, query, limit = 3) {
  const words = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])]
    .filter((w) => !STOP_WORDS.has(w))
    .slice(0, 8)
  if (words.length === 0) return []
  const q = words.map((w) => (w.length >= 4 ? `"${w}"*` : `"${w}"`)).join(' OR ')
  try {
    return findEpStmt.all(q, chat, limit)
  } catch (e) {
    return []
  }
}
export function getSummary(chat) {
  return getSum.get(chat)?.summary || ''
}
export function saveSummary(chat, summary) {
  putSum.run(chat, summary, Date.now())
}

db.exec(`
  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL,
    fact TEXT NOT NULL,
    ts INTEGER NOT NULL,
    UNIQUE(person, fact)
  );
`)
const factCols = db.prepare('PRAGMA table_info(facts)').all().map((c) => c.name)
if (factCols.includes('archived') === false) db.exec('ALTER TABLE facts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
const getFactsStmt = db.prepare('SELECT fact FROM facts WHERE person = ? AND archived = 0 ORDER BY id DESC LIMIT ?')
const addFactStmt = db.prepare('INSERT OR IGNORE INTO facts (person, fact, ts) VALUES (?, ?, ?)')
const trimFactsStmt = db.prepare(
  'UPDATE facts SET archived = 1 WHERE person = ? AND archived = 0 AND id NOT IN ' +
  '(SELECT id FROM facts WHERE person = ? AND archived = 0 ORDER BY id DESC LIMIT ?)'
)
const delFactsStmt = db.prepare('DELETE FROM facts WHERE person = ?')

export function getFacts(person, limit = 25) {
  return getFactsStmt.all(person, limit).map((r) => r.fact).reverse()
}
export function addFacts(person, facts) {
  for (const f of facts) addFactStmt.run(person, f, Date.now())
  trimFactsStmt.run(person, person, 25)
}
export function deleteFacts(person) {
  delFactsStmt.run(person)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS self_notes (
    version INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    reason TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'baru',
    ts INTEGER NOT NULL
  );
`)
const propCols = db.prepare('PRAGMA table_info(proposals)').all().map((c) => c.name)
if (propCols.includes('reason') === false) db.exec('ALTER TABLE proposals ADD COLUMN reason TEXT')
if (propCols.includes('decided_ts') === false) db.exec('ALTER TABLE proposals ADD COLUMN decided_ts INTEGER')
const latestNotes = db.prepare('SELECT version, body, reason, ts FROM self_notes ORDER BY version DESC LIMIT 1')
const addNotes = db.prepare('INSERT INTO self_notes (body, reason, ts) VALUES (?, ?, ?)')
const trimNotes = db.prepare(
  'DELETE FROM self_notes WHERE version NOT IN (SELECT version FROM self_notes ORDER BY version DESC LIMIT 50)'
)
const addProp = db.prepare('INSERT OR IGNORE INTO proposals (text, ts) VALUES (?, ?)')
const newProps = db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE status = 'baru'")

export function getSelfNotes() {
  return latestNotes.get() || { version: 0, body: '', reason: '', ts: 0 }
}
export function saveSelfNotes(body, reason) {
  addNotes.run(body, reason, Date.now())
  trimNotes.run()
}
const decidedProps = db.prepare(
  "SELECT text, status, reason FROM proposals WHERE status IN ('selesai', 'ditolak') ORDER BY COALESCE(decided_ts, ts) DESC LIMIT 20"
)
const waitingProps = db.prepare("SELECT text FROM proposals WHERE status = 'baru' ORDER BY id")
export function getProposalDecisions() {
  return { decided: decidedProps.all(), pending: waitingProps.all() }
}
export function addProposals(list) {
  for (const t of list) {
    if (newProps.get().n >= 20) break
    addProp.run(t, Date.now())
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL,
    done_ts INTEGER
  );
`)
const addTodoStmt = db.prepare('INSERT INTO todos (person, text, ts) VALUES (?, ?, ?)')
const openTodosStmt = db.prepare('SELECT id, text FROM todos WHERE person = ? AND done = 0 ORDER BY id')
const doneTodoStmt = db.prepare('UPDATE todos SET done = 1, done_ts = ? WHERE id = ?')
const delTodoStmt = db.prepare('DELETE FROM todos WHERE id = ?')
export function addTodo(person, text) {
  if (openTodosStmt.all(person).length >= 30) return false
  addTodoStmt.run(person, text, Date.now())
  return true
}
export function listTodos(person) {
  return openTodosStmt.all(person)
}
export function finishTodo(person, n) {
  const row = openTodosStmt.all(person)[n - 1]
  if (!row) return null
  doneTodoStmt.run(Date.now(), row.id)
  return row.text
}
export function removeTodo(person, n) {
  const row = openTodosStmt.all(person)[n - 1]
  if (!row) return null
  delTodoStmt.run(row.id)
  return row.text
}

export function addTodos(person, items) {
  const open = openTodosStmt.all(person)
  const have = new Set(open.map((x) => x.text.toLowerCase()))
  let added = 0
  let dup = 0
  let full = 0
  for (const t of items) {
    if (have.has(t.toLowerCase())) {
      dup++
    } else if (open.length + added >= 30) {
      full++
    } else {
      addTodoStmt.run(person, t, Date.now())
      have.add(t.toLowerCase())
      added++
    }
  }
  return { added, dup, full, total: open.length + added }
}
function pickTodos(person, nums) {
  const open = openTodosStmt.all(person)
  const rows = []
  for (const n of new Set(nums)) {
    const row = open[n - 1]
    if (row) rows.push(row)
  }
  return rows
}
export function finishTodos(person, nums) {
  const rows = pickTodos(person, nums)
  const now = Date.now()
  for (const r of rows) doneTodoStmt.run(now, r.id)
  return rows.map((r) => r.text)
}
export function removeTodos(person, nums) {
  const rows = pickTodos(person, nums)
  for (const r of rows) delTodoStmt.run(r.id)
  return rows.map((r) => r.text)
}
export function clearTodos(person) {
  db.prepare('DELETE FROM todos WHERE person = ?').run(person)
}
