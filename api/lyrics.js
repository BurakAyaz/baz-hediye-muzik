// api/lyrics.js - Consolidated Lyrics API
module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // API Key Kontrolü
    const API_KEY = process.env.KIE_API_KEY || process.env.SUNO_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ code: 500, msg: 'API Key eksik.' });
    }

    try {
        // GET - Lyrics generation status check (eski lyrics-status.js/lyrics.js GET)
        if (req.method === 'GET') {
            const { taskId } = req.query;

            if (!taskId) {
                return res.status(400).json({ error: 'Task ID gerekli.' });
            }

            const targetUrl = `https://api.kieai.erweima.ai/api/v1/lyrics/record-info?taskId=${taskId}`;

            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            return res.status(200).json(data);
        }

        // POST - Generate or Fetch
        if (req.method === 'POST') {
            const { prompt, taskId, audioId, callBackUrl } = req.body;

            // Scenario 1: Generate Lyrics (if prompt is present) - from generate-lyrics.js
            if (prompt) {
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
            }

            // Scenario 2: Fetch Timestamped Lyrics (if taskId & audioId present) - from lyrics.js POST
            if (taskId && audioId) {
                const response = await fetch('https://api.kie.ai/api/v1/generate/get-timestamped-lyrics', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ taskId, audioId })
                });

                const data = await response.json();
                return res.status(200).json(data);
            }

            return res.status(400).json({ error: 'Geçersiz parametreler. Prompt veya (taskId + audioId) gerekli.' });
        }

        return res.status(405).json({ code: 405, msg: 'Method not allowed' });

    } catch (error) {
        console.error("Lyrics API Error:", error);
        return res.status(500).json({ code: 500, msg: error.message });
    }
};