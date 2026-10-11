// backend/routes/requestRoutes.js
const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');

// POST /api/requests - Create a new request
router.post('/', requestController.createRequest);

// GET /api/requests - Get all pending requests (supports query filters)
router.get('/', requestController.getRequests);

// PUT /api/requests/:id/status - Update the status of a specific request
router.put('/:id/status', requestController.updateRequestStatus);

module.exports = router;