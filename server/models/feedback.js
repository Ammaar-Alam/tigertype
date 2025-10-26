const { pool } = require('../config/database');

const Feedback = {
  async create({ userId, netid, category, message, contactInfo, pagePath, userAgent }) {
    const normalizedCategory = ['feedback', 'bug', 'idea', 'other'].includes(category)
      ? category
      : 'feedback';

    const query = `
      INSERT INTO feedback_entries (user_id, netid, category, message, contact_info, page_path, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at
    `;

    const result = await pool.query(query, [
      userId || null,
      netid || null,
      normalizedCategory,
      message,
      contactInfo || null,
      pagePath || null,
      userAgent || null
    ]);

    return result.rows[0];
  }
};

module.exports = Feedback;
