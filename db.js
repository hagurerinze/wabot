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
}
