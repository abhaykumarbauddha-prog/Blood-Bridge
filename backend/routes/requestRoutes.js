// backend/routes/requestRoutes.js
const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');

// POST request bhejkar naya data save karna
router.post('/', requestController.createRequest);

// GET request se data database se mangwana
router.get('/', requestController.getRequests);

// PUT request se request ka status update karna
router.put('/:id/status', requestController.updateRequestStatus);

module.exports = router;
