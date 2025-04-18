const { pool } = require('../../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Database migration system for TigerType
 */

// Migration versions and their descriptions
const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema setup',
    up: async (client) => {
      // Create base tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          netid VARCHAR(50) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          avg_wpm NUMERIC(5,2) DEFAULT 0,
          avg_accuracy NUMERIC(5,2) DEFAULT 0,
          races_completed INTEGER DEFAULT 0,
          fastest_wpm NUMERIC(5,2) DEFAULT 0,
          bio TEXT,
          avatar_url TEXT
        );

        CREATE TABLE IF NOT EXISTS snippets (
          id SERIAL PRIMARY KEY,
          text TEXT NOT NULL UNIQUE,
          source VARCHAR(255),
          category VARCHAR(100),
          difficulty INT DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          word_count INTEGER,
          character_count INTEGER,
          is_princeton_themed BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS lobbies (
          id SERIAL PRIMARY KEY,
          code VARCHAR(8) UNIQUE NOT NULL,
          type VARCHAR(20) CHECK (type IN ('public', 'private', 'practice')) NOT NULL,
          status VARCHAR(20) CHECK (status IN ('waiting', 'countdown', 'racing', 'finished')) NOT NULL,
          snippet_id INT REFERENCES snippets(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMP,
          finished_at TIMESTAMP,
          host_id INTEGER REFERENCES users(id),
          text_category VARCHAR(20) DEFAULT 'general'
        );

        CREATE TABLE IF NOT EXISTS race_results (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id),
          lobby_id INT REFERENCES lobbies(id),
          snippet_id INT REFERENCES snippets(id),
          wpm DECIMAL(6, 2),
          accuracy DECIMAL(5, 2),
          completion_time DECIMAL(10, 2),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS lobby_players (
          lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          is_ready BOOLEAN DEFAULT FALSE,
          join_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (lobby_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
          "sid" varchar NOT NULL COLLATE "default",
          "sess" json NOT NULL,
          "expire" timestamp(6) NOT NULL,
          CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
        );
      `);
    }
  },
  {
    version: 2,
    description: 'Seed initial data',
    up: async (client) => {
      // Check if snippets already exist to avoid duplicates
      const existingCount = await client.query(`
        SELECT COUNT(*) FROM snippets 
        WHERE text = 'The quick brown fox jumps over the lazy dog.'
      `);
      
      if (parseInt(existingCount.rows[0].count) === 0) {
        console.log('No existing snippets found, adding test snippets...');
        
        // Insert test snippets
        await client.query(`
          INSERT INTO snippets (text, source, category, difficulty, word_count, character_count)
          VALUES 
            ('The quick brown fox jumps over the lazy dog.', 'Test', 'general', 1, 9, 43),
            ('To be or not to be, that is the question.', 'Shakespeare', 'literature', 2, 10, 35),
            ('All that glitters is not gold.', 'Shakespeare', 'literature', 2, 7, 28)
        `);
        
        // Insert Princeton-themed snippets
        await client.query(`
          INSERT INTO snippets (text, source, category, difficulty, is_princeton_themed, word_count, character_count)
          VALUES 
            ('Princeton University, founded in 1746 as the College of New Jersey, is a private Ivy League research university in Princeton, New Jersey.', 'Princeton History', 'princeton', 2, TRUE, 22, 123),
            ('Nassau Hall, one of Princeton''s oldest buildings, was named for King William III, Prince of Orange, of the House of Nassau.', 'Princeton Landmarks', 'princeton', 2, TRUE, 22, 123),
            ('The Princeton Tigers are the athletic teams of Princeton University. The school sponsors 38 varsity sports.', 'Princeton Athletics', 'princeton', 1, TRUE, 16, 100)
        `);
        
        console.log('Added test snippets successfully');
      } else {
        console.log('Test snippets already exist, skipping seed data insertion');
      }
    }
  },
  {
    version: 3,
    description: 'Update fastest_wpm for all users',
    up: async (client) => {
      console.log('Running migration to update fastest_wpm for all users...');
      
      // Update all users' fastest_wpm based on their race results
      await client.query(`
        UPDATE users u
        SET fastest_wpm = (
          SELECT MAX(wpm)
          FROM race_results
          WHERE user_id = u.id
        )
        WHERE EXISTS (
          SELECT 1
          FROM race_results
          WHERE user_id = u.id
        )
      `);
      
      console.log('Successfully updated fastest_wpm for all users');
    }
  },
  {
    version: 4,
    description: 'Add timed_leaderboard table',
    up: async (client) => {
      console.log('Running migration to add timed_leaderboard table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS timed_leaderboard (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          duration INT NOT NULL CHECK (duration IN (15, 30, 60, 120)),
          wpm DECIMAL(6, 2) NOT NULL,
          accuracy DECIMAL(5, 2) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_timed_leaderboard_user_id ON timed_leaderboard(user_id);
        CREATE INDEX IF NOT EXISTS idx_timed_leaderboard_duration ON timed_leaderboard(duration);
        CREATE INDEX IF NOT EXISTS idx_timed_leaderboard_wpm ON timed_leaderboard(wpm DESC);
        CREATE INDEX IF NOT EXISTS idx_timed_leaderboard_created_at ON timed_leaderboard(created_at DESC);
      `);
      console.log('Successfully created timed_leaderboard table and indexes.');
    }
  },
  {
    version: 5,
    description: 'Create partial_sessions table',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS partial_sessions (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          session_type VARCHAR(20) NOT NULL, -- 'snippet' or 'timed'
          words_typed INT NOT NULL,
          characters_typed INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_partial_sessions_user_id ON partial_sessions(user_id);
      `);
      console.log('Migration complete: Created partial_sessions table');
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS partial_sessions;
      `);
      console.log('Migration reverted: Dropped partial_sessions table');
    }
  },
  {
    version: 6,
    description: 'Add source URL and IDs to snippets table',
    up: async (client) => {
      console.log('Running migration to add source URL and IDs to snippets table...');
      await client.query(`
        ALTER TABLE snippets
        ADD COLUMN IF NOT EXISTS evaluation_url TEXT, -- Stores the full URL of the evaluation page
        ADD COLUMN IF NOT EXISTS source_course_id VARCHAR(10), -- Stores course ID like '002065'
        ADD COLUMN IF NOT EXISTS source_term_id VARCHAR(4); -- Stores term ID like '1252'
      `);
      console.log('Successfully added source columns to snippets table.');
    },
    down: async (client) => {
      // Optional: Add logic to remove the columns if needed for rollback
      console.log('Reverting migration to remove source columns from snippets table...');
      await client.query(`
        ALTER TABLE snippets
        DROP COLUMN IF EXISTS evaluation_url,
        DROP COLUMN IF EXISTS source_course_id,
        DROP COLUMN IF EXISTS source_term_id;
      `);
       console.log('Successfully removed source columns from snippets table.');
    }
  }
  ,
  {
    version: 6,
    description: 'Add optimistic concurrency version column to lobbies table',
    up: async (client) => {
      // Add a harmless integer column used for optimistic concurrency control.
      // We keep the default at 0 so legacy rows start with a defined value.
      await client.query(`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
      `);
      // Create an index to make look‑ups on (id, version) fast if the pattern is
      // ever used in the future.  This is safe to run even if the index already
      // exists thanks to the IF NOT EXISTS flag.
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_lobbies_version ON lobbies(version);
      `);
      console.log('Migration complete: added version column to lobbies table');
    },
    down: async (client) => {
      await client.query(`
        ALTER TABLE lobbies
        DROP COLUMN IF EXISTS version;
      `);
      await client.query('DROP INDEX IF EXISTS idx_lobbies_version;');
      console.log('Migration reverted: removed version column from lobbies table');
    }
  },
  {
    version: 7,
    description: 'Add Princeton course details to snippets table',
    up: async (client) => {
      console.log('Running migration to add Princeton course details to snippets table...');
      await client.query(`
        ALTER TABLE public.snippets
          ADD COLUMN IF NOT EXISTS princeton_course_url TEXT,
          ADD COLUMN IF NOT EXISTS term_code VARCHAR(4),
          ADD COLUMN IF NOT EXISTS course_id VARCHAR(6),
          ADD COLUMN IF NOT EXISTS course_name TEXT;
      `);
      console.log('Successfully added Princeton course columns to snippets table.');
    },
    down: async (client) => {
      console.log('Reverting migration to remove Princeton course details from snippets table...');
      await client.query(`
        ALTER TABLE public.snippets
          DROP COLUMN IF EXISTS princeton_course_url,
          DROP COLUMN IF EXISTS term_code,
          DROP COLUMN IF EXISTS course_id,
          DROP COLUMN IF EXISTS course_name;
      `);
       console.log('Successfully removed Princeton course columns from snippets table.');
    }
  },
  {
    version: 8,
    description: 'Ensure unique constraint on snippets.text',
    up: async (client) => {
      console.log('Running migration to ensure unique constraint on snippets.text...');
      // Check if the constraint already exists
      const constraintExists = await client.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'snippets'
          AND constraint_type = 'UNIQUE'
          AND constraint_name = 'snippets_text_key'; -- Use a specific name
      `);

      if (constraintExists.rowCount === 0) {
        console.log('Unique constraint snippets_text_key not found on snippets.text, adding it...');
        await client.query(`
          ALTER TABLE public.snippets
          ADD CONSTRAINT snippets_text_key UNIQUE (text);
        `);
        console.log('Successfully added UNIQUE constraint snippets_text_key to snippets.text.');
      } else {
        console.log('Unique constraint snippets_text_key already exists on snippets.text.');
      }
    },
    down: async (client) => {
      // Optional: Drop the constraint if it exists
      console.log('Reverting migration to remove unique constraint from snippets.text...');
      await client.query(`
        ALTER TABLE public.snippets
        DROP CONSTRAINT IF EXISTS snippets_text_key;
      `);
      console.log('Successfully removed unique constraint snippets_text_key from snippets.text (if it existed).');
    }
  }
];

// Create migrations table if it doesn't exist
const createMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

// Get current database version
const getCurrentVersion = async (client) => {
  const result = await client.query('SELECT MAX(version) as version FROM migrations');
  return result.rows[0].version || 0;
};

// Run all pending migrations
const runMigrations = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Create migrations table if it doesn't exist
    await createMigrationsTable(client);
    
    // Get current version
    const currentVersion = await getCurrentVersion(client);
    
    // Find pending migrations
    const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion);
    
    if (pendingMigrations.length === 0) {
      console.log('Database is up to date');
      await client.query('COMMIT');
      return;
    }
    
    // Run each pending migration
    for (const migration of pendingMigrations) {
      console.log(`Running migration ${migration.version}: ${migration.description}`);
      await migration.up(client);
      
      // Record migration
      await client.query(
        'INSERT INTO migrations (version, description) VALUES ($1, $2)',
        [migration.version, migration.description]
      );
    }
    
    await client.query('COMMIT');
    console.log('All migrations completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
};

// Log current database state for debugging
const logDatabaseState = async () => {
  const client = await pool.connect();
  try {
    // Check if migrations table exists
    const migrationsExist = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'migrations'
      );
    `);
    
    if (!migrationsExist.rows[0].exists) {
      console.log('Migrations table does not exist in the database');
      return;
    }
    
    // Get current version
    const version = await getCurrentVersion(client);
    console.log(`Current database version: ${version}`);
    
    // Check if fastest_wpm column exists
    const columnExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'fastest_wpm'
      );
    `);
    
    console.log(`fastest_wpm column exists: ${columnExists.rows[0].exists}`);
    
    // Get some sample data to verify
    const sampleData = await client.query(`
      SELECT id, netid, fastest_wpm 
      FROM users 
      WHERE fastest_wpm > 0 
      LIMIT 5;
    `);
    
    console.log('Sample users with fastest_wpm > 0:', sampleData.rows);
    
  } catch (err) {
    console.error('Error checking database state:', err);
  } finally {
    client.release();
  }
};

module.exports = {
  runMigrations,
  logDatabaseState
}; 