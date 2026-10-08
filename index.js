import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'
import { saveMessage, getHistory, clearHistory } from './db.js'
import { askGemini } from './ai.js'

const PHONE = process.env.BOT_NUMBER
const OWNER = process.env.OWNER_ID

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

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      ''
    const jid = m.key.remoteJid
    const sender = m.key.participant || m.key.remoteJid
    console.log('dari:', sender, '| isi:', text)
    const isOwner = OWNER && sender === OWNER

    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: m })

    if (text === '!ping') {
      await reply('pong')
    } else if (text === '!help') {
      await reply(
        'Command:\n!ping\n!help\n!uptime\n!sysinfo (owner)\n' +
        '!history\n!reset\n!ai <pertanyaan> (owner)'
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
      if (jid.endsWith('@g.us') && !isOwner) return reply('Di grup, command ini khusus owner.')
      const h = getHistory(jid, 5)
      await reply(h.length ? h.map((x) => `${x.role}: ${x.content}`).join('\n') : 'Belum ada riwayat.')
    } else if (text === '!reset') {
      if (jid.endsWith('@g.us') && !isOwner) return reply('Di grup, command ini khusus owner.')
      clearHistory(jid)
      await reply('Riwayat chat ini dihapus.')
    } else if (text.startsWith('!ai ')) {
      if (!isOwner) return reply('Fitur AI sementara khusus owner.')
      const q = text.slice(4).trim()
      if (!q) return reply('Contoh: !ai apa itu Debian?')
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
        const history = [...getHistory(jid, 9), { role: 'user', content: stored }]
        const answer = await askGemini(history, image)
        saveMessage(jid, 'user', stored)
        saveMessage(jid, 'model', answer)
        await reply(answer)
      } catch (e) {
        console.error(e)
        await reply('AI lagi error, coba lagi nanti.')
      }
    }
  })
}

start()
