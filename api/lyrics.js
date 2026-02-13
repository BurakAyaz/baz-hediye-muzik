// api/lyrics.js - Consolidated Lyrics API (Vercel)
const connectToDatabase = require('../utils/db').default;
const runMiddleware = require('../utils/runMiddleware').default;
const auth = require('../middleware/auth');
const checkCredits = require('../middleware/credits');
const { deductCredit } = require('../middleware/credits');

module.exports = async (req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const API_KEY = process.env.KIE_API_KEY || process.env.SUNO_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'API Key eksik.' });

    try {
        await connectToDatabase();

        // GET - Status Check (No cost, maybe auth?)
        // Keeping it open for now or simple auth if needed, consistent with generate.js GET
        if (req.method === 'GET') {
            const { taskId } = req.query;
            if (!taskId) return res.status(400).json({ error: 'Task ID gerekli.' });

            const targetUrl = `https://api.kieai.erweima.ai/api/v1/lyrics/record-info?taskId=${taskId}`;
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
            });

            const data = await response.json();
            return res.status(200).json(data);
        }

        if (req.method === 'POST') {
            // 2. Auth for all POST operations
            await runMiddleware(req, res, auth);

            const { prompt, taskId, audioId, callBackUrl } = req.body;

            // Scenario 1: Generate Lyrics (Costs Credit)
            if (prompt) {
                // Feature Check
                if (!req.user.canUseFeature('lyrics')) {
                    return res.status(403).json({ error: 'Lyrics feature not in plan' });
                }

                // Credit Check
                await runMiddleware(req, res, checkCredits);

                const response = await fetch('https://api.kieai.erweima.ai/api/v1/lyrics', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt,
                        callBackUrl: callBackUrl || "https://google.com"
                    })
                });

                const data = await response.json();

                if (response.ok && (data.code === 200 || data.taskId)) {
                    // Deduct
                    const transactionData = {
                        type: 'lyrics',
                        taskId: data.data?.taskId || data.taskId
                    };
                    try {
                        const creditResult = await deductCredit(req, transactionData);
                        return res.status(200).json({ ...data, creditInfo: creditResult });
                    } catch (e) {
                        return res.status(200).json({ ...data, creditError: 'Sync failed' });
                    }
                }
                return res.status(response.status).json(data);
            }

            // Scenario 2: Fetch Timestamped Lyrics (Free, but authenticated)
            if (taskId && audioId) {
                const response = await fetch('https://api.kie.ai/api/v1/generate/get-timestamped-lyrics', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId, audioId })
                });

                const data = await response.json();
                return res.status(200).json(data);
            }

            return res.status(400).json({ error: 'Geçersiz parametreler' });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error("Lyrics API Error:", error);
        return res.status(500).json({ error: 'İşlem başarısız', details: error.message });
    }
};