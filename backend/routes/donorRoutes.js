// backend/routes/donorRoutes.js
const express = require('express');
const router = express.Router();
const donorController = require('../controllers/donorController');

// GET request: Donors ko search karne ke liye
router.get('/', donorController.getDonors);

// PUT request: Profile update karne ke liye (id ke through)
router.put('/:id', donorController.updateProfile);

module.exports = router;