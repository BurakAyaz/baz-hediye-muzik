const mongoose = require('mongoose');
const User = require('../models/User');

// Helper to decode token (Base64 or standard)
function decodeToken(token) {
    if (!token) return null;
    try {
        // Try Base64 decode of JSON
        if (token.includes('.') === false) { // Not a JWT
            let decodedStr = token;
            if (token.includes('%')) decodedStr = decodeURIComponent(token);
            const json = Buffer.from(decodedStr, 'base64').toString('utf8');
            return JSON.parse(json);
        }
        // If it looks like JWT (header.payload.signature), we might want to verify it if we had a secret
        // For now, assuming Base64 format as per api/user.js
        return null;
    } catch (e) {
        return null;
    }
}

const auth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Auth token missing' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = decodeToken(token);

        if (!decoded || !decoded.userId) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = await User.findOne({ wixUserId: decoded.userId });

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
};

const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = decodeToken(token);

        if (decoded && decoded.userId) {
            const user = await User.findOne({ wixUserId: decoded.userId });
            if (user) {
                req.user = user;
                req.token = token;
            }
        }
        next();
    } catch (error) {
        // Optional auth should not block if it fails
        next();
    }
};

const requirePlan = (planId) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (req.user.planId !== planId && req.user.planId !== 'pro') { // Pro can access everything usually
            return res.status(403).json({ error: 'Upgrade required' });
        }
        next();
    };
};

const requireFeature = (feature) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });

        // Admin or Pro override? For now stick to feature flags
        if (!req.user.canUseFeature(feature)) {
            return res.status(403).json({ error: `Feature not allowed: ${feature}` });
        }
        next();
    };
};

const requireModel = (req, res, next) => {
    // Middleware that checks if body.model is allowed
    // But model is in body, so we need body parser before this
    const model = req.body.model;
    if (!model) return next(); // If no model specified, let controller handle default

    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    if (!req.user.canUseModel(model)) {
        return res.status(403).json({ error: `Model not allowed: ${model}` });
    }
    next();
};

async function generateUserToken(userId) {
    // Server-side token generation helper
    // Uses same Base64 format as client for consistency
    try {
        const user = await User.findOne({ wixUserId: userId });
        if (!user) throw new Error('User not found');

        const tokenData = {
            userId: user.wixUserId,
            email: user.email,
            displayName: user.displayName,
            timestamp: Date.now()
        };
        const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');
        return { success: true, token, user };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// CommonJS Exports
module.exports = auth; // Default export for `const auth = require(...)`
module.exports.auth = auth;
module.exports.optionalAuth = optionalAuth;
module.exports.requirePlan = requirePlan;
module.exports.requireFeature = requireFeature;
module.exports.requireModel = requireModel;
module.exports.generateUserToken = generateUserToken;
