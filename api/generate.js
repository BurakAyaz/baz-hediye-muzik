// api/generate.js - Consolidated Generation API (Song, Cover, Extend, Persona, Status)
const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not set');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db('bazai');
    cachedClient = client;
    cachedDb = db;
    return { client, db };
}

function decodeToken(token) {
    try {
        let decoded = token;
        if (token.includes('%')) decoded = decodeURIComponent(token);
        const json = Buffer.from(decoded, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch (e) { return null; }
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const API_KEY = process.env.KIE_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'API Key eksik.' });

    // === STATUS CHECK (GET) ===
    if (req.method === 'GET') {
        const { taskId } = req.query;
        if (!taskId) return res.status(400).json({ error: 'Task ID gerekli.' });

        try {
            const targetUrl = `https://api.kie.ai/api/v1/generate/record-info?taskId=${taskId}`;
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.msg || "Durum sorgulanamadı");
            return res.status(200).json(data);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // === GENERATION LOGIC (POST) ===
    // 1. Credit Check & Deduction (from proxy.js)
    const authHeader = req.headers.authorization;
    let userId = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = decodeToken(token);
        if (decoded && decoded.userId) {
            userId = decoded.userId;
            try {
                const { db } = await connectToDatabase();
                const usersCollection = db.collection('users');
                const user = await usersCollection.findOne({ wixUserId: userId });

                if (!user) return res.status(401).json({ error: 'Kullanıcı bulunamadı', code: 'NO_USER' });
                if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
                    return res.status(403).json({ error: 'Paket süresi dolmuş', code: 'EXPIRED' });
                }
                if (!user.credits || user.credits < 1) {
                    return res.status(403).json({ error: 'Yetersiz kredi', code: 'NO_CREDITS' });
                }

                // Deduct credit
                await usersCollection.updateOne(
                    { wixUserId: userId },
                    {
                        $inc: { credits: -1, totalUsed: 1, totalSongsGenerated: 1 },
                        $set: { updatedAt: new Date() }
                    }
                );
                console.log('Kredi düşüldü:', userId);
            } catch (dbError) {
                console.error('Kredi kontrol hatası:', dbError);
                // Proceed despite DB error? safer to block or log. Original code continued.
            }
        }
    }

    // 2. Route based on type
    const type = req.query.type || 'song'; // song, cover, extend, persona

    try {
        let apiUrl = '';
        let payload = {};

        const body = req.body;
        const { callBackUrl } = body;

        if (type === 'song') {
            apiUrl = 'https://api.kie.ai/api/v1/generate';

            const { prompt, style, title, instrumental, model, customMode, vocalGender, negativeTags, styleWeight, weirdnessConstraint, audioWeight, personaId } = body;

            payload = {
                prompt,
                model: model || "V4",
                customMode: true,
                instrumental: instrumental || false,
                style: style || "Pop",
                title: title || "New Song",
                callBackUrl: callBackUrl || "https://google.com"
            };
            if (vocalGender) payload.vocalGender = vocalGender;
            if (negativeTags) payload.negativeTags = negativeTags;
            if (styleWeight) payload.styleWeight = parseFloat(styleWeight);
            if (weirdnessConstraint) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
            if (audioWeight) payload.audioWeight = parseFloat(audioWeight);
            if (personaId) payload.personaId = personaId;

        } else if (type === 'cover') {
            apiUrl = 'https://api.kie.ai/api/v1/generate/upload-cover';

            const { uploadUrl, prompt, style, title, customMode, instrumental, model, vocalGender, negativeTags, styleWeight, weirdnessConstraint, audioWeight, personaId } = body;

            if (!uploadUrl) return res.status(400).json({ error: 'uploadUrl zorunludur.' });

            const isCustomMode = customMode !== false;
            const isInstrumental = instrumental === true;

            payload = {
                uploadUrl,
                model: model || "V5",
                customMode: isCustomMode,
                instrumental: isInstrumental,
                callBackUrl: callBackUrl || "https://google.com"
            };

            if (isCustomMode) {
                payload.style = style || "Pop";
                payload.title = title || "Covered Song";
                if (!isInstrumental) payload.prompt = prompt;
            } else {
                payload.prompt = prompt;
            }
            if (vocalGender) payload.vocalGender = vocalGender;
            if (negativeTags) payload.negativeTags = negativeTags;
            if (styleWeight) payload.styleWeight = parseFloat(styleWeight);
            if (weirdnessConstraint) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
            if (audioWeight) payload.audioWeight = parseFloat(audioWeight);
            if (personaId) payload.personaId = personaId;

        } else if (type === 'extend') {
            apiUrl = 'https://api.kie.ai/api/v1/generate/upload-extend';

            const { uploadUrl, prompt, style, title, continueAt, instrumental, model, vocalGender, negativeTags, styleWeight, weirdnessConstraint, audioWeight, personaId } = body;

            if (!uploadUrl || !continueAt) return res.status(400).json({ error: 'uploadUrl ve continueAt zorunludur.' });

            const isInstrumental = instrumental === true;

            payload = {
                uploadUrl,
                model: model || "V5",
                continueAt: parseInt(continueAt),
                callBackUrl: callBackUrl || "https://google.com",
                customMode: true,
                instrumental: isInstrumental,
                style: style || "Pop",
                title: title || "Extended Song"
            };
            if (!isInstrumental && prompt) payload.prompt = prompt;
            if (vocalGender) payload.vocalGender = vocalGender;
            if (negativeTags) payload.negativeTags = negativeTags;
            if (styleWeight) payload.styleWeight = parseFloat(styleWeight);
            if (weirdnessConstraint) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
            if (audioWeight) payload.audioWeight = parseFloat(audioWeight);
            if (personaId) payload.personaId = personaId;

        } else if (type === 'persona') {
            apiUrl = 'https://api.kie.ai/api/v1/generate/generate-persona';
            const { taskId, audioId, name, description } = body;

            if (!taskId || !audioId || !name || !description) return res.status(400).json({ error: 'Eksik alanlar: taskId, audioId, name, description' });

            payload = { taskId, audioId, name, description };
        } else {
            return res.status(400).json({ error: 'Invalid generate type' });
        }

        console.log(`Sending ${type} request to KIE:`, payload);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`${type} API Error:`, data);
            throw new Error(data.msg || data.error || JSON.stringify(data));
        }

        return res.status(200).json(data);

    } catch (error) {
        console.error("Generate API Error:", error);
        return res.status(500).json({ error: 'İşlem başlatılamadı', details: error.message });
    }
};
