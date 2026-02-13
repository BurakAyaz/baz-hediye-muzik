const axios = require('axios');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL required' });
    }

    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer' // Important for binary data
        });

        // Copy content type
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for speed

        // Send buffer
        res.send(response.data);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch file' });
    }
};
