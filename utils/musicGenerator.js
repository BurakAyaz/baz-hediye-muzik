const axios = require('axios');
const Transaction = require('../models/Transaction');
const { deductCredit } = require('../middleware/credits');

const KIE_API_URL = 'https://api.kie.ai/api/v1';
const API_KEY = process.env.KIE_API_KEY;

/**
 * Handles the core logic of calling the Music Generation API
 * @param {Object} params - Generation parameters (model, prompt, type, etc.)
 * @param {Object} user - User object (optional, for credit deduction)
 * @param {Object} req - Request object (for middleware compatibility)
 * @param {String} transactionId - Optional transaction ID to update instead of creating new
 */
async function generateMusic(params, user, req, transactionId = null) {
    const {
        type = 'song',
        model = "V4",
        customMode,
        instrumental,
        title,
        style,
        prompt,
        vocalGender,
        negativeTags,
        styleWeight,
        weirdnessConstraint,
        audioWeight,
        personaId,
        uploadUrl,
        continueAt,
        callBackUrl
    } = params;

    let apiUrl = '';
    let payload = {};

    console.log(`🎵 Generating logic triggered for Type: ${type}`);

    // Construct Payload
    if (type === 'song') {
        apiUrl = `${KIE_API_URL}/generate`;
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
        if (personaId && user && user.features.includes('persona')) payload.personaId = personaId;

    } else if (type === 'cover') {
        apiUrl = `${KIE_API_URL}/generate/upload-cover`;
        if (!uploadUrl) throw new Error('uploadUrl zorunludur.');
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

    } else if (type === 'extend') {
        apiUrl = `${KIE_API_URL}/generate/upload-extend`;
        if (!uploadUrl || !continueAt) throw new Error('uploadUrl ve continueAt zorunludur.');
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

    } else if (type === 'persona') {
        apiUrl = `${KIE_API_URL}/generate/generate-persona`;
        const { taskId, audioId, name, description } = params;
        if (!taskId || !audioId || !name || !description) throw new Error('Eksik alanlar');
        payload = { taskId, audioId, name, description };
    } else {
        throw new Error('Invalid generate type');
    }

    // Call External API
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

    // Handle Success & Credits/Transaction
    if (data.code === 200 || data.status === 'success' || data.taskId) {

        const resultTaskId = data.data?.taskId || data.taskId;

        // If we have an existing Pending Transaction (from Init), update it
        if (transactionId) {
            await Transaction.findByIdAndUpdate(transactionId, {
                taskId: resultTaskId,
                status: 'completed', // Or 'processing' if we want to track that
                metadata: { ...params, sunoData: data } // Merge result
            });
            console.log(`Updated pending transaction ${transactionId} with TaskID ${resultTaskId}`);
        }

        // Deduct Credit (Only if User is logged in AND it's not a pre-paid transaction)
        // If transactionId exists, it implies payment was handled or is pending.
        // For standard "logged in user clicking generate", we deduct.
        // For "Gift flow", we might skip this if it was already handled.
        // Let's assume passed 'user' implies we should try deduction unless told otherwise.

        let creditInfo = null;
        if (user && !transactionId) {
            // Only deduct if this wasn't a pre-initiated transaction 
            // (Assuming pre-init transactions are paid/handled separately or we don't want double deduction logic here for now)
            // Actually, the requirement for Guest is "save to DB", which we did.

            const transactionData = {
                type: type,
                taskId: resultTaskId,
                model: payload.model,
                title: payload.title
            };

            try {
                // If req is provided, use it for middleware compatibility
                if (req) {
                    creditInfo = await deductCredit(req, transactionData);
                }
            } catch (deductError) {
                console.error('Credit deduction failed:', deductError);
                // We don't block generation result for deduction fail here if already sent
            }
        }

        return { ...data, creditInfo };

    } else {
        throw new Error(data.msg || 'Unknown API Error');
    }
}

module.exports = { generateMusic };
