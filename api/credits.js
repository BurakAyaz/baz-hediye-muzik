// api/credits.js - Consolidated Credits API
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

// Token decode
function decodeToken(token) {
    try {
        let decoded = token;
        if (token.includes('%')) {
            decoded = decodeURIComponent(token);
        }
        const json = Buffer.from(decoded, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

// Paket tanımları (from add-credits.js)
const PLANS = {
    'temel': { credits: 50, duration: 30, name: 'Temel Paket' },       // 1 ay
    'uzman': { credits: 500, duration: 180, name: 'Uzman Paket' },     // 6 ay
    'pro': { credits: 1000, duration: 365, name: 'Pro Paket' },        // 1 yıl
    'deneme': { credits: 1000, duration: 30, name: 'Deneme Paket' },   // TEST - 0 TL
    'test': { credits: 1000, duration: 30, name: 'Test Paket' }        // TEST - 0 TL
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { db } = await connectToDatabase();
        const usersCollection = db.collection('users');

        // Check for Admin Key -> Add Credits Mode
        const adminKey = req.headers['x-admin-key'] || req.body.adminKey;
        if (adminKey) {
            const expectedKey = process.env.ADMIN_KEY || 'baz-admin-2024';

            if (adminKey !== expectedKey) {
                return res.status(401).json({ error: 'Unauthorized', message: 'Geçersiz admin key' });
            }

            const { wixUserId, planId, credits } = req.body;

            if (!wixUserId) {
                return res.status(400).json({ error: 'wixUserId gerekli' });
            }

            // Kullanıcıyı bul
            let user = await usersCollection.findOne({ wixUserId: wixUserId });

            if (!user) {
                return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
            }

            const now = new Date();
            let creditsToAdd = 0;
            let newPlanId = user.planId;
            let expiresAt = user.expiresAt;

            if (planId && PLANS[planId.toLowerCase()]) {
                // Plan bazlı kredi ekleme
                const plan = PLANS[planId.toLowerCase()];
                creditsToAdd = plan.credits;
                newPlanId = planId.toLowerCase();
                expiresAt = new Date(now.getTime() + plan.duration * 24 * 60 * 60 * 1000);
            } else if (credits && typeof credits === 'number') {
                // Manuel kredi ekleme
                creditsToAdd = credits;
            } else {
                return res.status(400).json({ error: 'planId veya credits gerekli' });
            }

            // Kullanıcıyı güncelle
            await usersCollection.updateOne(
                { wixUserId: wixUserId },
                {
                    $set: {
                        planId: newPlanId,
                        credits: user.credits + creditsToAdd,
                        totalCredits: (user.totalCredits || 0) + creditsToAdd,
                        subscriptionStatus: 'active',
                        expiresAt: expiresAt,
                        updatedAt: now
                    }
                }
            );

            return res.status(200).json({
                success: true,
                message: 'Kredi eklendi',
                data: {
                    wixUserId: wixUserId,
                    creditsAdded: creditsToAdd,
                    previousBalance: user.credits,
                    newBalance: user.credits + creditsToAdd,
                    planId: newPlanId
                }
            });
        }

        // No Admin Key -> Use Credits Mode (Default Consumer)
        // Token'dan kullanıcı bilgisi al
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token gerekli (veya Admin Key)' });
        }

        const token = authHeader.substring(7);
        const decoded = decodeToken(token);

        if (!decoded || !decoded.userId) {
            return res.status(401).json({ error: 'Geçersiz token' });
        }

        // Harcama miktarı (varsayılan 1)
        const { amount = 1, action = 'song_generate', songId = null } = req.body;
        const transactionsCollection = db.collection('transactions');

        // Kullanıcıyı bul
        const user = await usersCollection.findOne({ wixUserId: decoded.userId });

        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Kredi kontrolü
        if (user.credits < amount) {
            return res.status(400).json({
                error: 'Yetersiz kredi',
                currentCredits: user.credits,
                required: amount
            });
        }

        // Krediyi düş
        const newCredits = user.credits - amount;
        const newTotalUsed = (user.totalUsed || 0) + amount;
        const newSongsGenerated = (user.totalSongsGenerated || 0) + 1;

        await usersCollection.updateOne(
            { wixUserId: decoded.userId },
            {
                $set: {
                    credits: newCredits,
                    totalUsed: newTotalUsed,
                    totalSongsGenerated: newSongsGenerated,
                    updatedAt: new Date()
                }
            }
        );

        // İşlem kaydı oluştur
        const transaction = {
            wixUserId: decoded.userId,
            type: 'usage',
            action: action,
            songId: songId,
            credits: -amount,
            balanceAfter: newCredits,
            createdAt: new Date()
        };

        await transactionsCollection.insertOne(transaction);

        console.log('Kredi harcandı:', decoded.userId, 'Miktar:', amount, 'Kalan:', newCredits);

        return res.status(200).json({
            success: true,
            message: 'Kredi harcandı',
            data: {
                creditsUsed: amount,
                remainingCredits: newCredits,
                totalUsed: newTotalUsed,
                totalSongsGenerated: newSongsGenerated
            }
        });

    } catch (error) {
        console.error('Credits API error:', error);
        return res.status(500).json({
            error: 'Server error',
            message: error.message
        });
    }
};
