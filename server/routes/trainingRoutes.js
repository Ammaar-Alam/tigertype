const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const trainingController = require('../controllers/trainingController');

// All training endpoints require authentication
router.use(ensureAuthenticated);

router.get('/summary', trainingController.getSummary);
router.get('/history', trainingController.getHistory);
router.get('/recommendations', trainingController.getRecommendations);

module.exports = router;
