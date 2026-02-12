// api/lyrics.js - Birleşik Lyrics API (GET: status, POST: fetch lyrics)
const axios = require('axios');

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
        // GET - Lyrics generation status check (eski lyrics-status.js)
        if (req.method === 'GET') {
            const { taskId } = req.query;

            if (!taskId) {
                return res.status(400).json({ error: 'Task ID gerekli.' });
            }

            const targetUrl = `https://api.kieai.erweima.ai/api/v1/lyrics/record-info?taskId=${taskId}`;

            const response = await axios.get(targetUrl, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            return res.status(200).json(response.data);
        }

        // POST - Fetch song lyrics
        if (req.method === 'POST') {
            const { taskId, audioId } = req.body;

            if (!taskId || !audioId) {
                return res.status(400).json({ code: 400, msg: 'TaskId ve AudioId gereklidir.' });
            }

            const response = await axios.post('https://api.kie.ai/api/v1/generate/get-timestamped-lyrics',
                { taskId, audioId },
                {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return res.status(200).json(response.data);
        }

        return res.status(405).json({ code: 405, msg: 'Method not allowed' });

    } catch (error) {
        console.error("Lyrics Error:", error.response?.data || error.message);
        return res.status(error.response?.status || 500).json({
            code: error.response?.status || 500,
            msg: error.response?.data?.msg || error.message
        });
    }
};