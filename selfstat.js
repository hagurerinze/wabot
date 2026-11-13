// Kondisi laptop tempat bot berjalan: suhu, baterai, charger, beban, RAM, uptime
import fs from 'fs'
import os from 'os'

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim()
  } catch {
    return null
  }
}

export function getSelfStatus() {
  const parts = []

  let tempPath = '/sys/class/thermal/thermal_zone0/temp'
  try {
    for (const z of fs.readdirSync('/sys/class/thermal')) {
      if (z.startsWith('thermal_zone') && read(`/sys/class/thermal/${z}/type`) === 'x86_pkg_temp') {
        tempPath = `/sys/class/thermal/${z}/temp`
        break
      }
    }
  } catch {}
  const t = Number(read(tempPath))
  if (t) parts.push(`suhu CPU ${Math.round(t / 1000)}°C`)

  let bat = null
  let ac = null
  try {
    for (const d of fs.readdirSync('/sys/class/power_supply')) {
      const base = `/sys/class/power_supply/${d}`
      const type = read(`${base}/type`)
      if (type === 'Battery' && bat === null) {
        bat = { cap: Number(read(`${base}/capacity`)), status: read(`${base}/status`) || 'tidak diketahui' }
      } else if (type === 'Mains') {
        ac = read(`${base}/online`) === '1'
      }
    }
  } catch {}
  if (bat) {
    let s = `baterai ${bat.cap}% (${bat.status})`
    if (bat.cap === 0) {
      s += ', baterainya sudah rusak sehingga terbaca 0%, laptop selalu memakai charger, jadi itu bukan tanda laptop akan mati'
    }
    parts.push(s)
  } else {
    parts.push('tidak ada baterai terdeteksi')
  }
  if (ac !== null) parts.push(`charger ${ac ? 'terpasang' : 'tidak terpasang'}`)

  parts.push(`beban ${os.loadavg()[0].toFixed(2)}`)
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8')
    const get = (k) => Number(mi.match(new RegExp(k + ':\\s+(\\d+)'))[1]) / 1024
    parts.push(`RAM terpakai ${Math.round(get('MemTotal') - get('MemAvailable'))}/${Math.round(get('MemTotal'))} MB`)
  } catch {}
  const s = Math.floor(os.uptime())
  parts.push(`nyala ${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`)

  return parts.join(', ')
}
