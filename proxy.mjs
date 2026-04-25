/**
 * Local ComicK proxy — run with: node proxy.mjs
 * Sits on http://localhost:3001 and forwards /comick/* to ComicK,
 * following redirects server-side and adding CORS headers.
 * Check the console to see what URL ComicK actually resolves to.
 */
import { createServer } from 'node:http'

const PORT = 3001
const COMICK_BASE = 'https://api.comick.io'
const PREFIX = '/comick'

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (!req.url?.startsWith(PREFIX)) {
    res.writeHead(404)
    res.end('not found')
    return
  }

  const path = req.url.slice(PREFIX.length) // e.g. /v1.0/search?q=Gantz
  const target = `${COMICK_BASE}${path}`

  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://comick.io/',
        'Origin': 'https://comick.io',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'cookie': 'cf_clearance=t5WtD3BuLDyWTAL_Je3OTyVESwI2nYj7p3dGGwn2oRM-1777109877-1.2.1.1-VEaN2oEszEkX_lSboSAYMGnh7FvuYKQBNpVDsNTCu3_YmZ.47ZnPnvUOnSrrjcYcSYd8vZ269zkCBc5zg4J5qcTHge_fkU9pgPTytI1eDTQR09X0PCQ2v.1H_SfI4ml9OGa3od9oBwlKWL3Y6DhvFY_zz7iQ8i6EfgT.Hej5VB3e8DpbTJEmEjN0j9hl8KDOSxiShZgtzQoAo_UR4y5wBrSpwR.eqkEZCkM3ieIdVUa7nFxUgtLbfdPlQHg_HGqy_E9k7yIT8gTVMtbmejisMYNAtGsfNjctlUcJKJ4bhJI2LPDZtLksPKscYNAdUfcD3EopGPvPwgBmAsCLfdhH5w',
      },
    })

    // Log the final URL so we can see where ComicK actually lives
    console.log(`[${upstream.status}] ${upstream.url}`)

    const body = await upstream.text()
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(body)
  } catch (err) {
    console.error('Proxy error:', err.message)
    res.writeHead(502)
    res.end(JSON.stringify({ error: err.message }))
  }
}).listen(PORT, () => {
  console.log(`ComicK proxy → http://localhost:${PORT}${PREFIX}`)
})
