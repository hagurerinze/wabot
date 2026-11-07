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
  'SELECT id, role, content FROM messages WHERE chat = ? ORDER BY id ASC LIMIT ?'
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
export function deleteMessages(ids) {
  for (const id of ids) delIdStmt.run(id)
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
const getFactsStmt = db.prepare('SELECT fact FROM facts WHERE person = ? ORDER BY id DESC LIMIT ?')
const addFactStmt = db.prepare('INSERT OR IGNORE INTO facts (person, fact, ts) VALUES (?, ?, ?)')
const trimFactsStmt = db.prepare(
  'DELETE FROM facts WHERE person = ? AND id NOT IN ' +
  '(SELECT id FROM facts WHERE person = ? ORDER BY id DESC LIMIT ?)'
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
