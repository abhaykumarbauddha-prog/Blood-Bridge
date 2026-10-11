// backend/routes/hospitalRoutes.js
const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospitalController');

router.get('/stats', hospitalController.getDashboardStats);
router.post('/inventory', hospitalController.updateInventory);

module.exports = router;