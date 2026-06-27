// Serverless proxy for Google Gemini API.
// Keeps your API key server-side. The frontend sends { prompt }, gets back { text }.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  const { prompt } = req.body || {}
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' })
  }

  const MODEL = 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Disable "thinking" so it doesn't eat the output token budget.
          thinkingConfig: { thinkingBudget: 0 },
          // Force clean JSON output (no markdown fences).
          responseMimeType: 'application/json',
          // Generous headroom in case thinking sneaks in anyway.
          maxOutputTokens: 2048,
          temperature: 0.9
        }
      })
    })

    const data = await response.json()

    if (!response.ok) {
      const msg = data?.error?.message || 'Gemini API error'
      return res.status(response.status).json({ error: msg })
    }

    const candidate = data?.candidates?.[0]
    const finishReason = candidate?.finishReason
    const text = candidate?.content?.parts?.map(p => p.text || '').join('') || ''

    // Surface the real reason if the model returned nothing usable.
    if (!text) {
      if (finishReason === 'MAX_TOKENS') {
        return res.status(502).json({
          error: 'Model hit the token limit before producing output. Try again.'
        })
      }
      if (finishReason === 'SAFETY') {
        return res.status(502).json({
          error: 'Response blocked by safety filter. Try a different focus.'
        })
      }
      return res.status(502).json({
        error: `Empty response from Gemini (finishReason: ${finishReason || 'unknown'})`
      })
    }

    return res.status(200).json({ text })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach Gemini API: ' + err.message })
  }
}
