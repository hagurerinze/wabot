import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import pino from 'pino'

const PHONE = process.env.BOT_NUMBER

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
      ''
    const jid = m.key.remoteJid

    if (text === '!ping') {
      await sock.sendMessage(jid, { text: 'pong' }, { quoted: m })
    } else if (text === '!help') {
      await sock.sendMessage(jid, { text: 'Command:\n!ping\n!help' }, { quoted: m })
    }
  })
}

start()
