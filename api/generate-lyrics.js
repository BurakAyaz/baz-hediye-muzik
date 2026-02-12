// api/generate-lyrics.js
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
    const response = await fetch('https://api.kieai.erweima.ai/api/v1/lyrics', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        callBackUrl: callBackUrl || "https://google.com"
      })
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error("Generate Lyrics Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
