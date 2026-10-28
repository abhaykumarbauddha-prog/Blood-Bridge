// backend/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { body, param, query, validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });
    next();
};

// GET /api/chat/conversations — List conversations for user
router.get('/conversations', [
    query('user_id').isUUID().withMessage('Valid user_id is required.')
], validate, chatController.getConversations);

// POST /api/chat/conversations — Create or get conversation
router.post('/conversations', [
    body('participant_1').isUUID().withMessage('participant_1 must be a valid UUID.'),
    body('participant_2').isUUID().withMessage('participant_2 must be a valid UUID.'),
    body('request_id').optional({ nullable: true }).isUUID()
], validate, chatController.createConversation);

// GET /api/chat/messages/:conversation_id — Get messages
router.get('/messages/:conversation_id', [
    param('conversation_id').isUUID().withMessage('Valid conversation_id is required.')
], validate, chatController.getMessages);

// POST /api/chat/messages — Send a message
router.post('/messages', [
    body('conversation_id').isUUID().withMessage('conversation_id is required.'),
    body('sender_id').isUUID().withMessage('sender_id is required.'),
    body('message').isString().trim().isLength({ min: 1, max: 5000 }).withMessage('Message is required (max 5000 chars).')
], validate, chatController.sendMessage);

// PUT /api/chat/messages/read — Mark messages as read
router.put('/messages/read', [
    body('conversation_id').isUUID().withMessage('conversation_id is required.'),
    body('user_id').isUUID().withMessage('user_id is required.')
], validate, chatController.markMessagesRead);

// POST /api/chat/assistant — Gemini Conversational AI Chatbot
router.post('/assistant', [
    body('message').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('Valid message is required.')
], validate, chatController.handleAssistantMessage);

module.exports = router;
