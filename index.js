import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  jidNormalizedUser,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { execSync, execFile } from 'child_process'
import { promisify } from 'util'
import { saveMessage, getHistory, clearHistory, countMessages, getOldest, deleteMessages, getSummary, saveSummary, getFacts, addFacts, deleteFacts, getSelfNotes, saveSelfNotes, addProposals, getProposalDecisions, addTodos, listTodos, finishTodos, removeTodos, clearTodos, addEpisode, findEpisodes } from './db.js'
import { askGemini, summarizeChat, extractFacts, reflectOnChat, makeEpisode } from './ai.js'
import { getWeather } from './weather.js'
import { getSelfStatus } from './selfstat.js'
const SELF_WORD = /\b(?:suhu|panas|baterai|batre|baterei|battery|charger|cpu|ram|uptime|kondisi)\b/i
const WEATHER_WORD = /\b(?:cuaca|hujan|gerimis|mendung|payung|weather|suhu|jemur)\b/i

// ---- todo lewat obrolan biasa ----
const TODO_WORD = /\b(?:to-?do|to do|tugas)\b/i
const TODO_ADD_VERB = /\b(?:tambah|catat|masukin|masukkan)\w*/i
const TODO_DONE_WORD = /\b(?:selesai|beres|kelar)\b/i
const TODO_LIST_Q = /\b(?:to-?do|to do)\b(?:\s*(?:ku|gw|gue|aku|saya|kita))?\s*(?:apa|apaan|list|daftar|berapa)\b|\b(?:lihat|liat|cek|spill|tunjukin|kasih tau)\b[\s\S]{0,12}\b(?:to-?do|to do)\b/i

function cleanTodoText(x) {
  return String(x).replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function applyTodoMarks(sender, marks) {
  const out = []
  const adds = marks.filter((x) => x.kind === 'ADD').flatMap((x) => x.items).map(cleanTodoText).filter(Boolean)
  if (adds.length) {
    const picked = adds.slice(0, 10)
    const r = addTodos(sender, picked)
    if (r.added > 0) out.push(`Kucatat: ${picked.join('; ')}.`)
    if (r.dup > 0) out.push(`${r.dup} sudah ada.`)
    if (r.full > 0) out.push(`${r.full} tidak muat, batasnya 30 yang terbuka.`)
    if (adds.length > picked.length) out.push('Maksimal 10 per pesan, sisanya belum kucatat.')
    if (r.added > 0) out.push(`Total ${r.total} yang terbuka.`)
  }
  const dones = marks.filter((x) => x.kind === 'DONE').flatMap((x) => x.items).slice(0, 10)
  const nums = dones.filter((x) => /^\d+$/.test(x)).map(Number)
  if (nums.length) {
    const r = finishTodos(sender, nums)
    out.push(r.length ? `Beres ${r.length}: ${r.join('; ')}` : 'Nomornya nggak ada. Cek lagi lewat !todo.')
  }
  for (const kw of dones.filter((x) => !/^\d+$/.test(x))) {
    const hits = listTodos(sender)
      .map((x, i) => ({ n: i + 1, text: x.text }))
      .filter((x) => x.text.toLowerCase().includes(kw.toLowerCase()))
    if (hits.length === 1) {
      finishTodos(sender, [hits[0].n])
      out.push(`Beres: ${hits[0].text}`)
    } else if (hits.length === 0) {
      out.push(`Nggak ada todo yang cocok dengan "${kw}". Cek lewat !todo.`)
    } else {
      out.push(`"${kw}" cocok dengan beberapa todo:\n${hits.map((h) => `${h.n}. ${h.text}`).join('\n')}\nSebut nomornya ya.`)
    }
  }
  return out.join('\n')
}

// dikerjakan kode langsung, tanpa AI: lihat daftar dan selesai pakai nomor
function todoDirect(sender, q) {
  if (TODO_LIST_Q.test(q) && !TODO_ADD_VERB.test(q)) {
    const items = listTodos(sender)
    return items.length
      ? items.map((x, i) => `${i + 1}. ${x.text}`).join('\n')
      : 'Kosong. Lagi nggak ada kerjaan, atau lupa nulis?'
  }
  if (/\b(?:to-?do|to do)\b[^\d]{0,15}\d/i.test(q) && TODO_DONE_WORD.test(q) && !TODO_ADD_VERB.test(q)) {
    const nums = (q.match(/\d+/g) || []).map(Number).filter((n) => n > 0 && n <= 30)
    if (nums.length) return applyTodoMarks(sender, [{ kind: 'DONE', items: nums.map(String) }])
  }
  return null
}

// cadangan kalau semua AI gagal: hanya menambah
function todoFallback(sender, q) {
  if (!TODO_ADD_VERB.test(q) || !TODO_WORD.test(q)) return null
  const w = q.match(/\b(?:to-?do|to do|tugas)\b/i)
  const rest = q
    .slice(w.index + w[0].length)
    .replace(/^(?:[\s,:\-]|\b(?:ku|gw|gue|aku|saya|dong|donk|ya|yuk|yuri|ttg|tentang|tambah\w*|catat\w*|masuk\w*)\b)+/i, '')
  const items = rest.split(/[\n;]+/).map(cleanTodoText).filter(Boolean)
  return items.length ? applyTodoMarks(sender, [{ kind: 'ADD', items }]) : null
}
import { generateImage } from './img.js'

const execFileAsync = promisify(execFile)

const PHONE = process.env.BOT_NUMBER
const OWNER = process.env.OWNER_ID
const BLOCKED = (process.env.BLOCKED || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

let lastImg = 0
let stickerBusy = false
const hits = new Map()

// true = boleh, false = kena batas
function allow(key, max, windowMs) {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    hits.set(key, arr)
    return false
  }
  arr.push(now)
  hits.set(key, arr)
  return true
}

const cleanName = (n) =>
  (n || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 24)

const SUMMARY_MAX = 30
const SUMMARY_KEEP = 10
const compacting = new Set()
const REFLECT_MIN_MS = 6 * 3600 * 1000
let lastReflect = getSelfNotes().ts || 0
async function compactChat(key, person) {
  if (compacting.has(key)) return
  if (countMessages(key) <= SUMMARY_MAX) return
  compacting.add(key)
  try {
    const old = getOldest(key, countMessages(key) - SUMMARY_KEEP)
    const summary = await summarizeChat(getSummary(key), old)
    saveSummary(key, summary)
    try {
      const ep = await makeEpisode(old)
      addEpisode(key, ep.text, ep.tags, old[0]?.ts, old[old.length - 1]?.ts)
    } catch (e) {
      console.error('kartu gagal:', e.message)
    }
    try {
      addFacts(person, await extractFacts(getFacts(person), old))
    } catch (e) {
      console.error('fakta gagal:', e.message)
    }
    if (Date.now() - lastReflect > REFLECT_MIN_MS) {
      lastReflect = Date.now()
      try {
        const cur = getSelfNotes()
        const r = await reflectOnChat(cur.body, old, getProposalDecisions(), cur.reason)
        if (r.notes !== null && r.notes !== cur.body) saveSelfNotes(r.notes, 'refleksi')
        addProposals(r.proposals)
        console.log('catatan: refleksi selesai,', r.proposals.length, 'usulan')
      } catch (e) {
        console.error('catatan gagal:', e.message)
      }
    }
    deleteMessages(old.map((x) => x.id))
    console.log('summary: updated,', old.length, 'messages')
  } catch (e) {
    console.error('summary gagal:', e.message)
  } finally {
    compacting.delete(key)
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  })

  // Login pakai pairing code (tanpa QR)
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(PHONE)
      console.log('Kode pairing:', code)
    }, 3000)
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log('Bot terhubung')
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        console.log('Terputus, mencoba konek lagi...')
        start()
      } else {
        console.log('Logout. Hapus folder auth lalu jalankan ulang.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    const m = messages[0]
    if (!m.message || m.key.fromMe) return

    let text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      ''

    const ctx =
      m.message.extendedTextMessage?.contextInfo ||
      m.message.imageMessage?.contextInfo
    const mentioned = (ctx?.mentionedJid || []).map(jidNormalizedUser)
    const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser)
    const isMentioned = mentioned.some((j) => me.includes(j))
    if (mentioned.length) console.log('mention:', mentioned, 'bot:', me)
    // reply ke pesan bot dan chat pribadi juga dianggap !ai
    const quotedFrom = ctx?.participant ? jidNormalizedUser(ctx.participant) : ''
    const isReplyToBot = !!quotedFrom && me.includes(quotedFrom)
    const isDM = /@(s\.whatsapp\.net|lid)$/.test(m.key.remoteJid)
    const qm = ctx?.quotedMessage
    const quotedText = (
      qm?.conversation || qm?.extendedTextMessage?.text || qm?.imageMessage?.caption || ''
    ).trim()
    if (!text.startsWith('!') && text.trim() && (isMentioned || isReplyToBot || isDM)) {
      text = '!ai ' + text.replace(/@\d+/g, '').trim()
    }

    const jid = m.key.remoteJid
    const sender = m.key.participant || m.key.remoteJid
    if (BLOCKED.includes(sender)) return
    if (text.startsWith('!')) console.log('cmd:', text.split(' ')[0], '| dari:', sender)
    const isOwner = OWNER && sender === OWNER
    // di grup, riwayat dipisah per orang
    const key = jid.endsWith('@g.us') ? `${jid}|${sender}` : jid

    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: m })

    if (text === '!ping') {
      await reply('pong')
    } else if (text === '!help') {
      await reply(
        'Command:\n!ping\n!help\n!uptime\n!ai <pertanyaan> (bisa kirim gambar)\n' +
        '!sticker (kirim gambar dengan caption ini)\n!history\n!reset\n!forget (hapus fakta tentangmu)\n!todo (daftar tugas pribadi, tiap orang punya sendiri)\n\n' +
        'Pesan !ai dikirim ke layanan AI (Gemini, Cloudflare, dan lainnya) dan disimpan di laptop owner. !reset menghapus riwayatmu. Daftar !todo juga disimpan di laptop owner tapi daftarnya tidak dikirim ke AI (pesan yang kamu ketik tentang todo tetap lewat AI seperti pesan biasa), dan !todo kosongkan menghapus semuanya.'
      )
    } else if (text === '!todo' || /^!todo\s/.test(text)) {
      if (!isOwner && !allow(`todo:${sender}`, 10, 60000)) return reply('Pelan-pelan, tunggu sebentar ya.')
      const body = text.slice(5).trim()
      const head = body.split(/\s+/)[0].toLowerCase()
      if (body === '' || head === 'list') {
        const items = listTodos(sender)
        await reply(
          items.length
            ? items.map((x, i) => `${i + 1}. ${x.text}`).join('\n')
            : 'Kosong. Lagi nggak ada kerjaan, atau lupa nulis?'
        )
      } else if (head === 'kosongkan') {
        clearTodos(sender)
        await reply('Semua todo-mu sudah kuhapus.')
      } else if (head === 'selesai' || head === 'hapus') {
        const nums = body.split(/[\s,]+/).slice(1).map(Number).filter((n) => Number.isInteger(n) && n > 0)
        const done = head === 'selesai' ? finishTodos(sender, nums) : removeTodos(sender, nums)
        await reply(
          done.length
            ? `${head === 'selesai' ? 'Beres' : 'Kuhapus'} ${done.length}: ${done.join('; ')}`
            : 'Nomornya nggak ada. Cek lagi lewat !todo.'
        )
      } else {
        const raw = head === 'tambah' ? body.slice(6) : body
        const clean = (x) => x.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 200)
        const all = raw.split(/[\n;]+/).map(clean).filter(Boolean)
        const picked = all.slice(0, 10)
        if (picked.length === 0) return reply('Mau nulis apa? Contoh: !todo beli kabel')
        const r = addTodos(sender, picked)
        const out = []
        if (r.added > 0) out.push(`Oke, kucatat ${r.added} item.`)
        if (r.dup > 0) out.push(`${r.dup} sudah ada.`)
        if (r.full > 0) out.push(`${r.full} tidak muat, batasnya 30 yang terbuka.`)
        if (all.length > picked.length) out.push('Maksimal 10 per pesan, sisanya belum kucatat.')
        if (r.added > 0) out.push(`Total ${r.total} yang terbuka.`)
        await reply(out.join(' '))
      }
    } else if (text === '!forget') {
      deleteFacts(sender)
      await reply('Oke, fakta tentangmu sudah kuhapus.')
    } else if (text === '!uptime') {
      const s = Math.floor(os.uptime())
      const h = Math.floor(s / 3600)
      const mnt = Math.floor((s % 3600) / 60)
      await reply(`Laptop nyala: ${h} jam ${mnt} menit`)
    } else if (text === '!sysinfo') {
      if (!isOwner) return reply('Command ini khusus owner.')
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8')
      const get = (k) => Number(meminfo.match(new RegExp(k + ':\\s+(\\d+)'))[1]) / 1024
      const total = get('MemTotal')
      const avail = get('MemAvailable')
      let temp = '-'
      try {
        temp = Number(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000 + ' C'
      } catch {}
      const disk = execSync("df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}'").toString().trim()
      const load = os.loadavg().map((x) => x.toFixed(2)).join(' ')
      await reply(
        `RAM: ${(total - avail).toFixed(0)}/${total.toFixed(0)} MB\n` +
        `Load: ${load}\nSuhu: ${temp}\nDisk /: ${disk}`
      )
    } else if (text === '!history') {
      const h = getHistory(key, 5)
      await reply(h.length ? h.map((x) => `${x.role}: ${x.content}`).join('\n') : 'Belum ada riwayat.')
    } else if (text === '!reset') {
      clearHistory(key)
      await reply('Riwayat kamu dihapus.')
    } else if (text === '!sticker') {
      if (!m.message.imageMessage) return reply('Kirim gambar dengan caption !sticker')
      if (!isOwner && !allow(`st:${sender}`, 3, 60000)) {
        return reply('Pelan-pelan, tunggu sebentar ya.')
      }
      if (stickerBusy) return reply('Lagi membuat stiker lain, coba lagi sebentar.')
      stickerBusy = true
      const id = Date.now()
      const inFile = path.join(os.tmpdir(), `st-${id}.jpg`)
      const outFile = path.join(os.tmpdir(), `st-${id}.webp`)
      try {
        const buf = await downloadMediaMessage(m, 'buffer', {}, {
          logger: pino({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage,
        })
        if (buf.length > 5 * 1024 * 1024) return reply('Gambar terlalu besar (maks 5 MB).')
        fs.writeFileSync(inFile, buf)
        await execFileAsync('ffmpeg', [
          '-y', '-i', inFile,
          '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
          '-c:v', 'libwebp', '-quality', '70', '-an', outFile,
        ], { timeout: 20000 })
        await sock.sendMessage(jid, { sticker: fs.readFileSync(outFile) }, { quoted: m })
      } catch (e) {
        console.error(e.message)
        await reply('Gagal membuat stiker.')
      } finally {
        stickerBusy = false
        fs.rmSync(inFile, { force: true })
        fs.rmSync(outFile, { force: true })
      }
    } else if (text.startsWith('!img ')) {
      if (!isOwner) return reply('Fitur ini sementara khusus owner.')
      const prompt = text.slice(5).trim()
      if (!prompt) return reply('Contoh: !img kucing astronot di bulan')
      if (prompt.length > 300) return reply('Deskripsi terlalu panjang (maks 300 huruf).')
      const wait = 20000 - (Date.now() - lastImg)
      if (wait > 0) return reply(`Tunggu ${Math.ceil(wait / 1000)} detik lagi.`)
      lastImg = Date.now()
      try {
        const img = await generateImage(prompt)
        await sock.sendMessage(jid, { image: img, caption: prompt }, { quoted: m })
      } catch (e) {
        console.error(e.message)
        if (e.message.includes('429')) {
          await reply('Jatah gambar gratis hari ini habis, coba lagi besok.')
        } else {
          await reply('Gagal membuat gambar, coba lagi nanti.')
        }
      }
    } else if (text.startsWith('!ai ')) {
      if (!isOwner) {
        if (!allow(`ai:${sender}`, 5, 60000)) return reply('Pelan-pelan, tunggu sebentar ya.')
        if (!allow(`aid:${sender}`, 50, 86400000)) return reply('Jatah AI-mu hari ini habis, coba lagi besok.')
        if (!allow('ai:all', 300, 86400000)) return reply('Jatah AI hari ini habis untuk semua orang, coba lagi besok.')
      }
      const q = text.slice(4).trim()
      if (!q) return reply('Contoh: !ai apa itu Debian?')
      const who = isOwner
          ? 'Hagure (pemilikmu)'
          : `${cleanName(m.pushName) || 'tidak diketahui'} (bukan pemilik)`
      const todoMode = TODO_WORD.test(q)
      if (todoMode) {
        const direct = todoDirect(sender, q)
        if (direct) return reply(direct)
      }
      const todoMarks = []
      let weather = ''
      const selfstat = SELF_WORD.test(q) ? getSelfStatus() : ''
      const curSum = getSummary(key)
      const memories = findEpisodes(key, q, 4)
        .filter((e) => e.text !== curSum)
        .slice(0, 3)
        .map((e) => `(${new Date(e.ts_to).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' })}) ${e.text.slice(0, 600)}`)
      if (memories.length) console.log('kartu terpakai:', memories.length)
      if (WEATHER_WORD.test(q)) {
        try {
          weather = await getWeather()
        } catch (e) {
          console.error('cuaca:', e.message)
          weather = 'tidak tersedia sekarang (gagal diambil), jangan mengarang cuaca'
        }
      }
      try {
        let image
        if (m.message.imageMessage) {
          const buf = await downloadMediaMessage(m, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage,
          })
          if (buf.length > 4 * 1024 * 1024) return reply('Gambar terlalu besar (maks 4 MB).')
          image = {
            mime: m.message.imageMessage.mimetype || 'image/jpeg',
            data: buf.toString('base64'),
          }
        }
        const qctx = quotedText
          ? `[membalas pesan ${isReplyToBot ? 'Yurishy' : 'orang lain'}: "${quotedText.slice(0, 300)}"] `
          : ''
        const stored = image ? `[gambar] ${qctx}${q}` : `${qctx}${q}`
        const history = [...getHistory(key, 9), { role: 'user', content: stored }]
        const answer = await askGemini(history, image, who, getSummary(key), getFacts(sender), getSelfNotes().body, { todo: todoMode, marks: todoMarks, weather, selfstat, memories })
        const todoNote = todoMode ? applyTodoMarks(sender, todoMarks) : ''
        const finalText = [answer, todoNote].filter(Boolean).join('\n\n')
        if (!finalText) throw new Error('jawaban kosong')
        saveMessage(key, 'user', stored)
        saveMessage(key, 'model', answer || '(todo diproses)')
        await reply(finalText)
        compactChat(key, sender)
      } catch (e) {
        console.error(e.message)
        const fb = todoMode ? todoFallback(sender, q) : null
        await reply(fb ? `${fb}\n(AI lagi error, jadi kucatat langsung.)` : 'AI lagi error, coba lagi nanti.')
      }
    }
  })
}

start()
