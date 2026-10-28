// backend/routes/smartMatchRoutes.js
const express = require('express');
const router = express.Router();
const smartMatchController = require('../controllers/smartMatchController');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });
    next();
};

// POST /api/smart-match — Run smart matching with custom parameters
router.post('/', [
    body('blood_group').isString().trim().isLength({ min: 2, max: 4 }).withMessage('blood_group is required.'),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required.'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required.'),
    body('search_radius_km').optional().isInt({ min: 1, max: 500 }),
    body('urgency').optional().isString().trim(),
    body('requester_id').optional().isUUID()
], validate, smartMatchController.findSmartMatches);

// GET /api/smart-match/request/:id — Auto-match for existing blood request
router.get('/request/:id', [
    param('id').isUUID().withMessage('Valid request ID is required.')
], validate, smartMatchController.matchForRequest);

module.exports = router;
