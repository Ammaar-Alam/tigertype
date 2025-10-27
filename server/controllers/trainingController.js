const TrainingModel = require('../models/training');

/**
 * Return aggregate training summary for the current user.
 */
const getSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await TrainingModel.getSummary(userId);
    res.json(summary);
  } catch (err) {
    console.error('Error fetching training summary:', err);
    res.status(500).json({ error: 'Failed to load training summary' });
  }
};

/**
 * Return recent training sessions for charting/history.
 */
const getHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 100));
    const sessions = await TrainingModel.getRecentSessions(userId, limit);
    res.json({ sessions });
  } catch (err) {
    console.error('Error fetching training history:', err);
    res.status(500).json({ error: 'Failed to load training history' });
  }
};

/**
 * Expose focus recommendations independently.
 */
const getRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;
    const recommendations = await TrainingModel.getRecommendations(userId, 8);
    res.json({ recommendations });
  } catch (err) {
    console.error('Error fetching training recommendations:', err);
    res.status(500).json({ error: 'Failed to load training recommendations' });
  }
};

const getPlan = async (req, res) => {
  try {
    const userId = req.user.id;
    const plan = await TrainingModel.getPlanForToday(userId, {
      maxCoreBlocks: Math.max(2, Math.min(parseInt(req.query.maxBlocks, 10) || 4, 6))
    });
    res.json(plan);
  } catch (err) {
    console.error('Error fetching training plan:', err);
    res.status(500).json({ error: 'Failed to load training plan' });
  }
};

const getDiagnostics = async (req, res) => {
  try {
    const userId = req.user.id;
    const diagnostics = await TrainingModel.getDiagnostics(userId);
    res.json(diagnostics);
  } catch (err) {
    console.error('Error fetching training diagnostics:', err);
    res.status(500).json({ error: 'Failed to load training diagnostics' });
  }
};

module.exports = {
  getSummary,
  getHistory,
  getRecommendations,
  getPlan,
  getDiagnostics
};
