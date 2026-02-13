// server.js - Wix Entegrasyonlu BAZ AI Music Backend
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

// Models
const User = require('./models/User');
const Transaction = require('./models/Transaction');

// Middleware
const auth = require('./middleware/auth');
const { optionalAuth, requirePlan, requireFeature, requireModel } = require('./middleware/auth');
const checkCredits = require('./middleware/credits');
const { deductCredits, refundCredits, getCreditInfo, checkDailyLimit, CREDIT_COSTS } = require('./middleware/credits');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// CORS ayarları
app.use(cors({
  origin: [process.env.WIX_DOMAIN, 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());
app.use(express.static('public'));

// KIE.ai API Configuration
const KIE_API_URL = 'https://api.kie.ai/api/v1';
const API_KEY = process.env.KIE_API_KEY;

// In-memory task storage
const taskStorage = new Map();

// ==================== PUBLIC ENDPOINTS ====================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ==================== AUTH ENDPOINTS ====================

app.post('/api/auth/sync', auth, async (req, res) => {
  try {
    const creditInfo = await getCreditInfo(req.user);
    res.json({
      success: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        displayName: req.user.displayName,
        plan: req.user.planId,
        ...creditInfo,
        features: req.user.features,
        allowedModels: req.user.allowedModels
      }
    });
  } catch (error) {
    console.error('Auth sync error:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// ==================== CREDIT ENDPOINTS ====================

app.get('/api/user/credits', auth, async (req, res) => {
  try {
    const creditInfo = await getCreditInfo(req.user);
    res.json({ success: true, ...creditInfo });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

app.get('/api/user/transactions', auth, async (req, res) => {
  try {
    const { limit = 50, skip = 0, type, action } = req.query;
    const transactions = await Transaction.getUserHistory(req.user._id, {
      limit: parseInt(limit), skip: parseInt(skip), type, action
    });
    res.json({ success: true, transactions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

app.get('/api/user/stats', auth, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const stats = await Transaction.getUserStats(req.user._id, period);
    const actionStats = await Transaction.getActionStats(req.user._id);
    res.json({
      success: true,
      periodStats: stats,
      allTimeStats: actionStats,
      user: {
        totalCreditsUsed: req.user.totalCreditsUsed,
        totalSongsGenerated: req.user.totalSongsGenerated,
        memberSince: req.user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ==================== MUSIC GENERATION ====================

app.get('/api/generate', optionalAuth, async (req, res) => {
  try {
    const { taskId } = req.query;
    if (!taskId) return res.status(400).json({ error: 'Task ID gerekli.' });

    const targetUrl = `${KIE_API_URL}/generate/record-info?taskId=${taskId}`;
    const response = await axios.get(targetUrl, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });

    // Update local storage if we have it
    if (response.data.code === 200 && response.data.data) {
      const storedTask = taskStorage.get(taskId) || {};
      taskStorage.set(taskId, { ...storedTask, ...response.data.data, lastUpdated: new Date().toISOString() });
    }

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Durum sorgulanamadı',
      message: error.response?.data?.msg || error.message
    });
  }
});

app.post('/api/generate', auth, checkDailyLimit, requireModel, checkCredits('generate'), async (req, res) => {
  try {
    const { model, customMode, instrumental, title, style, prompt, vocalGender, negativeTags,
      styleWeight, weirdnessConstraint, audioWeight, personaId } = req.body;

    if (!req.user.canUseModel(model)) {
      return res.status(403).json({
        error: 'Model not allowed',
        allowedModels: req.user.allowedModels
      });
    }

    console.log(`🎵 Generating -> User: ${req.user.email}, Model: ${model}`);

    const payload = {
      model: model || "V4",
      customMode: customMode !== false,
      instrumental: instrumental || false,
      callBackUrl: `${process.env.CALLBACK_BASE_URL}/api/webhook`
    };

    if (customMode) {
      payload.title = title;
      payload.style = style;
      if (!instrumental) payload.prompt = prompt;
    } else {
      payload.prompt = prompt;
    }

    if (vocalGender) payload.vocalGender = vocalGender;
    if (negativeTags) payload.negativeTags = negativeTags;
    if (styleWeight !== undefined) payload.styleWeight = parseFloat(styleWeight);
    if (weirdnessConstraint !== undefined) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
    if (audioWeight !== undefined) payload.audioWeight = parseFloat(audioWeight);
    if (personaId && req.user.canUseFeature('persona')) payload.personaId = personaId;

    const response = await axios.post(`${KIE_API_URL}/generate/music`, payload, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });

    if (response.data.code === 200) {
      const taskId = response.data.data.taskId;
      const creditResult = await deductCredits(req, taskId);

      taskStorage.set(taskId, {
        userId: req.user._id, taskId, status: 'processing',
        createdAt: new Date().toISOString(), ...payload
      });

      res.json({ ...response.data, creditInfo: creditResult });
    } else {
      res.json(response.data);
    }
  } catch (error) {
    console.error('Generate error:', error.response?.data || error.message);
    if (req.creditCost && req.user) await refundCredits(req, 'Generation failed');
    res.status(error.response?.status || 500).json({
      error: 'Failed to generate music',
      message: error.response?.data?.msg || error.message
    });
  }
});

app.post('/api/extend', auth, requireFeature('extend'), checkCredits('extend'), async (req, res) => {
  try {
    const { prompt, style, title, instrumental, model, uploadUrl, continueAt, personaId } = req.body;

    if (!uploadUrl || !continueAt) {
      return res.status(400).json({ error: 'Missing uploadUrl or continueAt' });
    }

    const payload = {
      uploadUrl, continueAt: parseFloat(continueAt), defaultParamFlag: true,
      model: model || "V5", instrumental: instrumental || false,
      callBackUrl: `${process.env.CALLBACK_BASE_URL}/api/webhook`,
      title: title || "Extended Song", style: style || "Pop",
      ...(!instrumental && { prompt })
    };

    if (personaId && req.user.canUseFeature('persona')) payload.personaId = personaId;

    const response = await axios.post(`${KIE_API_URL}/generate/upload-extend`, payload, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });

    if (response.data.code === 200) {
      const creditResult = await deductCredits(req, response.data.data.taskId);
      res.json({ ...response.data, creditInfo: creditResult });
    } else {
      res.json(response.data);
    }
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to extend music', message: error.response?.data?.msg || error.message
    });
  }
});

app.post('/api/cover', auth, requireFeature('cover'), checkCredits('cover'), async (req, res) => {
  try {
    const { prompt, style, title, instrumental, model, uploadUrl, customMode,
      vocalGender, negativeTags, styleWeight, weirdnessConstraint, audioWeight, personaId } = req.body;

    if (!uploadUrl) return res.status(400).json({ error: 'Missing uploadUrl' });

    const isCustomMode = customMode !== false;
    const isInstrumental = instrumental === true;

    if (isCustomMode && !isInstrumental && !prompt) {
      return res.status(400).json({ error: 'Prompt required for custom vocal mode' });
    }

    const payload = {
      uploadUrl, model: model || "V5", customMode: isCustomMode,
      instrumental: isInstrumental, callBackUrl: `${process.env.CALLBACK_BASE_URL}/api/webhook`
    };

    if (isCustomMode) {
      payload.style = style || "Pop";
      payload.title = title || "Covered Song";
      if (!isInstrumental) payload.prompt = prompt;
    } else {
      payload.prompt = prompt;
    }

    if (vocalGender) payload.vocalGender = vocalGender;
    if (negativeTags) payload.negativeTags = negativeTags;
    if (styleWeight !== undefined) payload.styleWeight = parseFloat(styleWeight);
    if (weirdnessConstraint !== undefined) payload.weirdnessConstraint = parseFloat(weirdnessConstraint);
    if (audioWeight !== undefined) payload.audioWeight = parseFloat(audioWeight);
    if (personaId && req.user.canUseFeature('persona')) payload.personaId = personaId;

    const response = await axios.post(`${KIE_API_URL}/generate/upload-cover`, payload, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });

    if (response.data.code === 200) {
      const creditResult = await deductCredits(req, response.data.data.taskId);
      res.json({ ...response.data, creditInfo: creditResult });
    } else {
      res.json(response.data);
    }
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to create cover', message: error.response?.data?.msg || error.message
    });
  }
});

app.post('/api/lyrics/generate', auth, requireFeature('lyrics'), checkCredits('lyrics'), async (req, res) => {
  try {
    const response = await axios.post(`${KIE_API_URL}/lyrics/generate`, req.body, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });

    if (response.data.code === 200) {
      const creditResult = await deductCredits(req);
      res.json({ ...response.data, creditInfo: creditResult });
    } else {
      res.json(response.data);
    }
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to generate lyrics', message: error.response?.data?.msg || error.message
    });
  }
});

app.post('/api/lyrics', auth, async (req, res) => {
  try {
    const { taskId, audioId } = req.body;
    if (!taskId || !audioId) return res.status(400).json({ error: 'Missing taskId or audioId' });

    const response = await axios.post(`${KIE_API_URL}/generate/get-timestamped-lyrics`,
      { taskId, audioId },
      { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } }
    );
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch lyrics', message: error.response?.data?.msg || error.message
    });
  }
});

app.post('/api/persona/generate', auth, requireFeature('persona'), checkCredits('persona'), async (req, res) => {
  try {
    const { taskId, audioId, name, description } = req.body;
    if (!taskId || !audioId || !name || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const response = await axios.post(`${KIE_API_URL}/generate/generate-persona`,
      { taskId, audioId, name, description },
      { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } }
    );

    if (response.data.code === 200) {
      const creditResult = await deductCredits(req);
      res.json({ ...response.data, creditInfo: creditResult });
    } else {
      res.json(response.data);
    }
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to generate persona', message: error.response?.data?.msg || error.message
    });
  }
});

// ==================== TASK STATUS ====================

app.get('/api/task/:taskId', optionalAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const response = await axios.get(`${KIE_API_URL}/task/${taskId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });

    if (response.data.code === 200 && response.data.data) {
      const storedTask = taskStorage.get(taskId) || {};
      taskStorage.set(taskId, { ...storedTask, ...response.data.data, lastUpdated: new Date().toISOString() });
    }
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to get task status', message: error.response?.data?.msg || error.message
    });
  }
});

app.get('/api/tasks', auth, (req, res) => {
  const userTasks = Array.from(taskStorage.values())
    .filter(task => task.userId?.toString() === req.user._id.toString())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ tasks: userTasks });
});

// ==================== WIX WEBHOOKS ====================

const verifyWixWebhook = (req, res, next) => {
  const signature = req.headers['x-wix-signature'];
  const webhookSecret = process.env.WIX_WEBHOOK_SECRET;

  if (!webhookSecret) return next();
  if (!signature) return res.status(401).json({ error: 'Missing signature' });

  const expectedSignature = crypto.createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body)).digest('hex');

  if (signature !== expectedSignature) return res.status(401).json({ error: 'Invalid signature' });
  next();
};

app.post('/api/wix/subscription', verifyWixWebhook, async (req, res) => {
  try {
    const { eventType, data } = req.body;
    console.log(`📨 Wix Webhook: ${eventType}`);

    switch (eventType) {
      case 'SUBSCRIPTION_CREATED':
      case 'ORDER_PAID':
        await handleNewSubscription(data);
        break;
      case 'SUBSCRIPTION_CANCELLED':
        await handleCancellation(data);
        break;
      case 'SUBSCRIPTION_RENEWED':
      case 'RECURRING_CHARGE_SUCCESS':
        await handleRenewal(data);
        break;
      case 'SUBSCRIPTION_EXPIRED':
        await handleExpiration(data);
        break;
    }
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Wix webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.post('/api/wix/member', verifyWixWebhook, async (req, res) => {
  try {
    const { eventType, data } = req.body;

    if (eventType === 'MEMBER_CREATED') {
      const existingUser = await User.findByWixId(data.memberId);
      if (!existingUser) {
        await User.createFromWix({
          userId: data.memberId,
          email: data.email,
          displayName: data.nickname || data.firstName || ''
        });
      }
    } else if (eventType === 'MEMBER_DELETED') {
      await User.findOneAndUpdate(
        { wixUserId: data.memberId },
        { subscriptionStatus: 'cancelled', planId: 'free' }
      );
    }
    res.status(200).json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.post('/api/webhook', async (req, res) => {
  try {
    const { taskId, status, audioUrls, error } = req.body;
    console.log('🎵 KIE.ai Webhook:', { taskId, status });

    if (taskId && taskStorage.has(taskId)) {
      const task = taskStorage.get(taskId);
      taskStorage.set(taskId, {
        ...task, status, audioUrls, error,
        completedAt: status === 'completed' ? new Date().toISOString() : undefined,
        lastUpdated: new Date().toISOString()
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ==================== WEBHOOK HANDLERS ====================

async function handleNewSubscription(data) {
  const { buyerInfo, planId, orderId, validUntil } = data;
  const planMapping = { 'starter-plan': 'starter', 'pro-plan': 'pro', 'enterprise-plan': 'enterprise' };
  const internalPlanId = planMapping[planId] || 'starter';

  let user = await User.findByWixId(buyerInfo.memberId);

  if (!user) {
    user = await User.createFromWix({ userId: buyerInfo.memberId, email: buyerInfo.email, planId: internalPlanId });
  } else {
    await user.updatePlan(internalPlanId);
    user.subscriptionId = orderId;
    user.subscriptionStatus = 'active';
    user.subscriptionExpiry = validUntil ? new Date(validUntil) : null;
    await user.save();
  }

  await Transaction.create({
    userId: user._id, type: 'subscription', action: 'subscription_start',
    amount: user.monthlyCredits, balanceAfter: user.credits, wixOrderId: orderId,
    metadata: { planId: internalPlanId }
  });
  console.log(`✅ New subscription: ${user.email} -> ${internalPlanId}`);
}

async function handleCancellation(data) {
  const user = await User.findByWixId(data.buyerInfo.memberId);
  if (!user) return;

  user.subscriptionStatus = 'cancelled';
  await user.save();

  await Transaction.create({
    userId: user._id, type: 'subscription', action: 'subscription_cancel',
    amount: 0, balanceAfter: user.credits, wixOrderId: data.orderId
  });
  console.log(`⚠️ Subscription cancelled: ${user.email}`);
}

async function handleRenewal(data) {
  const user = await User.findByWixId(data.buyerInfo.memberId);
  if (!user) return;

  await user.resetMonthlyCredits();
  user.subscriptionStatus = 'active';
  user.subscriptionExpiry = data.validUntil ? new Date(data.validUntil) : null;
  await user.save();

  await Transaction.create({
    userId: user._id, type: 'subscription', action: 'subscription_renew',
    amount: user.monthlyCredits, balanceAfter: user.credits, wixOrderId: data.orderId
  });
  console.log(`🔄 Subscription renewed: ${user.email}`);
}

async function handleExpiration(data) {
  const user = await User.findByWixId(data.buyerInfo.memberId);
  if (!user) return;

  await user.updatePlan('free');
  user.subscriptionStatus = 'expired';
  await user.save();
  console.log(`❌ Subscription expired: ${user.email}`);
}

// ==================== ADMIN ====================

app.post('/api/admin/reset-monthly-credits', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const usersToReset = await User.find({
      lastCreditReset: { $lt: oneMonthAgo },
      subscriptionStatus: 'active'
    });

    let resetCount = 0;
    for (const user of usersToReset) {
      await user.resetMonthlyCredits();
      resetCount++;
    }
    res.json({ success: true, resetCount });
  } catch (error) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// ==================== CLEANUP & ERROR HANDLING ====================

function cleanupOldTasks() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [taskId, task] of taskStorage.entries()) {
    if (task.createdAt && new Date(task.createdAt) < oneHourAgo) {
      taskStorage.delete(taskId);
    }
  }
}
setInterval(cleanupOldTasks, 30 * 60 * 1000);

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// ==================== START ====================

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📦 KIE API: ${API_KEY ? '✓' : '✗'} | JWT: ${process.env.JWT_SECRET ? '✓' : '✗'} | MongoDB: ${process.env.MONGODB_URI ? '✓' : '✗'}`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await mongoose.connection.close();
  process.exit(0);
});
