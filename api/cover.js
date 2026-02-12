// api/cover.js - Upload And Cover Audio API Endpoint
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
      customMode,
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
        details: 'Kapak yapılacak ses dosyasının URL\'sini girin.'
      });
    }

    // customMode false ise sadece prompt ve uploadUrl gerekli
    // customMode true ve instrumental false ise prompt, style, title, uploadUrl gerekli
    // customMode true ve instrumental true ise style, title, uploadUrl gerekli

    const isCustomMode = customMode !== false; // varsayılan true
    const isInstrumental = instrumental === true;

    if (!isCustomMode && !prompt) {
      return res.status(400).json({
        error: 'Non-custom modda prompt zorunludur.',
        details: 'Müzik açıklaması girin (max 500 karakter).'
      });
    }

    if (isCustomMode && !isInstrumental && !prompt) {
      return res.status(400).json({
        error: 'Custom modda şarkı sözleri (prompt) zorunludur.',
        details: 'Instrumental değilse şarkı sözleri gerekli.'
      });
    }

    // 4. Kie.ai'ye gidecek paketi hazırlıyoruz
    const payload = {
      uploadUrl: uploadUrl,
      model: model || "V5",
      customMode: isCustomMode,
      instrumental: isInstrumental,
      callBackUrl: callBackUrl || "https://google.com",
    };

    // Custom Mode parametreleri
    if (isCustomMode) {
      payload.style = style || "Pop";
      payload.title = title || "Covered Song";
      if (!isInstrumental) {
        payload.prompt = prompt;
      }
    } else {
      // Non-custom mode
      payload.prompt = prompt;
    }

    // Gelişmiş Parametreler (Varsa ekle)
    if (vocalGender) payload.vocalGender = vocalGender;
    if (negativeTags) payload.negativeTags = negativeTags;
    if (styleWeight !== undefined) payload.styleWeight = parseFloat(styleWeight);
    if (weirdnessConstraint !== undefined) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
    if (audioWeight !== undefined) payload.audioWeight = parseFloat(audioWeight);
    if (personaId) payload.personaId = personaId;

    console.log("Cover API - Kie.ai'ye giden istek:", payload);

    // 5. Kie.ai API İsteği
    const response = await axios.post('https://api.kie.ai/api/v1/generate/upload-cover', payload, {
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;

    // 6. Hata Kontrolü
    if (data.code && data.code !== 200) {
      console.error("Cover API Hatası:", data);
      throw new Error(data.msg || data.error || JSON.stringify(data));
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Cover Proxy Hatası:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: 'Cover işlemi başlatılamadı',
      details: error.response?.data?.msg || error.message
    });
  }
}
