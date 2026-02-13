// models/User.js - DÜZELTİLMİŞ
const mongoose = require('mongoose');

// SİZİN İSTEDİĞİNİZ PLAN KONFİGÜRASYONU
const PLAN_CONFIG = {
  none: {
    credits: 0,
    durationMonths: 0,
    price: 0,
    features: [],
    allowedModels: []
  },
  temel: {
    credits: 50,           // 50 yaratım hakkı
    durationMonths: 1,     // 1 ay
    price: 300,            // 300 TL
    features: ['generate', 'lyrics'],
    allowedModels: ['V4', 'V4_5']
  },
  uzman: {
    credits: 500,          // 500 yaratım hakkı
    durationMonths: 6,     // 6 ay
    price: 2800,           // 2800 TL
    features: ['generate', 'lyrics', 'extend', 'cover'],
    allowedModels: ['V4', 'V4_5', 'V4_5PLUS', 'V5']
  },
  pro: {
    credits: 1000,         // 1000 yaratım hakkı
    durationMonths: 12,    // 1 yıl
    price: 5000,           // 5000 TL
    features: ['generate', 'lyrics', 'extend', 'cover', 'persona'],
    allowedModels: ['V4', 'V4_5', 'V4_5PLUS', 'V4_5ALL', 'V5']
  }
};

const userSchema = new mongoose.Schema({
  // Wix bağlantısı
  wixUserId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  displayName: {
    type: String,
    default: ''
  },

  // Plan bilgileri
  planId: {
    type: String,
    enum: ['none', 'temel', 'uzman', 'pro'],
    default: 'none'
  },

  // Kredi sistemi - HER BUTONA BASIŞ = 1 KREDİ
  credits: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCredits: {
    type: Number,
    default: 0  // Paketle birlikte verilen toplam
  },
  totalUsed: {
    type: Number,
    default: 0
  },

  // Özellik izinleri
  features: {
    type: [String],
    default: []
  },
  allowedModels: {
    type: [String],
    default: []
  },

  // Abonelik bilgileri
  subscriptionId: String,
  subscriptionStatus: {
    type: String,
    enum: ['active', 'cancelled', 'expired', 'none'],
    default: 'none'
  },
  purchasedAt: Date,
  expiresAt: Date,

  // İstatistikler
  totalSongsGenerated: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Wix ID ile kullanıcı bul
userSchema.statics.findByWixId = function (wixUserId) {
  return this.findOne({ wixUserId });
};

// Wix'ten yeni kullanıcı oluştur
userSchema.statics.createFromWix = async function (wixData) {
  const user = new this({
    _id: wixData.userId, // FORCE MONGODB ID TO MATCH WIX ID
    wixUserId: wixData.userId,
    email: wixData.email,
    displayName: wixData.displayName || '',
    planId: 'none',
    credits: 0,
    features: [],
    allowedModels: []
  });
  return user.save();
};

// Plan aktifleştir (satın alma sonrası)
userSchema.methods.activatePlan = function (planId) {
  const plan = PLAN_CONFIG[planId];
  if (!plan) throw new Error('Geçersiz plan: ' + planId);

  this.planId = planId;
  this.credits = plan.credits;
  this.totalCredits = plan.credits;
  this.totalUsed = 0;
  this.features = plan.features;
  this.allowedModels = plan.allowedModels;
  this.subscriptionStatus = 'active';
  this.purchasedAt = new Date();

  // Bitiş tarihini hesapla
  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + plan.durationMonths);
  this.expiresAt = expiryDate;

  return this.save();
};

// Kredi kullan - HER BUTONA BASIŞ = 1 KREDİ
userSchema.methods.useCredit = async function () {
  if (this.credits <= 0) {
    throw new Error('Yetersiz kredi');
  }

  if (this.expiresAt && new Date() > this.expiresAt) {
    throw new Error('Paket süresi dolmuş');
  }

  this.credits -= 1;
  this.totalUsed += 1;
  this.totalSongsGenerated += 1;

  return this.save();
};

// Kredi iade et (hata durumunda)
userSchema.methods.refundCredit = async function () {
  this.credits += 1;
  this.totalUsed -= 1;
  this.totalSongsGenerated -= 1;
  return this.save();
};

// Özellik kontrolü
userSchema.methods.canUseFeature = function (feature) {
  return this.features.includes(feature);
};

// Model kontrolü
userSchema.methods.canUseModel = function (model) {
  return this.allowedModels.includes(model);
};

// Abonelik aktif mi?
userSchema.methods.isSubscriptionActive = function () {
  if (this.subscriptionStatus !== 'active') return false;
  if (this.expiresAt && new Date() > this.expiresAt) return false;
  if (this.credits <= 0) return false;
  return true;
};

// Kalan gün hesapla
userSchema.methods.getDaysRemaining = function () {
  if (!this.expiresAt) return 0;
  const now = new Date();
  const diff = this.expiresAt - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

module.exports = mongoose.model('User', userSchema);
module.exports.PLAN_CONFIG = PLAN_CONFIG;
