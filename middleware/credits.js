// middleware/credits.js - DÜZELTİLMİŞ (Factory & Direct Support)
// HER BUTONA BASIŞ = 1 KREDİ

const Transaction = require('../models/Transaction');

/**
 * Kredi kontrolü middleware'i
 * Hem checkCredits('action') hem de checkCredits(req, res, next) şeklinde kullanılabilir.
 */
const checkCredits = (reqOrAction, res, next) => {
  // 1. Direct Middleware Usage: checkCredits(req, res, next)
  if (res && next) {
    const req = reqOrAction;
    return handleCheck(req, res, next, 'general');
  }

  // 2. Factory Usage: checkCredits('action')
  const action = typeof reqOrAction === 'string' ? reqOrAction : 'general';
  return (req, res, next) => handleCheck(req, res, next, action);
};

// Asıl kontrol fonksiyonu
const handleCheck = async (req, res, next, action) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Yetkilendirme gerekli',
        message: 'Lütfen giriş yapın'
      });
    }

    // Abonelik aktif mi?
    if (!req.user.isSubscriptionActive()) {
      // Süre dolmuş mu?
      if (req.user.expiresAt && new Date() > req.user.expiresAt) {
        return res.status(403).json({
          error: 'Paket süresi dolmuş',
          message: 'Paket süreniz doldu. Lütfen yeni paket satın alın.',
          code: 'EXPIRED',
          expiresAt: req.user.expiresAt
        });
      }

      // Kredi bitmiş mi?
      if (req.user.credits <= 0) {
        return res.status(403).json({
          error: 'Yetersiz kredi',
          message: 'Yaratım hakkınız kalmadı. Lütfen yeni paket satın alın.',
          code: 'NO_CREDITS',
          credits: 0
        });
      }

      // Abonelik yok
      return res.status(403).json({
        error: 'Abonelik gerekli',
        message: 'Aktif bir paketiniz bulunmuyor.',
        code: 'NO_SUBSCRIPTION'
      });
    }

    // Kredi yeterli mi? (1 kredi gerekli)
    if (req.user.credits < 1) {
      return res.status(403).json({
        error: 'Yetersiz kredi',
        message: 'Yaratım hakkınız kalmadı. Lütfen yeni paket satın alın.',
        code: 'NO_CREDITS',
        credits: req.user.credits
      });
    }

    // Kredi bilgisini ve aksiyonu request'e ekle
    req.creditsBefore = req.user.credits;
    req.creditAction = action;

    next();

  } catch (error) {
    console.error('Credit check error:', error);
    res.status(500).json({ error: 'Kredi kontrolü başarısız' });
  }
};

/**
 * Kredi düşürme fonksiyonu
 * İşlem başarılı olduktan SONRA çağrılır
 * 1 kredi düşer
 */
const deductCredit = async (req, transactionData = {}) => {
  try {
    const user = req.user;
    const creditsBefore = user.credits;

    // 1 kredi düş
    await user.useCredit();

    // Transaction kaydı oluştur
    const transaction = new Transaction({
      userId: user._id,
      type: 'credit_use',
      action: transactionData.type || req.creditAction || 'generate',
      amount: -1,
      balanceAfter: user.credits,
      taskId: transactionData.taskId,
      metadata: {
        audioId: transactionData.audioId,
        audioUrl: transactionData.audioUrl,
        title: transactionData.title,
        style: transactionData.style,
        prompt: transactionData.prompt,
        model: transactionData.model
      },
      status: 'completed'
    });

    await transaction.save();

    return {
      success: true,
      creditsUsed: 1,
      creditsBefore: creditsBefore,
      creditsRemaining: user.credits,
      transactionId: transaction._id
    };

  } catch (error) {
    console.error('Deduct credit error:', error);
    throw error;
  }
};

/**
 * Kredi iade fonksiyonu (hata durumunda)
 */
const refundCredit = async (req, reason = 'İşlem başarısız') => {
  try {
    const user = req.user;

    await user.refundCredit();

    // İade kaydı oluştur
    const transaction = new Transaction({
      userId: user._id,
      type: 'refund',
      action: 'refund',
      amount: +1,
      balanceAfter: user.credits,
      status: 'refunded',
      description: reason
    });

    await transaction.save();

    return {
      success: true,
      refundedCredits: 1,
      creditsRemaining: user.credits
    };

  } catch (error) {
    console.error('Refund credit error:', error);
    throw error;
  }
};

/**
 * Kredi bilgisi alma
 */
const getCreditInfo = (user) => {
  return {
    credits: user.credits,
    totalCredits: user.totalCredits,
    used: user.totalUsed,
    remaining: user.credits,
    plan: user.planId,
    expiresAt: user.expiresAt,
    daysRemaining: user.getDaysRemaining ? user.getDaysRemaining() : 0,
    isActive: user.isSubscriptionActive ? user.isSubscriptionActive() : false
  };
};

module.exports = checkCredits;
module.exports.deductCredit = deductCredit;
module.exports.refundCredit = refundCredit;
module.exports.getCreditInfo = getCreditInfo;
