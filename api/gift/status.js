const connectToDatabase = require('../../utils/db').default;
const Transaction = require('../../models/Transaction');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        await connectToDatabase();
        const { transactionId } = req.query;

        if (!transactionId) return res.status(400).json({ error: 'Transaction ID required' });

        const transaction = await Transaction.findById(transactionId);
        if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

        // Check if Task ID is assigned (meaning Webhook fired and generation started)
        if (transaction.taskId) {
            return res.status(200).json({
                status: 'generation_started',
                taskId: transaction.taskId,
                data: transaction.metadata
            });
        }

        return res.status(200).json({
            status: transaction.status, // 'pending'
            message: 'Waiting for payment webhook...'
        });

    } catch (error) {
        console.error('Status Check Error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
