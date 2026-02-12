// api/generate-lyrics.js
const axios = require('axios');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Sadece POST isteği kabul et
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST isteği kabul edilir.' });
  }

  // API Key Kontrolü
  const API_KEY = process.env.KIE_API_KEY || process.env.SUNO_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'API Key eksik.' });
  }

  const { prompt, callBackUrl } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt (şarkı sözü konusu) gereklidir.' });
  }

  try {
    // KIE.ai API endpoint
    const response = await axios.post('https://api.kieai.erweima.ai/api/v1/lyrics', {
      prompt,
      callBackUrl: callBackUrl || "https://google.com"
    }, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return res.status(200).json(response.data);

  } catch (error) {
    console.error("Generate Lyrics Error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: 'Failed to generate lyrics',
      details: error.response?.data?.msg || error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
};
