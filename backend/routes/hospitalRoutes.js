// backend/routes/hospitalRoutes.js
const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospitalController');

// GET request: Dashboard stats ke liye
router.get('/stats', hospitalController.getDashboardStats);

// POST request: Inventory update karne ke liye
router.post('/inventory', hospitalController.updateInventory);

module.exports = router;