// backend/routes/hospitalRoutes.js
const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospitalController');
const { body, validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });
    next();
};

// GET request: Dashboard stats ke liye
router.get('/stats', hospitalController.getDashboardStats);
router.get('/', hospitalController.getHospitals);

// POST request: Inventory update karne ke liye
router.post('/inventory', [
    body('hospital_id').isUUID().withMessage('hospital_id must be a valid UUID.'),
    body('blood_group').isString().trim().isLength({ min: 2, max: 4 }).withMessage('blood_group is invalid.'),
    body('units').isInt({ min: 0, max: 100000 }).withMessage('units must be a non-negative integer.')
], validate, hospitalController.updateInventory);

module.exports = router;
