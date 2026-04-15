export const config = {
  runtime: 'nodejs'
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const ipRequestLog = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const history = ipRequestLog.get(ip) || [];
  const recent = history.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  ipRequestLog.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'GROQ_API_KEY belum diset di Vercel Environment Variables.' }
    });
  }

  const expectedProxyToken = process.env.SC_PROXY_SHARED_SECRET;
  if (expectedProxyToken) {
    const providedToken = req.headers['x-sc-proxy-key'];
    if (providedToken !== expectedProxyToken) {
      return res.status(401).json({ error: { message: 'Unauthorized proxy token.' } });
    }
  }

  const allowedOrigin = process.env.SC_ALLOWED_ORIGIN;
  if (allowedOrigin) {
    const requestOrigin = req.headers.origin || '';
    if (requestOrigin !== allowedOrigin) {
      return res.status(403).json({ error: { message: 'Origin not allowed.' } });
    }
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: { message: 'Rate limit exceeded. Try again shortly.' } });
  }

  try {
    const {
      model = 'llama-3.3-70b-versatile',
      messages = [],
      temperature = 0.7,
      max_tokens = 1200,
      stream = true
    } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages wajib diisi.' } });
    }
    if (messages.length > 20) {
      return res.status(400).json({ error: { message: 'messages terlalu banyak.' } });
    }
    const oversizedMessage = messages.find(m => typeof m?.content !== 'string' || m.content.length > 4000);
    if (oversizedMessage) {
      return res.status(400).json({ error: { message: 'Format messages tidak valid atau terlalu panjang.' } });
    }

    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens, stream })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).send(text);
    }

    // Forward SSE stream langsung ke client
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    return res.end();
  } catch (err) {
    return res.status(500).json({
      error: { message: `Proxy error: ${err.message}` }
    });
  }
}
