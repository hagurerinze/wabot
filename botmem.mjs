import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const dbPath = fileURLToPath(new URL('./bot.db', import.meta.url))
const [cmd = 'overview', arg] = process.argv.slice(2)
const writing = ['delfact', 'delperson', 'editfact', 'editsummary', 'addfact', 'renumber'].includes(cmd)
const db = new Database(dbPath, { readonly: writing === false, fileMustExist: true })

const short = (s, n = 70) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n)
const like = (s) => `%${s ?? ''}%`
const fmt = (ts) => new Date(ts).toLocaleString('id-ID')

const lastMsg = db.prepare(
  "select content from messages where role = 'user' and (chat = ? or chat like ?) order by id desc limit 1"
)
function who(person) {
  const r = lastMsg.get(person, `%|${person}`)
  return r ? `"${short(r.content, 50)}"` : '(tidak ada pesan tersimpan)'
}

function usage() {
  console.log(`botmem            ringkasan isi memori
botmem facts [orang]       daftar fakta (filter: sebagian id orang)
botmem summaries [chat]    ringkasan per chat
botmem chat <chat>         30 pesan terakhir sebuah chat
botmem delfact <id>        hapus satu fakta
botmem delperson <id>      hapus semua fakta satu orang (id lengkap)
botmem editfact <id> <teks>   ganti teks satu fakta
botmem editsummary <chat>  ubah ringkasan di editor teks
botmem addfact <orang> <teks>   tambah fakta manual
botmem renumber            susun ulang id fakta mulai dari 1`)
}

if (cmd === 'overview') {
  const n = (t) => db.prepare(`select count(*) as n from ${t}`).get().n
  console.log(`pesan: ${n('messages')} | ringkasan: ${n('summaries')} | fakta: ${n('facts')}\n`)
  const people = db
    .prepare('select person, count(*) as n from facts group by person order by n desc')
    .all()
  console.log('Orang yang punya fakta:')
  if (people.length === 0) console.log('  (belum ada)')
  for (const p of people) console.log(`  ${p.person} (${p.n} fakta) terakhir bilang: ${who(p.person)}`)
  console.log('\nChat terbaru:')
  const chats = db
    .prepare('select chat, count(*) as n from messages group by chat order by max(id) desc limit 10')
    .all()
  for (const c of chats) console.log(`  ${c.chat} (${c.n} pesan)`)
} else if (cmd === 'facts') {
  const rows = db
    .prepare('select id, person, fact from facts where person like ? order by person, id')
    .all(like(arg))
  if (rows.length === 0) console.log('Tidak ada fakta.')
  let current = ''
  let n = 0
  for (const r of rows) {
    if (r.person !== current) {
      current = r.person
      n = 0
      console.log(`\n${current}  terakhir bilang: ${who(current)}`)
    }
    n += 1
    console.log(`  ${n}. ${r.fact}   [id ${r.id}]`)
  }
} else if (cmd === 'summaries') {
  const rows = db
    .prepare('select chat, summary, ts from summaries where chat like ? order by ts desc')
    .all(like(arg))
  if (rows.length === 0) console.log('Tidak ada ringkasan.')
  for (const r of rows) console.log(`\n${r.chat}  (${fmt(r.ts)})\n${r.summary}`)
} else if (cmd === 'chat') {
  if (arg === undefined) {
    usage()
  } else {
    const chats = db.prepare('select distinct chat from messages where chat like ?').all(like(arg))
    if (chats.length === 0) {
      console.log('Chat tidak ketemu.')
    } else if (chats.length > 1) {
      console.log('Lebih dari satu chat cocok, perjelas filternya:')
      for (const c of chats) console.log(`  ${c.chat}`)
    } else {
      const rows = db
        .prepare('select role, content, ts from messages where chat = ? order by id desc limit 30')
        .all(chats[0].chat)
        .reverse()
      console.log(`${chats[0].chat}\n`)
      for (const r of rows) {
        console.log(`[${fmt(r.ts)}] ${r.role === 'user' ? 'orang' : 'yurishy'}: ${short(r.content, 300)}`)
      }
    }
  }
} else if (cmd === 'delfact') {
  const row = db.prepare('select id, person, fact from facts where id = ?').get(Number(arg))
  if (row === undefined) {
    console.log('Fakta dengan id itu tidak ada.')
  } else {
    db.prepare('delete from facts where id = ?').run(row.id)
    console.log(`Dihapus: #${row.id} ${row.fact}  (${row.person})`)
  }
} else if (cmd === 'delperson') {
  const n = arg === undefined ? 0 : db.prepare('select count(*) as n from facts where person = ?').get(arg).n
  if (n === 0) {
    console.log('Tidak ada fakta untuk id itu. Pakai id lengkap persis.')
  } else {
    db.prepare('delete from facts where person = ?').run(arg)
    console.log(`Dihapus ${n} fakta milik ${arg}`)
  }
} else if (cmd === 'editfact') {
  const text = process.argv.slice(4).join(' ').trim()
  const row = db.prepare('select id, person, fact from facts where id = ?').get(Number(arg))
  if (row === undefined) {
    console.log('Fakta dengan id itu tidak ada.')
  } else if (text.length < 4 || text.length > 120) {
    console.log("Teks baru harus 4-120 karakter. Contoh: botmem editfact 13 'Suka lagu Jepang'")
  } else {
    try {
      db.prepare('update facts set fact = ? where id = ?').run(text, row.id)
      console.log(`Diubah #${row.id}:\n  sebelum: ${row.fact}\n  sesudah: ${text}`)
    } catch (e) {
      console.log('Gagal (mungkin fakta yang sama sudah ada untuk orang itu):', e.message)
    }
  }
} else if (cmd === 'editsummary') {
  if (arg === undefined) {
    usage()
  } else {
    const rows = db.prepare('select chat, summary from summaries where chat like ?').all(like(arg))
    if (rows.length === 0) {
      console.log('Ringkasan tidak ketemu.')
    } else if (rows.length > 1) {
      console.log('Lebih dari satu ringkasan cocok, perjelas filternya:')
      for (const r of rows) console.log(`  ${r.chat}`)
    } else {
      const file = join(tmpdir(), `botmem-${Date.now()}.txt`)
      writeFileSync(file, rows[0].summary)
      spawnSync(process.env.EDITOR || process.env.VISUAL || 'nano', [file], { stdio: 'inherit' })
      const edited = readFileSync(file, 'utf8').trim()
      unlinkSync(file)
      if (edited === '') {
        console.log('Kosong, tidak diubah.')
      } else if (edited === rows[0].summary) {
        console.log('Tidak ada perubahan.')
      } else {
        db.prepare('update summaries set summary = ?, ts = ? where chat = ?').run(edited, Date.now(), rows[0].chat)
        console.log('Ringkasan diperbarui.')
      }
    }
  }
} else if (cmd === 'addfact') {
  const text = process.argv.slice(4).join(' ').trim()
  if (arg === undefined || text.length < 4 || text.length > 120) {
    console.log("Pakai: botmem addfact <id-orang> '<teks 4-120 karakter>'")
  } else {
    let person = arg
    let problem = ''
    if (arg.includes('@') === false) {
      const found = db
        .prepare(
          `select person from (
             select person from facts
             union
             select case when instr(chat, '|') > 0 then substr(chat, instr(chat, '|') + 1) else chat end as person from messages
           ) where person like ? and person not like '%@g.us'`
        )
        .all(like(arg))
      if (found.length === 1) {
        person = found[0].person
      } else {
        problem =
          found.length === 0
            ? 'Orang tidak ketemu. Pakai id lengkap atau potongan id yang unik.'
            : 'Lebih dari satu orang cocok, perjelas filternya.'
      }
    }
    if (problem !== '') {
      console.log(problem)
    } else {
      const n = db.prepare('select count(*) as n from facts where person = ?').get(person).n
      if (n >= 25) {
        console.log('Orang ini sudah punya 25 fakta. Hapus satu dulu (botmem delfact <id>).')
      } else {
        const r = db
          .prepare('insert or ignore into facts (person, fact, ts) values (?, ?, ?)')
          .run(person, text, Date.now())
        console.log(r.changes === 0 ? 'Fakta itu sudah ada.' : `Ditambah untuk ${person}: ${text}`)
      }
    }
  }
} else if (cmd === 'renumber') {
  const rows = db.prepare('select person, fact, ts from facts order by id').all()
  db.transaction(() => {
    db.prepare('delete from facts').run()
    db.prepare("delete from sqlite_sequence where name = 'facts'").run()
    const ins = db.prepare('insert into facts (person, fact, ts) values (?, ?, ?)')
    for (const r of rows) ins.run(r.person, r.fact, r.ts)
  })()
  console.log(`Id fakta disusun ulang: ${rows.length} fakta, id mulai dari 1.`)
} else {
  usage()
}
