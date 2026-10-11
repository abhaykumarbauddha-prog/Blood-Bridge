// backend/routes/donorRoutes.js
const express = require('express');
const router = express.Router();
const donorController = require('../controllers/donorController');

router.get('/', donorController.getDonors);
router.put('/:id', donorController.updateProfile);

module.exports = router;