// api/persona/generate.js
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
    const { taskId, audioId, name, description } = req.body;

    // Validasyon
    if (!taskId || !audioId || !name || !description) {
      return res.status(400).json({
        code: 400,
        error: 'Eksik alanlar',
        msg: 'taskId, audioId, name ve description alanları zorunludur.',
        required: ['taskId', 'audioId', 'name', 'description']
      });
    }

    console.log(`Persona Oluşturuluyor -> Task: ${taskId}, Audio: ${audioId}, Name: ${name}`);

    const payload = {
      taskId,
      audioId,
      name,
      description
    };

    // KIE.ai API isteği
    const response = await fetch('https://api.kie.ai/api/v1/generate/generate-persona', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log('Persona API Response:', data);

    // Hata Kontrolü
    if (!response.ok) {
      console.error("KIE.ai Persona API Hatası:", data);
      return res.status(response.status).json({
        code: response.status,
        error: 'Persona oluşturulamadı',
        msg: data.msg || data.error || 'API hatası'
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Persona Proxy Hatası:", error);
    return res.status(500).json({ 
      code: 500,
      error: 'Persona oluşturulamadı', 
      msg: error.message 
    });
  }
}
