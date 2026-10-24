// backend/routes/donorRoutes.js
const express = require('express');
const router = express.Router();
const donorController = require('../controllers/donorController');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });
    next();
};

// GET request: Donors ko search karne ke liye
router.get('/', donorController.getDonors);

// PUT request: Profile update karne ke liye (id ke through)
router.put('/:id', [
    param('id').isUUID().withMessage('id must be a valid UUID.'),
    body('blood_group').optional({ nullable: true }).isString().trim().isLength({ min: 2, max: 4 }),
    body('city').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('last_donation_date').optional({ nullable: true }).isISO8601(),
    body('is_available').optional({ nullable: true }).isBoolean().withMessage('is_available must be boolean.')
], validate, donorController.updateProfile);

module.exports = router;
