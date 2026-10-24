// backend/routes/requestRoutes.js
const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });
    next();
};

const requestFields = [
    body('patient_name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('patient_name is invalid.'),
    body('blood_group').isString().trim().isLength({ min: 2, max: 4 }).withMessage('blood_group is invalid.'),
    body('units').isInt({ min: 1, max: 100 }).withMessage('units must be between 1 and 100.'),
    body('hospital_name').isString().trim().isLength({ min: 1, max: 160 }).withMessage('hospital_name is invalid.'),
    body('hospital_address').isString().trim().isLength({ min: 1, max: 300 }).withMessage('hospital_address is invalid.'),
    body('city').isString().trim().isLength({ min: 1, max: 100 }).withMessage('city is invalid.'),
    body('required_date').isISO8601().withMessage('required_date must be a valid date.'),
    body('required_time').matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).withMessage('required_time must be a valid time.'),
    body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
    body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
    body('requester_id').isUUID().withMessage('requester_id must be a valid UUID.')
];

// POST create a new blood request (runs smart matching & notifies donors)
router.post('/', requestFields, validate, requestController.createRequest);

// GET all blood requests
router.get('/', requestController.getRequests);

// GET donor history (includes both pledged and completed donations with requester names)
router.get('/donor-history/:donor_id', [param('donor_id').isUUID()], validate, requestController.getDonorHistory);

// POST donor accepts a blood request (pledges to donate & notifies requester)
router.post('/:id/accept', [param('id').isUUID()], validate, requestController.acceptRequest);

// POST mark donation as completed / held (updates history, dates, notifies both)
router.post('/:id/complete', [param('id').isUUID()], validate, requestController.completeDonation);

// PUT update request status
router.put('/:id/status', [param('id').isUUID(), body('status').isString().trim().notEmpty()], validate, requestController.updateRequestStatus);

module.exports = router;
