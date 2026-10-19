import Database from 'better-sqlite3'

const db = new Database('bot.db')
const arg = process.argv[2]
const limit = Number(process.argv[3]) || 20

if (!arg) {
  const rows = db
    .prepare('SELECT chat, COUNT(*) AS n, MAX(ts) AS last FROM messages GROUP BY chat ORDER BY last DESC')
    .all()
  if (!rows.length) console.log('Belum ada riwayat.')
  for (const r of rows) {
    console.log(`${r.chat} | ${r.n} pesan | ${new Date(r.last).toLocaleString('id-ID')}`)
  }
} else {
  const rows = db
    .prepare('SELECT chat, role, content, ts FROM messages WHERE chat LIKE ? ORDER BY id DESC LIMIT ?')
    .all(`%${arg}%`, limit)
    .reverse()
  if (!rows.length) console.log('Tidak ada chat yang cocok.')
  for (const r of rows) {
    const who = r.role === 'user' ? 'user' : 'Yurishy'
    console.log(`[${new Date(r.ts).toLocaleTimeString('id-ID')}] ${who}: ${r.content}`)
  }
}
