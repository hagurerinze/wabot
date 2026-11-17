// Kirim pesan ke grup lewat Yurishy, diketik apa adanya (tanpa AI)
import readline from 'readline'
import { listGroups, queueOutbox } from './db.js'

const groups = listGroups()
const args = process.argv.slice(2)

if (groups.length === 0) {
  console.log('Daftar grup masih kosong. Nyalakan bot dulu (boton), tunggu beberapa detik, lalu coba lagi.')
  process.exit(1)
}
if (args.length === 0) {
  console.log('Grup yang dikenal Yurishy:')
  groups.forEach((g, i) => console.log(`${i + 1}. ${g.name}`))
  console.log('\nPakai: botsay <nomor atau potongan nama> [pesan]')
  console.log('Kalau pesan dikosongkan, kamu akan diminta mengetiknya.')
  process.exit(0)
}

const target = args[0]
let picked = []
if (/^\d+$/.test(target)) {
  const g = groups[Number(target) - 1]
  if (g) picked = [g]
} else {
  picked = groups.filter((g) => g.name.toLowerCase().includes(target.toLowerCase()))
}
if (picked.length === 0) {
  console.log(`Grup "${target}" tidak ketemu. Jalankan botsay tanpa argumen untuk melihat daftar.`)
  process.exit(1)
}
if (picked.length > 1) {
  console.log(`"${target}" cocok dengan lebih dari satu grup, pakai nomor atau nama yang lebih spesifik:`)
  picked.forEach((g) => console.log(`- ${g.name}`))
  process.exit(1)
}
const group = picked[0]

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((res) => rl.question(q, res))

let text = args.slice(1).join(' ').trim()
if (!text) text = (await ask('Pesan> ')).trim()
if (!text) {
  console.log('Pesan kosong, dibatalkan.')
  rl.close()
  process.exit(1)
}
if (text.length > 1000) {
  console.log('Pesan terlalu panjang (maks 1000 huruf), dibatalkan.')
  rl.close()
  process.exit(1)
}

console.log(`\nKirim ke grup "${group.name}":\n${text}\n`)
const ok = (await ask('Kirim? (y/N) ')).trim().toLowerCase()
rl.close()
if (ok !== 'y') {
  console.log('Dibatalkan.')
  process.exit(0)
}
queueOutbox(group.jid, text)
console.log('Masuk antrean. Bot mengirim dalam beberapa detik (bot harus sedang nyala).')
