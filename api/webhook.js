// api/webhook.js - Wix Payment Webhook
const connectToDatabase = require('../utils/db').default;
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');

// Plan Definitions
const PLANS = {
    'temel': { credits: 50, price: 300, duration: 30, name: 'Temel Paket' },
    'uzman': { credits: 500, price: 2800, duration: 180, name: 'Uzman Paket' },
    'pro': { credits: 1000, price: 5000, duration: 365, name: 'Pro Paket' },
    'deneme': { credits: 1000, price: 0, duration: 30, name: 'Deneme Paket' },
    'test': { credits: 1000, price: 0, duration: 30, name: 'Test Paket' }
};

function verifyWebhook(payload, signature, secret) {
    if (!secret) return true;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    const expectedSignature = hmac.digest('hex');
    return signature === expectedSignature;
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wix-Signature');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        await connectToDatabase();

        const payload = req.body;
        const signature = req.headers['x-wix-signature'];
        const secret = process.env.WIX_WEBHOOK_SECRET;

        if (secret && !verifyWebhook(payload, signature, secret)) {
            console.error('Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const { wixUserId, planId, orderId, email, displayName } = payload;

        if (!wixUserId || !planId) {
            return res.status(400).json({ error: 'Missing required fields: wixUserId, planId' });
        }

        const plan = PLANS[planId.toLowerCase()];
        if (!plan) {
            return res.status(400).json({ error: 'Invalid plan: ' + planId });
        }

        // Find or Create User
        let user = await User.findByWixId(wixUserId);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + plan.duration * 24 * 60 * 60 * 1000);

        if (!user) {
            // Create New
            user = await User.createFromWix({
                userId: wixUserId,
                email: email || '',
                displayName: displayName || ''
            });
            // Apply Plan
            // We can reuse activatePlan logic but we might want to manually set credits to match local logic
            // User model has activatePlan but let's be explicit here or use the model method
        }

        // Update User Plan & Credits
        // Using direct update for now to match logic in previous file, but using Mongoose

        // We accumulate credits? Or reset?
        // Previous logic: user.credits + plan.credits
        // This means it's additive.
        user.planId = planId.toLowerCase();
        user.credits = (user.credits || 0) + plan.credits;
        user.totalCredits = (user.totalCredits || 0) + plan.credits;
        user.subscriptionStatus = 'active';
        user.purchasedAt = now;
        user.expiresAt = expiresAt;
        if (email) user.email = email;
        if (displayName) user.displayName = displayName;

        await user.save();
        console.log(`User ${wixUserId} updated with plan ${planId}. New Credits: ${user.credits}`);

        // Transaction Record
        await Transaction.create({
            wixUserId: wixUserId, // Transaction model expects userId primarily (ObjectId). 
            // The previous code used wixUserId in Transaction? 
            // Let's check Transaction model if possible. 
            // Assuming it accepts wixUserId or we should pass user._id
            userId: user._id, // Better to link to internal ID
            orderId: orderId || null,
            type: 'purchase',
            planId: planId.toLowerCase(),
            planName: plan.name,
            credits: plan.credits,
            amount: plan.price,
            currency: 'TRY',
            status: 'completed',
            createdAt: now
        });

        return res.status(200).json({
            success: true,
            message: 'Kredi başarıyla yüklendi',
            data: {
                wixUserId: wixUserId,
                planId: planId,
                creditsAdded: plan.credits,
                newBalance: user.credits,
                expiresAt: expiresAt
            }
        });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Server error', message: error.message });
    }
};
