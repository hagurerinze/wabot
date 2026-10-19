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
import { saveMessage, getHistory, clearHistory } from './db.js'
import { askGemini } from './ai.js'
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
    if (isMentioned && !text.startsWith('!')) {
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
        '!sticker (kirim gambar dengan caption ini)\n!history\n!reset\n\n' +
        'Pesan !ai dikirim ke Gemini dan disimpan di laptop owner. !reset menghapus riwayatmu.'
      )
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
      const who = isOwner ? 'Hagure (pemilikmu)' : cleanName(m.pushName) || 'tidak diketahui'
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
        const stored = image ? `[gambar] ${q}` : q
        const history = [...getHistory(key, 9), { role: 'user', content: stored }]
        const answer = await askGemini(history, image, who)
        saveMessage(key, 'user', stored)
        saveMessage(key, 'model', answer)
        await reply(answer)
      } catch (e) {
        console.error(e.message)
        await reply('AI lagi error, coba lagi nanti.')
      }
    }
  })
}

start()
