// api/extend.js - Upload And Extend Audio API Endpoint
const axios = require('axios');

export default async function handler(req, res) {
  // 1. Sadece POST isteği kabul et
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST isteği kabul edilir.' });
  }

  // 2. API Key Kontrolü
  if (!process.env.KIE_API_KEY) {
    return res.status(500).json({ error: 'Sunucu hatası: API Key eksik (Vercel Ayarlarını Kontrol Et).' });
  }

  try {
    // HTML formundan gelen verileri alıyoruz
    const {
      uploadUrl,
      prompt,
      style,
      title,
      continueAt,
      instrumental,
      model,
      vocalGender,
      negativeTags,
      styleWeight,
      weirdnessConstraint,
      audioWeight,
      personaId,
      callBackUrl
    } = req.body;

    // 3. Validasyon
    if (!uploadUrl) {
      return res.status(400).json({
        error: 'uploadUrl zorunludur.',
        details: 'Uzatılacak ses dosyasının URL\'sini girin.'
      });
    }

    if (!continueAt) {
      return res.status(400).json({
        error: 'continueAt zorunludur.',
        details: 'Müziğin hangi saniyeden devam edeceğini belirtin.'
      });
    }

    const isInstrumental = instrumental === true;

    // 4. Kie.ai'ye gidecek paketi hazırlıyoruz
    const payload = {
      uploadUrl: uploadUrl,
      model: model || "V5",
      continueAt: parseInt(continueAt),
      callBackUrl: callBackUrl || "https://google.com",
      customMode: true,
      instrumental: isInstrumental,
    };

    // Custom Mode parametreleri
    payload.style = style || "Pop";
    payload.title = title || "Extended Song";

    if (!isInstrumental && prompt) {
      payload.prompt = prompt;
    }

    // Gelişmiş Parametreler (Varsa ekle)
    if (vocalGender) payload.vocalGender = vocalGender;
    if (negativeTags) payload.negativeTags = negativeTags;
    if (styleWeight !== undefined) payload.styleWeight = parseFloat(styleWeight);
    if (weirdnessConstraint !== undefined) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
    if (audioWeight !== undefined) payload.audioWeight = parseFloat(audioWeight);
    if (personaId) payload.personaId = personaId;

    console.log("Extend API - Kie.ai'ye giden istek:", payload);

    // 5. Kie.ai API İsteği - Upload and Extend endpoint
    const response = await axios.post('https://api.kie.ai/api/v1/generate/upload-extend', payload, {
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;

    // 6. Hata Kontrolü
    if (data.code && data.code !== 200) {
      console.error("Extend API Hatası:", data);
      throw new Error(data.msg || data.error || JSON.stringify(data));
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Extend Proxy Hatası:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: 'Extend işlemi başlatılamadı',
      details: error.response?.data?.msg || error.message
    });
  }
}
