const connectToDatabase = require('../../utils/db').default;
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const { generateMusic } = require('../../utils/musicGenerator');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Make-Secret');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const secret = req.headers['x-make-secret'] || req.query.secret;
    const EXPECTED_SECRET = process.env.MAKE_WEBHOOK_SECRET || 'changethis_secret_123';

    if (secret !== EXPECTED_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await connectToDatabase();
        const { email } = req.body;

        if (!email) return res.status(400).json({ error: 'Email required' });

        // 1. Find User
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // 2. Find Pending Transaction (Last 1 hour?)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const transaction = await Transaction.findOne({
            userId: user._id,
            status: 'pending',
            createdAt: { $gte: oneHourAgo }
        }).sort({ createdAt: -1 });

        if (!transaction) {
            return res.status(404).json({ error: 'No pending order found for this user.' });
        }

        // 3. Trigger Generation
        console.log(`Triggering generation via Webhook for transaction ${transaction._id}`);

        // Use metadata from transaction
        const generateResult = await generateMusic(
            transaction.metadata,
            user,
            null, // No req object needed for credit deduction here if we handle it differently
            transaction._id // Pass transaction ID to update it
        );

        return res.status(200).json({
            success: true,
            message: 'Generation triggered',
            data: generateResult
        });

    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
};
