// Aplikasi yang sedang aktif di laptop + screenshot (X11). Hanya label kasar, tanpa judul jendela.
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Label aplikasi web (PWA Brave). Isi di .env: ACTIVITY_APPS=idaplikasi=Nama,idlain=Nama2
const APPS = {}
for (const part of (process.env.ACTIVITY_APPS || '').split(',')) {
  const i = part.indexOf('=')
  if (i > 0) APPS[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
}

// Daftar putih: hanya yang ada di sini yang disebut. Selain itu: "aplikasi lain".
const LABELS = {
  'brave-browser': 'browser (Brave)',
  geany: 'editor kode (Geany)',
  'xfce4-terminal': 'terminal',
  thunar: 'file manager',
  mpv: 'pemutar video',
}

function xprop(args) {
  return execFileSync('xprop', args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })
}

export function getActivity() {
  try {
    const id = xprop(['-root', '_NET_ACTIVE_WINDOW']).trim().split(/\s+/).pop()
    if (/^0x0+$/i.test(id)) return 'tidak ada jendela yang aktif (desktop kosong)'
    if (!/^0x[0-9a-f]+$/i.test(id)) return 'tidak diketahui'
    const m = xprop(['-id', id, 'WM_CLASS']).match(/"([^"]*)",\s*"([^"]*)"/)
    if (!m) return 'tidak diketahui'
    const inst = m[1].toLowerCase()
    const klass = m[2].toLowerCase()
    if (inst.startsWith('crx_')) {
      const name = APPS[inst.slice(4)]
      return name ? `aplikasi web ${name} (lewat Brave)` : 'aplikasi web (lewat Brave)'
    }
    return LABELS[klass] || LABELS[inst] || 'aplikasi lain'
  } catch {
    return 'tidak bisa dibaca (layar tidak bisa diakses)'
  }
}

export function takeScreenshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'))
  const file = path.join(dir, 'layar.jpg')
  try {
    execFileSync('scrot', ['-q', '70', file], { timeout: 6000, stdio: 'ignore' })
    return fs.readFileSync(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
