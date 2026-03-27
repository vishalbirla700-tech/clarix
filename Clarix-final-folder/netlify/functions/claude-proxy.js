// Clarix AI Proxy — Resilient Multi-Provider
// Order: Groq (fastest/cheapest) → Claude (best quality) → error

const PROVIDERS = [
  {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    getKey: () => Netlify.env.get('GROQ_API_KEY'),
    buildHeaders: (key) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    }),
    buildBody: (body) => ({
      model: 'llama-3.3-70b-versatile',
      max_tokens: body.max_tokens || 1000,
      messages: body.messages || []
    }),
    parseResponse: (data) => ({
      content: [{ text: data.choices?.[0]?.message?.content || '' }],
      _provider: 'Groq'
    })
  },
  {
    name: 'Claude',
    url: 'https://api.anthropic.com/v1/messages',
    getKey: () => Netlify.env.get('ANTHROPIC_API_KEY'),
    buildHeaders: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    }),
    buildBody: (body) => body,
    parseResponse: (data) => ({ ...data, _provider: 'Claude' })
  }
];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON', content: [{ text: '' }] }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }); }

  const errors = [];

  for (const provider of PROVIDERS) {
    const apiKey = provider.getKey();
    if (!apiKey) {
      errors.push({ provider: provider.name, error: 'No API key' });
      console.warn(`[Clarix] Skipping ${provider.name} — no API key`);
      continue;
    }

    try {
      console.log(`[Clarix] Trying ${provider.name}...`);
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: provider.buildHeaders(apiKey),
        body: JSON.stringify(provider.buildBody(body))
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const parsed = provider.parseResponse(data);
      console.log(`[Clarix] ✅ ${provider.name} responded`);

      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });

    } catch (err) {
      const msg = err.message || String(err);
      errors.push({ provider: provider.name, error: msg });
      console.error(`[Clarix] ❌ ${provider.name} failed: ${msg}`);
    }
  }

  // All failed
  console.error('[Clarix] 🚨 ALL PROVIDERS FAILED:', JSON.stringify(errors));
  return new Response(JSON.stringify({
    error: 'All AI providers unavailable',
    details: errors,
    content: [{ text: '' }]
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
};

export const config = { path: '/api/claude' };
