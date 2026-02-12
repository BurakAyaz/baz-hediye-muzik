// api/lyrics.js - Birleşik Lyrics API (GET: status, POST: fetch lyrics)
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
        
        // POST - Fetch song lyrics
        if (req.method === 'POST') {
            const { taskId, audioId } = req.body;

            if (!taskId || !audioId) {
                return res.status(400).json({ code: 400, msg: 'TaskId ve AudioId gereklidir.' });
            }

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
        
        return res.status(405).json({ code: 405, msg: 'Method not allowed' });

    } catch (error) {
        console.error("Lyrics Error:", error);
        return res.status(500).json({ code: 500, msg: error.message });
    }
};