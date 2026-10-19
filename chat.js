import readline from 'readline'
import { askGemini } from './ai.js'
import { saveMessage, getHistory, clearHistory } from './db.js'

const CHAT = 'terminal'
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
console.log('Chat dengan Yurishy. /reset hapus riwayat, /exit keluar.')

function loop() {
  rl.question('kamu> ', async (line) => {
    const q = line.trim()
    if (q === '/exit') return rl.close()
    if (q === '/reset') {
      clearHistory(CHAT)
      console.log('(riwayat terminal dihapus)')
    } else if (q) {
      try {
        const history = [...getHistory(CHAT, 9), { role: 'user', content: q }]
        const answer = await askGemini(history, undefined, 'Hagure (pemilikmu)')
        saveMessage(CHAT, 'user', q)
        saveMessage(CHAT, 'model', answer)
        console.log('\nYurishy> ' + answer + '\n')
      } catch (e) {
        console.error('error:', e.message)
      }
    }
    loop()
  })
}
loop()
