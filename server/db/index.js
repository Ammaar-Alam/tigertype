const { pool } = require('../config/database');

// Initialize database tables
const initDB = async () => {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        netid VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create snippets table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS snippets (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        source VARCHAR(255),
        category VARCHAR(100),
        difficulty INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create lobbies table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lobbies (
        id SERIAL PRIMARY KEY,
        code VARCHAR(8) UNIQUE NOT NULL,
        type VARCHAR(20) CHECK (type IN ('public', 'private', 'practice')) NOT NULL,
        status VARCHAR(20) CHECK (status IN ('waiting', 'countdown', 'racing', 'finished')) NOT NULL,
        snippet_id INT REFERENCES snippets(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        finished_at TIMESTAMP
      )
    `);

    // Create race_results table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS race_results (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        lobby_id INT REFERENCES lobbies(id),
        snippet_id INT REFERENCES snippets(id),
        wpm DECIMAL(6, 2),
        accuracy DECIMAL(5, 2),
        completion_time DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_sessions table for session storage
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      ) WITH (OIDS=FALSE);
    `);

    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Error initializing database tables:', err);
    throw err;
  }
};

// Seed initial data for testing
const seedTestData = async () => {
  try {
    // Check if snippets exist
    const { rows } = await pool.query('SELECT COUNT(*) FROM snippets');
    
    if (parseInt(rows[0].count) === 0) {
      // Add some test snippets
      await pool.query(`
        INSERT INTO snippets (text, source, category, difficulty)
        VALUES 
          ('The quick brown fox jumps over the lazy dog.', 'Typing Exercise', 'beginner', 1),
          ('Princeton University is located in Princeton, New Jersey and is one of the oldest universities in the United States.', 'Princeton Facts', 'medium', 2),
          ('To be or not to be, that is the question. Whether ''tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles, and by opposing end them.', 'Shakespeare', 'advanced', 3)
      `);
      console.log('Added test snippets');
    }
  } catch (err) {
    console.error('Error seeding test data:', err);
  }
};

module.exports = {
  initDB,
  seedTestData
};