// models/Transaction.js - DÜZELTİLMİŞ
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // İşlem türü
  type: {
    type: String,
    enum: ['credit_use', 'credit_add', 'subscription', 'refund'],
    required: true
  },
  
  // Yapılan işlem
  action: {
    type: String,
    enum: [
      'generate',           // Müzik üretimi
      'extend',             // Müzik uzatma
      'cover',              // Cover oluşturma
      'lyrics',             // Şarkı sözü üretimi
      'persona',            // Persona oluşturma
      'subscription_start', // Abonelik başlangıcı
      'subscription_renew', // Abonelik yenileme
      'subscription_cancel',// Abonelik iptali
      'refund',             // İade
      'manual'              // Manuel ekleme
    ],
    required: true
  },
  
  // Kredi değişimi (-1 veya +1)
  amount: {
    type: Number,
    required: true
  },
  
  // İşlem sonrası bakiye
  balanceAfter: {
    type: Number,
    required: true
  },
  
  // KIE.ai bilgileri
  taskId: {
    type: String,
    default: null
  },
  
  // Wix sipariş ID
  wixOrderId: {
    type: String,
    default: null
  },
  
  // Ek bilgiler (şarkı detayları vs.)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Açıklama
  description: {
    type: String,
    default: ''
  },
  
  // Durum
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed', 'refunded'],
    default: 'completed'
  }
}, {
  timestamps: true
});

// İndeksler
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ taskId: 1 });

// Kullanıcının işlem geçmişini al
transactionSchema.statics.getUserHistory = function(userId, options = {}) {
  const { limit = 50, skip = 0, type, action } = options;
  
  const query = { userId };
  
  if (type) query.type = type;
  if (action) query.action = action;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Kullanıcının istatistiklerini al
transactionSchema.statics.getUserStats = async function(userId) {
  const stats = await this.aggregate([
    { 
      $match: { 
        userId: new mongoose.Types.ObjectId(userId), 
        type: 'credit_use' 
      } 
    },
    { 
      $group: {
        _id: '$action',
        count: { $sum: 1 }
      }
    }
  ]);
  
  return stats.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});
};

// Türkçe açıklamalar
const ACTION_DESCRIPTIONS = {
  generate: 'Müzik Üretimi',
  extend: 'Müzik Uzatma',
  cover: 'Cover Oluşturma',
  lyrics: 'Şarkı Sözü',
  persona: 'Persona',
  subscription_start: 'Paket Aktivasyonu',
  subscription_renew: 'Paket Yenileme',
  subscription_cancel: 'Paket İptali',
  refund: 'İade',
  manual: 'Manuel İşlem'
};

transactionSchema.virtual('actionDescription').get(function() {
  return ACTION_DESCRIPTIONS[this.action] || this.action;
});

// JSON çıktısı
transactionSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Transaction', transactionSchema);
