// api/proxy.js
const { MongoClient } = require('mongodb');
const axios = require('axios');

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

module.exports = async (req, res) => {
  // 1. Sadece POST isteği kabul et
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST isteği kabul edilir.' });
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. API Key Kontrolü
  if (!process.env.KIE_API_KEY) {
    return res.status(500).json({ error: 'Sunucu hatası: API Key eksik (Vercel Ayarlarını Kontrol Et).' });
  }

  // 3. KREDİ KONTROLÜ - Token varsa kredi kontrol et
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = decodeToken(token);

    if (decoded && decoded.userId) {
      try {
        const { db } = await connectToDatabase();
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ wixUserId: decoded.userId });

        if (!user) {
          return res.status(401).json({ error: 'Kullanıcı bulunamadı', code: 'NO_USER' });
        }

        // Süre kontrolü
        if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
          return res.status(403).json({
            error: 'Paket süresi dolmuş',
            code: 'EXPIRED',
            message: 'Paket süreniz doldu. Lütfen yeni paket satın alın.'
          });
        }

        // Kredi kontrolü
        if (!user.credits || user.credits < 1) {
          return res.status(403).json({
            error: 'Yetersiz kredi',
            code: 'NO_CREDITS',
            message: 'Yaratım hakkınız kalmadı. Lütfen yeni paket satın alın.',
            credits: 0
          });
        }

        // Krediyi düş
        const newCredits = user.credits - 1;
        const newTotalUsed = (user.totalUsed || 0) + 1;
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

        console.log('Proxy kredi düşüldü:', decoded.userId, 'Kalan:', newCredits);

      } catch (dbError) {
        console.error('Kredi kontrol hatası:', dbError);
        // DB hatası durumunda isteği engelleme ama logla
      }
    }
  }

  try {
    // HTML formundan gelen tüm gelişmiş verileri alıyoruz
    const {
      prompt, style, title, instrumental, model,
      vocalGender, negativeTags, styleWeight,
      weirdnessConstraint, audioWeight, personaId,
      callBackUrl
    } = req.body;

    // Kie.ai'ye gidecek paketi hazırlıyoruz
    const payload = {
      prompt: prompt,
      model: model || "V4",
      customMode: true,
      instrumental: instrumental || false,
      style: style || "Pop",
      title: title || "New Song",
      callBackUrl: callBackUrl || "https://google.com",

      // Gelişmiş Parametreler (Varsa ekle)
      ...(vocalGender && { vocalGender }),
      ...(negativeTags && { negativeTags }),
      ...(styleWeight && { styleWeight }),
      ...(weirdnessConstraint && { weirdnessConstraint }),
      ...(audioWeight && { audioWeight }),
      ...(personaId && { personaId })
    };

    console.log("Kie.ai'ye giden istek:", payload);

    // Kie.ai API İsteği
    const response = await axios.post('https://api.kie.ai/api/v1/generate', payload, {
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;

    // Hata Kontrolü (Axios throws on non-2xx by default, but checking data code if needed)
    if (data.code && data.code !== 200) {
      console.error("Kie.ai API İş Mantığı Hatası:", data);
      throw new Error(data.msg || data.error || JSON.stringify(data));
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Proxy Hatası:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: 'Müzik başlatılamadı',
      details: error.response?.data?.msg || error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
};