// api/generate.js - Vercel Serverless Function
const connectToDatabase = require('../utils/db').default;
const runMiddleware = require('../utils/runMiddleware').default;
const User = require('../models/User');
const Transaction = require('../models/Transaction');
// Middleware
const auth = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const checkCredits = require('../middleware/credits');
const { deductCredit, refundCredit } = require('../middleware/credits');

module.exports = async (req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { API_KEY = process.env.KIE_API_KEY, KIE_API_URL = 'https://api.kie.ai/api/v1' } = process.env;

    try {
        // 2. Connect to DB
        await connectToDatabase();

        // 3. Status Check (GET)
        if (req.method === 'GET') {
            const { taskId } = req.query;
            if (!taskId) return res.status(400).json({ error: 'Task ID gerekli.' });

            const targetUrl = `${KIE_API_URL}/generate/record-info?taskId=${taskId}`;
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.msg || "Durum sorgulanamadı");
            return res.status(200).json(data);
        }

        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        // 4. Authentication Check (Optional for Gift/Guest Flow)
        // We use optionalAuth. If token is valid, req.user is set. If not, req.user is undefined.
        await runMiddleware(req, res, optionalAuth);

        // 5. Credit Check (Only if User is logged in)
        if (req.user) {
            await runMiddleware(req, res, checkCredits('generate'));
        } else {
            // Guest Flow: We assume payment handled externally (IyziLink)
            // Ideally we'd verify payment here, but for now we allow it.
            console.log('Guest generation request (Payment assumed)');
        }

        // 6. Processing
        const type = req.query.type || 'song'; // song, cover, extend, persona
        let apiUrl = '';
        let payload = {};
        const body = req.body;
        const { callBackUrl } = body;

        // Construct Payload based on Type
        if (type === 'song') {
            apiUrl = `${KIE_API_URL}/generate`;
            const { prompt, style, title, instrumental, model, customMode, vocalGender, negativeTags, styleWeight, weirdnessConstraint, audioWeight, personaId } = body;

            // Permission Checks (Only for logged in users)
            if (req.user && !req.user.canUseModel(model || "V4")) {
                return res.status(403).json({ error: `Model not allowed: ${model}`, allowed: req.user.allowedModels });
            }

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
            if (personaId && req.user && req.user.canUseFeature('persona')) payload.personaId = personaId;

        } else if (type === 'cover') {
            if (req.user && !req.user.canUseFeature('cover')) return res.status(403).json({ error: 'Cover feature not included in your plan' });

            apiUrl = `${KIE_API_URL}/generate/upload-cover`;
            const { uploadUrl, prompt, style, title, customMode, instrumental, model, vocalGender, negativeTags, styleWeight, weirdnessConstraint, audioWeight, personaId } = body;

            if (!uploadUrl) return res.status(400).json({ error: 'uploadUrl zorunludur.' });

            payload = {
                uploadUrl,
                model: model || "V5",
                customMode: customMode !== false,
                instrumental: instrumental === true,
                callBackUrl: callBackUrl || "https://google.com"
            };

            if (payload.customMode) {
                payload.style = style || "Pop";
                payload.title = title || "Covered Song";
                if (!payload.instrumental) payload.prompt = prompt;
            } else {
                payload.prompt = prompt;
            }
            if (vocalGender) payload.vocalGender = vocalGender;
            if (negativeTags) payload.negativeTags = negativeTags;
            if (styleWeight) payload.styleWeight = parseFloat(styleWeight);
            if (weirdnessConstraint) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
            if (audioWeight) payload.audioWeight = parseFloat(audioWeight);
            if (personaId && req.user && req.user.canUseFeature('persona')) payload.personaId = personaId;

        } else if (type === 'extend') {
            if (req.user && !req.user.canUseFeature('extend')) return res.status(403).json({ error: 'Extend feature not included in your plan' });

            apiUrl = `${KIE_API_URL}/generate/upload-extend`;
            const { uploadUrl, prompt, style, title, continueAt, instrumental, model, vocalGender, negativeTags, styleWeight, weirdnessConstraint, audioWeight, personaId } = body;

            if (!uploadUrl || !continueAt) return res.status(400).json({ error: 'uploadUrl ve continueAt zorunludur.' });

            payload = {
                uploadUrl,
                model: model || "V5",
                continueAt: parseInt(continueAt),
                callBackUrl: callBackUrl || "https://google.com",
                customMode: true,
                instrumental: instrumental === true,
                style: style || "Pop",
                title: title || "Extended Song"
            };
            if (!payload.instrumental && prompt) payload.prompt = prompt;
            if (vocalGender) payload.vocalGender = vocalGender;
            if (negativeTags) payload.negativeTags = negativeTags;
            if (styleWeight) payload.styleWeight = parseFloat(styleWeight);
            if (weirdnessConstraint) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
            if (audioWeight) payload.audioWeight = parseFloat(audioWeight);
            if (personaId && req.user && req.user.canUseFeature('persona')) payload.personaId = personaId;

        } else if (type === 'persona') {
            if (req.user && !req.user.canUseFeature('persona')) return res.status(403).json({ error: 'Persona feature not included in your plan' });

            apiUrl = `${KIE_API_URL}/generate/generate-persona`;
            const { taskId, audioId, name, description } = body;
            if (!taskId || !audioId || !name || !description) return res.status(400).json({ error: 'Eksik alanlar' });
            payload = { taskId, audioId, name, description };
        } else {
            return res.status(400).json({ error: 'Invalid generate type' });
        }

        // 7. Call External API
        console.log(`Sending ${type} request to KIE:`, payload);
        const externalResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await externalResponse.json();

        if (!externalResponse.ok) {
            console.error(`${type} API Error:`, data);
            throw new Error(data.msg || data.error || 'External API Error');
        }

        // 8. Deduct Credit (Only for Logged In User)
        if (data.code === 200 || data.status === 'success' || data.taskId) {
            if (req.user) {
                const transactionData = {
                    type: type,
                    taskId: data.data?.taskId || data.taskId,
                    model: payload.model,
                    title: payload.title
                };

                try {
                    const creditResult = await deductCredit(req, transactionData);
                    return res.status(200).json({ ...data, creditInfo: creditResult });
                } catch (deductError) {
                    console.error('Credit deduction failed AFTER generation:', deductError);
                    return res.status(200).json({ ...data, creditError: 'Credit sync failed but generation started' });
                }
            } else {
                // Guest: Just return success
                return res.status(200).json(data);
            }
        } else {
            return res.status(400).json(data);
        }

    } catch (error) {
        console.error("Generate API Error:", error);
        return res.status(500).json({ error: 'İşlem başarısız', details: error.message });
    }
};
