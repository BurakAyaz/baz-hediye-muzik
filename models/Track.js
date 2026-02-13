const mongoose = require('mongoose');

const TrackSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    taskId: {
        type: String,
        required: true,
        index: true
    },
    sunoId: {
        type: String,
        unique: true,
        required: true
    },
    title: {
        type: String
    },
    audioUrl: {
        type: String,
        required: true
    },
    imageUrl: {
        type: String
    },
    videoUrl: {
        type: String
    },
    duration: {
        type: Number
    },
    tags: {
        type: String
    },
    prompt: {
        type: String
    },
    status: {
        type: String,
        default: 'completed'
    },
    isPublic: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Prevent model overwrite in serverless environment
module.exports = mongoose.models.Track || mongoose.model('Track', TrackSchema);
