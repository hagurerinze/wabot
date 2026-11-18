// Ambil teks dari halaman web dengan aman (anti-SSRF, batas ukuran dan waktu)
import http from 'http'
import https from 'https'
import dns from 'dns'
import net from 'net'
import zlib from 'zlib'

const MAX_BYTES = 1024 * 1024
const MAX_TEXT = 6000
const TOTAL_MS = 8000
const MAX_REDIRECTS = 3

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase()
    if (x === '::' || x === '::1') return true
    if (/^fe[89ab]/.test(x) || /^f[cd]/.test(x)) return true
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (m) return isPrivateIp(m[1])
    if (x.startsWith('::ffff:')) return true
    return false
  }
  return true
}

// dicek saat koneksi dibuat, jadi tidak bisa ditipu DNS yang berubah-ubah
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err)
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('blocked'))
    if (options && options.all) return cb(null, addrs)
    cb(null, addrs[0].address, addrs[0].family)
  })
}

function allowedUrl(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  if (u.port && u.port !== '80' && u.port !== '443') return false
  return true
}

function fetchOnce(u, signal) {
  return new Promise((resolve, reject) => {
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) && isPrivateIp(host)) return reject(new Error('blocked'))
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: host,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'GET',
        lookup: safeLookup,
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; YurishyBot/1.0)',
          Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
          'Accept-Language': 'id,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy()
          return resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) })
        }
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        let stream = res
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip())
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())
        const chunks = []
        let size = 0
        let done = false
        const finish = (err) => {
          if (done) return
          done = true
          req.destroy()
          if (err) reject(err)
          else resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        }
        res.on('error', finish)
        stream.on('error', finish)
        stream.on('data', (c) => {
          size += c.length
          if (size > MAX_BYTES) {
            chunks.push(c.subarray(0, c.length - (size - MAX_BYTES)))
            finish()
          } else {
            chunks.push(c)
          }
        })
        stream.on('end', () => finish())
      },
    )
    req.on('error', reject)
    req.end()
  })
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
    }
    return ENT[e.toLowerCase()] ?? m
  })
}

function toText(raw, type) {
  let out
  if (/html|xml/.test(type) || /^\s*</.test(raw)) {
    const title = decodeEntities((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim()
    const body = raw
      .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
    const lines = decodeEntities(body)
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l, i, a) => l && l !== a[i - 1])
    out = (title ? `Judul: ${title}\n` : '') + lines.join('\n')
  } else {
    out = raw.replace(/[ \t]+/g, ' ').trim()
  }
  return out.slice(0, MAX_TEXT)
}

export async function readLink(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, why: 'alamat tidak valid' }
  }
  if (!allowedUrl(u)) return { ok: false, why: 'alamat tidak diizinkan' }
  const signal = AbortSignal.timeout(TOTAL_MS)
  try {
    let cur = u
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const r = await fetchOnce(cur, signal)
      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        cur = new URL(r.headers.location, cur)
        if (!allowedUrl(cur)) return { ok: false, why: 'alamat tidak diizinkan' }
        continue
      }
      if (r.status >= 400) return { ok: false, why: `situsnya membalas error ${r.status}` }
      const type = String(r.headers['content-type'] || '').toLowerCase()
      if (type && !/^(text\/|application\/(xhtml\+xml|json|xml))/.test(type)) {
        return { ok: false, why: 'isinya bukan halaman teks' }
      }
      const cs = (type.match(/charset=([\w-]+)/) || [])[1] || 'utf-8'
      let raw2
      try {
        raw2 = new TextDecoder(cs).decode(r.body)
      } catch {
        raw2 = new TextDecoder('utf-8').decode(r.body)
      }
      const text = toText(raw2, type)
      if (!text) return { ok: false, why: 'halamannya kosong atau isinya dimuat lewat script' }
      return { ok: true, url: cur.href, text }
    }
    return { ok: false, why: 'terlalu banyak pengalihan' }
  } catch (e) {
    if (e.message === 'blocked') return { ok: false, why: 'alamat tidak diizinkan' }
    if (e.name === 'TimeoutError' || e.name === 'AbortError' || /abort|timeout/i.test(e.message)) {
      return { ok: false, why: 'waktu habis' }
    }
    return { ok: false, why: 'gagal dibuka' }
  }
}

export function findLinks(text) {
  const found = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || []
  const clean = found.map((l) => l.replace(/[.,!?;:]+$/, ''))
  return [...new Set(clean)].slice(0, 2)
}
