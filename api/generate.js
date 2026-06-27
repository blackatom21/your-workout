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
          maxOutputTokens: 1200,
          temperature: 0.9
        }
      })
    })

    const data = await response.json()

    if (!response.ok) {
      const msg = data?.error?.message || 'Gemini API error'
      return res.status(response.status).json({ error: msg })
    }

    // Extract text from Gemini's response shape
    const text = data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '')
      .join('') || ''

    if (!text) {
      return res.status(502).json({ error: 'Empty response from Gemini' })
    }

    return res.status(200).json({ text })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach Gemini API: ' + err.message })
  }
}
