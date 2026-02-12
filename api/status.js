// api/status.js
const axios = require('axios');

export default async function handler(req, res) {
  // 1. Task ID'yi URL'den al
  const { taskId } = req.query;

  if (!taskId) {
    return res.status(400).json({ error: 'Task ID gerekli.' });
  }

  // 2. API Key Kontrolü
  if (!process.env.KIE_API_KEY) {
    return res.status(500).json({ error: 'API Key eksik (Vercel ayarlarını kontrol et).' });
  }

  try {
    // DOKÜMANTASYONA GÖRE DOĞRU ADRES:
    // GET /api/v1/generate/record-info?taskId=...
    const targetUrl = `https://api.kie.ai/api/v1/generate/record-info?taskId=${taskId}`;

    console.log("Durum Sorgulanıyor:", targetUrl);

    const response = await axios.get(targetUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;

    // 3. Hata Yönetimi (Axios normalde catch'e düşer ama yine de kontrol)
    if (data.code && data.code !== 200) {
      console.error("API Hatası:", data);
      throw new Error(data.msg || "Durum sorgulanamadı");
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Status Proxy Hatası:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.message,
      details: error.response?.data?.msg || "Internal Server Error"
    });
  }
}