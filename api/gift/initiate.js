const connectToDatabase = require('../../utils/db').default;
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        await connectToDatabase();

        const { guestInfo, orderData } = req.body;

        if (!guestInfo || !guestInfo.email || !orderData) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Find or Create User
        let user = await User.findOne({ email: guestInfo.email });
        if (!user) {
            user = new User({
                wixUserId: 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                email: guestInfo.email,
                displayName: guestInfo.name || 'Guest',
                planId: 'none',
                credits: 0
            });
            await user.save();
        }

        // 2. Create Pending Transaction
        // We act like we are "charging" 0 credits for now, or just recording intent.
        // Status 'pending' means payment not confirmed yet.
        const transaction = new Transaction({
            userId: user._id,
            type: 'credit_use', // Or 'gift_order'
            action: 'generate',
            amount: 0,
            balanceAfter: user.credits,
            metadata: orderData, // Save all generation params here
            status: 'pending',
            description: 'Pending Gift Order'
        });

        await transaction.save();

        return res.status(200).json({
            success: true,
            transactionId: transaction._id,
            message: 'Order queued successfully'
        });

    } catch (error) {
        console.error('Initiate Gift Error:', error);
        return res.status(500).json({ error: 'Server error', message: error.message });
    }
};
