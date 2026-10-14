const ACCOUNT = process.env.CF_ACCOUNT_ID
const TOKEN = process.env.CF_API_TOKEN
const MODEL = process.env.CF_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell'

export async function generateImage(prompt) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: AbortSignal.timeout(60000),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Cloudflare ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const b64 = data.result?.image
  if (!b64) throw new Error('Tidak ada gambar di respons')
  return Buffer.from(b64, 'base64')
}

