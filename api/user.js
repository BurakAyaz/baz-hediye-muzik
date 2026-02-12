// api/user.js - Consolidated User API
const { MongoClient } = require('mongodb');

// MongoDB bağlantısı (singleton)
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI environment variable not set');

    const client = new MongoClient(uri);
    await client.connect();

    const db = client.db('bazai');

    cachedClient = client;
    cachedDb = db;

    return { client, db };
}

// Token çözümleme
function decodeToken(token) {
    try {
        const decodedToken = decodeURIComponent(token);
        const jsonString = Buffer.from(decodedToken, 'base64').toString('utf8');
        return JSON.parse(jsonString);
    } catch (e1) {
        try {
            const jsonString = Buffer.from(token, 'base64').toString('utf8');
            return JSON.parse(jsonString);
        } catch (e2) {
            return null;
        }
    }
}

// Kalan gün hesapla
function getDaysRemaining(expiresAt) {
    if (!expiresAt) return 0;
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diff = expiry - now;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Determine operation type
    const type = req.query.type; // 'sync' or 'data' (default)

    // === AUTH SYNC LOGIC (from auth-sync.js) ===
    if (req.method === 'POST' && type === 'sync') {
        try {
            // Token al
            const authHeader = req.headers.authorization;
            let decoded;

            // POST body'den gelen action=login/logout kontrolü
            const { action, data } = req.body;

            // Eğer action 'login' ise ve body'de veri varsa, token header'dan değil body'den gelebilir veya oluşturulabilir
            if (action === 'login' && data && data.wixUserId) {
                decoded = {
                    userId: data.wixUserId,
                    email: data.email,
                    displayName: data.displayName,
                    timestamp: Date.now()
                };
                // Login işlemi için yapay bir decoded obje oluştur duk, aşağıda devam edecek
            } else {
                // Normal sync işlemi, token gerekli
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return res.status(401).json({ error: 'Authentication required', message: 'Token gerekli' });
                }
                const token = authHeader.split(' ')[1];
                if (!token) return res.status(401).json({ error: 'Token missing', message: 'Token bulunamadı' });

                decoded = decodeToken(token);
                if (!decoded || !decoded.userId) return res.status(401).json({ error: 'Invalid token', message: 'Geçersiz token' });

                // Token süresi kontrolü (7 gün)
                if (decoded.timestamp && Date.now() - decoded.timestamp > 7 * 24 * 60 * 60 * 1000) {
                    return res.status(401).json({ error: 'Token expired', message: 'Token süresi dolmuş' });
                }
            }

            // Logout ise basitçe dön
            if (action === 'logout') {
                return res.status(200).json({ success: true });
            }

            // MongoDB bağlan
            const { db } = await connectToDatabase();
            const usersCollection = db.collection('users');

            // Kullanıcıyı bul
            let user = await usersCollection.findOne({ wixUserId: decoded.userId });

            // Yoksa oluştur
            if (!user) {
                const newUser = {
                    wixUserId: decoded.userId,
                    email: decoded.email || '',
                    displayName: decoded.displayName || '',
                    planId: 'none',
                    credits: 0,
                    totalCredits: 0,
                    totalUsed: 0,
                    features: [],
                    allowedModels: [],
                    subscriptionStatus: 'none',
                    purchasedAt: null,
                    expiresAt: null,
                    totalSongsGenerated: 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = await usersCollection.insertOne(newUser);
                user = { ...newUser, _id: result.insertedId };
            }

            // User Data Update if login provided fresh info
            if (action === 'login' && data) {
                if (data.email && data.email !== user.email) {
                    await usersCollection.updateOne({ wixUserId: decoded.userId }, { $set: { email: data.email } });
                    user.email = data.email;
                }
            }

            // Süre kontrolü & Plan özellikleri (from auth-sync.js)
            const userPlan = user.planId || 'none';
            const now = new Date();
            let creditsToReturn = user.credits || 0;

            if (user.expiresAt && new Date(user.expiresAt) < now && user.credits > 0) {
                await usersCollection.updateOne(
                    { wixUserId: decoded.userId },
                    { $set: { credits: 0, subscriptionStatus: 'expired', updatedAt: now } }
                );
                creditsToReturn = 0;
                user.subscriptionStatus = 'expired';
            }

            const isActive = user.subscriptionStatus === 'active' &&
                user.credits > 0 &&
                (!user.expiresAt || new Date(user.expiresAt) > new Date());

            // Yeni token oluştur (basit base64 encode) - Client tarafında authHelper token'ı saklar
            const newTokenPayload = JSON.stringify({
                userId: user.wixUserId,
                email: user.email,
                displayName: user.displayName,
                timestamp: Date.now()
            });
            const newToken = Buffer.from(newTokenPayload).toString('base64');

            return res.status(200).json({
                success: true,
                token: newToken,
                user: {
                    id: user._id.toString(),
                    wixUserId: user.wixUserId,
                    email: user.email,
                    displayName: user.displayName,
                    plan: userPlan,
                    planId: userPlan,
                    credits: creditsToReturn,
                    available: creditsToReturn,
                    totalCredits: user.totalCredits || 0,
                    used: user.totalUsed || 0,
                    features: user.features || [],
                    allowedModels: user.allowedModels || [],
                    subscriptionStatus: user.subscriptionStatus || 'none',
                    expiresAt: user.expiresAt,
                    daysRemaining: getDaysRemaining(user.expiresAt),
                    isActive: isActive,
                    totalSongsGenerated: user.totalSongsGenerated || 0
                }
            });

        } catch (error) {
            console.error('Auth sync error:', error);
            return res.status(500).json({ error: 'Server error', message: error.message });
        }
    }

    // === USER DATA LOGIC (from user-data.js) ===
    // GET or POST (type=data)

    // Auth Check for Data Operations
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token gerekli' });
    }
    const token = authHeader.substring(7);
    const decoded = decodeToken(token);
    if (!decoded || !decoded.userId) {
        return res.status(401).json({ error: 'Geçersiz token' });
    }

    const { db } = await connectToDatabase();
    const usersCollection = db.collection('users');

    try {
        if (req.method === 'GET') {
            const user = await usersCollection.findOne({ wixUserId: decoded.userId });
            if (!user) {
                return res.status(200).json({
                    success: true,
                    data: { credits: 0, plan: 'free', tracks: [], generatedLyrics: [], personas: [], activityLog: [], settings: {} }
                });
            }
            return res.status(200).json({
                success: true,
                data: {
                    credits: user.credits || 0,
                    plan: user.planId || 'none',
                    planId: user.planId || 'none',
                    planExpiry: user.expiresAt,
                    tracks: user.tracks || [],
                    generatedLyrics: user.generatedLyrics || [],
                    personas: user.personas || [],
                    activityLog: user.activityLog || [],
                    totalSongsGenerated: user.totalSongsGenerated || 0,
                    totalCreditsUsed: user.totalUsed || 0,
                    settings: user.settings || {}
                }
            });
        }

        if (req.method === 'POST') {
            const { action, data } = req.body;
            if (!action) return res.status(400).json({ error: 'Action gerekli' });

            let updateData = { updatedAt: new Date() };
            let pushData = {};

            switch (action) {
                case 'add_track':
                    if (!data.track) return res.status(400).json({ error: 'Track verisi gerekli' });
                    pushData.tracks = { ...data.track, addedAt: new Date() };
                    break;
                case 'remove_track':
                    if (!data.trackId) return res.status(400).json({ error: 'Track ID gerekli' });
                    await usersCollection.updateOne({ wixUserId: decoded.userId }, { $pull: { tracks: { id: data.trackId } }, $set: { updatedAt: new Date() } });
                    return res.status(200).json({ success: true, message: 'Şarkı silindi' });
                case 'sync_tracks':
                    if (!Array.isArray(data.tracks)) return res.status(400).json({ error: 'Tracks array gerekli' });
                    updateData.tracks = data.tracks.map(t => ({ ...t, syncedAt: new Date() }));
                    break;
                case 'add_lyrics':
                    if (!data.lyrics) return res.status(400).json({ error: 'Lyrics verisi gerekli' });
                    pushData.generatedLyrics = { ...data.lyrics, createdAt: new Date() };
                    break;
                case 'add_persona':
                    if (!data.persona) return res.status(400).json({ error: 'Persona verisi gerekli' });
                    pushData.personas = { ...data.persona, createdAt: new Date() };
                    break;
                case 'add_activity':
                    if (!data.activity) return res.status(400).json({ error: 'Activity verisi gerekli' });
                    // Simple append, slicing handled if array grows too large in specific maintenance or just keep growing for now
                    pushData.activityLog = { ...data.activity, timestamp: new Date() };
                    break;
                case 'update_settings':
                    if (!data.settings) return res.status(400).json({ error: 'Settings verisi gerekli' });
                    updateData['settings'] = data.settings;
                    break;
                case 'full_sync':
                    if (data.tracks) updateData.tracks = data.tracks;
                    if (data.generatedLyrics) updateData.generatedLyrics = data.generatedLyrics;
                    if (data.personas) updateData.personas = data.personas;
                    if (data.settings) updateData.settings = data.settings;
                    break;
                default:
                    // If not caught by above, verify if it is an unknown action
                    if (!['login', 'logout', 'sync'].includes(action)) { // login/logout type actions handled in Auth block
                        return res.status(400).json({ error: 'Geçersiz action: ' + action });
                    }
            }

            const updateQuery = { $set: updateData };
            if (Object.keys(pushData).length > 0) updateQuery.$push = pushData;

            await usersCollection.updateOne({ wixUserId: decoded.userId }, updateQuery, { upsert: true });

            const updatedUser = await usersCollection.findOne({ wixUserId: decoded.userId });
            return res.status(200).json({
                success: true,
                message: 'Veriler kaydedildi',
                data: {
                    tracks: updatedUser.tracks || [],
                    generatedLyrics: updatedUser.generatedLyrics || [],
                    personas: updatedUser.personas || [],
                    activityLog: updatedUser.activityLog || []
                }
            });
        }
    } catch (error) {
        console.error('User API error:', error);
        return res.status(500).json({ error: 'Server error', message: error.message });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
