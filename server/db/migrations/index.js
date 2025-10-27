const { pool } = require('../../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Database migration system for TigerType
 */

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
    description: 'Add Princeton course URL and ID details to snippets table',
    up: async (client) => {
      console.log('Running migration to add Princeton course URL and ID details to snippets table...');
      await client.query(`
        ALTER TABLE snippets
        ADD COLUMN IF NOT EXISTS princeton_course_url TEXT,
        ADD COLUMN IF NOT EXISTS term_code VARCHAR(4),
        ADD COLUMN IF NOT EXISTS course_id VARCHAR(10),
        ADD COLUMN IF NOT EXISTS course_name TEXT;
      `);
      console.log('Successfully added Princeton course columns to snippets table.');
    },
    down: async (client) => {
      console.log('Reverting migration to remove Princeton course columns from snippets table...');
      await client.query(`
        ALTER TABLE snippets
        DROP COLUMN IF EXISTS princeton_course_url,
        DROP COLUMN IF EXISTS term_code,
        DROP COLUMN IF EXISTS course_id,
        DROP COLUMN IF EXISTS course_name;
      `);
      console.log('Successfully removed Princeton course columns from snippets table.');
    }
  },
  {
    version: 7,
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
    version: 8,
    description: 'Add Princeton course details to snippets table',
    up: async (client) => {
      console.log('Running migration to add Princeton course details to snippets table...');
      await client.query(`
        ALTER TABLE snippets
        ADD COLUMN IF NOT EXISTS course_department VARCHAR(10), -- e.g. COS
        ADD COLUMN IF NOT EXISTS course_number VARCHAR(10); -- e.g. 333
      `);
      console.log('Successfully added course detail columns to snippets table.');
    },
    down: async (client) => {
      console.log('Reverting migration to remove course detail columns from snippets table...');
      await client.query(`
        ALTER TABLE snippets
        DROP COLUMN IF EXISTS course_department,
        DROP COLUMN IF EXISTS course_number;
      `);
      console.log('Successfully removed Princeton course columns from snippets table.');
    }
  },
  {
    version: 9,
    description: 'Ensure unique constraint on snippets.text',
    up: async (client) => {
      console.log('Running migration to add has_completed_tutorial flag to users table...');
      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS has_completed_tutorial BOOLEAN DEFAULT false;
      `);
      console.log('Successfully added has_completed_tutorial column to users table.');
    },
    down: async (client) => {
      console.log('Reverting migration to remove has_completed_tutorial flag from users table...');
      await client.query(`
        ALTER TABLE users
        DROP COLUMN IF EXISTS has_completed_tutorial;
      `);
      console.log('Successfully removed has_completed_tutorial column from users table.');
    }
  },
  {
    version: 10,
    description: 'Add badges and user_badges tables',
    up: async (client) => {
      console.log('Running migration to add badges and user_badges tables...');
      await client.query(`
      CREATE TABLE IF NOT EXISTS badges (
        id SERIAL PRIMARY KEY,
        key VARCHAR UNIQUE NOT NULL,
        name VARCHAR NOT NULL,
        description TEXT,
        icon_url VARCHAR,
        criteria_type VARCHAR NOT NULL,
        criteria_value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_badges (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        badge_id INTEGER REFERENCES badges(id) ON DELETE CASCADE,
        awarded_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, badge_id)
      );
    `);

      // Check if badges already exist
      const existingBadgesCount = await client.query(`
      SELECT COUNT(*) FROM badges 
      WHERE key = 'first_race'
      `);

      if (parseInt(existingBadgesCount.rows[0].count) === 0) {
        console.log('No existing badges found, adding initial badges...');

        // Insert badges only if none exist
        await client.query(`
        INSERT INTO badges (key, name, description, icon_url, criteria_type, criteria_value)
        VALUES
          ('first_race', 'First Race', 'Complete your first race', '/icons/first-race.svg', 'races_completed', 1),
          ('ten_race', '10 Races', 'Complete 10 races', '/icons/10races.svg', 'races_completed', 10),
          ('one_hundred_race', '100 Races', 'Complete 100 races', '/icons/100races.svg', 'races_completed', 100),
          ('novice',  'Novice', 'Average WPM ≥ 100', '/icons/avg100.svg', 'avg_wpm', 100),
          ('intermediate',  'Intermediate', 'Average WPM ≥ 125', '/icons/avg125.svg', 'avg_wpm', 125),
          ('advanced',  'Advanced', 'Average WPM ≥ 150', '/icons/avg150.svg', 'avg_wpm', 150),
          ('expert',  'Expert', 'Average WPM ≥ 175', '/icons/avg175.svg', 'avg_wpm', 175),
          ('fast',  'Fast', 'Fastest WPM ≥ 150', '/icons/fastest150.svg', 'fastest_wpm', 150),
          ('faster',  'Faster', 'Fastest WPM ≥ 175', '/icons/fastest175.svg', 'fastest_wpm', 175),
          ('fastest',  'Fastest', 'Fastest WPM ≥ 200', '/icons/fastest200.svg', 'fastest_wpm', 200)
      `);

        console.log('Initial badges added successfully');
      } else {
        console.log('Badges already exist, skipping badge insertion');
      }
      console.log('Migration complete: badges / user_badges created.');
    },
    down: async (client) => {
      console.log('Reverting migration: dropping badges and user_badges tables...');
      await client.query(`
      DROP TABLE IF EXISTS user_badges;
      DROP TABLE IF EXISTS badges;
    `);
      console.log('Revert complete: badges / user_badges dropped.');
    }
  },
  {
    version: 11,
    description: 'Adds titles and user_titles tables',
    up: async (client) => {
      console.log('Running migration to add titles and user_titles tables...');
      await client.query(`
      CREATE TABLE IF NOT EXISTS titles (
      id SERIAL PRIMARY KEY,
      key VARCHAR UNIQUE NOT NULL,
      name VARCHAR UNIQUE NOT NULL,      
      description TEXT,                  
      criteria_type VARCHAR NOT NULL,    
      criteria_value INTEGER NOT NULL     
      );  

      CREATE TABLE IF NOT EXISTS user_titles (
      user_id INTEGER REFERENCES users(id)  ON DELETE CASCADE,
      titles_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
      awarded_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, titles_id)
      );
    `);

      // Check if title already exist
      const existingTitlesCount = await client.query(`
      SELECT COUNT(*) FROM titles 
      WHERE key = 'nice'
    `);

      if (parseInt(existingTitlesCount.rows[0].count) === 0) {
        console.log('No existing titles found, adding initial titles...');

        // Insert titles only if none exist
        await client.query(`
      INSERT INTO titles (key, name, description, criteria_type, criteria_value)
      VALUES 
        ('nice', 'Nice', 'Congrats on typing 69 words!', 'words_typed', 69);
      `);

        console.log('Initial titles added successfully');
      } else {
        console.log('Titles already exist, skipping badge insertion');
      }
      console.log('Migration complete: titles / user_titles created.');
    }, down: async (client) => {
      console.log('Reverting migration: dropping titles and user_titles tables...');
      await client.query(`
      DROP TABLE IF EXISTS user_titles;
      DROP TABLE IF EXISTS titles;
    `);
      console.log('Revert complete: titles / user_titles dropped.');
    }
  },
  {
    version: 12,
    description: 'Add elite titles and remove Nice title',
    up: async (client) => {
      console.log('Running migration 12: add elite titles and remove Nice title...');
      // Remove the 'Nice' title if it exists
      await client.query(
        `DELETE FROM titles WHERE key = 'nice';`
      );
      // Insert new elite titles
      await client.query(`
        INSERT INTO titles (key, name, description, criteria_type, criteria_value) VALUES
          ('wawa_warrior', 'Wawa Warrior', 'Complete a race or practice session with the super secret Wawa snippet', 'snippet_completed', 589),
          ('orange_lightning', 'Orange Lightning', 'Achieve an average WPM of 150+', 'avg_wpm', 150),
          ('president_eisgruber', 'President Eisgruber', 'Fastest recorded time for the 15-second global leaderboard', 'global_fastest', 0),
          ('beta_tester', 'Beta Tester', 'Complete a race before May 15, 2025', 'beta_tester', 20250515),
          ('needs_a_shower', 'Needs A Shower', 'Complete 1000 races', 'races_completed', 1000)
        ON CONFLICT (key) DO NOTHING;
      `);
    },
    down: async (client) => {
      console.log('Reverting migration 12: remove elite titles and restore Nice title...');
      // Remove the new elite titles
      await client.query(
        `DELETE FROM titles WHERE key IN ('wawa_warrior', 'orange_lightning', 'president_eisgruber', 'beta_tester', 'needs_a_shower');`
      );
      // Restore the original 'Nice' title
      await client.query(`
        INSERT INTO titles (key, name, description, criteria_type, criteria_value)
        VALUES ('nice', 'Nice', 'Congrats on typing 69 words!', 'words_typed', 69)
        ON CONFLICT (key) DO NOTHING;
      `);
    }
  },
  {
    version: 13,
    description: 'Add selected_title_id column to users table',
    up: async (client) => {
      console.log('Running migration 13: add selected_title_id column to users table...');
      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS selected_title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL;
      `);
      console.log('Migration complete: added selected_title_id to users table');
    },
    down: async (client) => {
      console.log('Reverting migration 13: remove selected_title_id column from users table...');
      await client.query(`
        ALTER TABLE users
        DROP COLUMN IF EXISTS selected_title_id;
      `);
      console.log('Revert complete: dropped selected_title_id column from users table');
    }
  },
  {
    version: 14,
    description: "Update titles: Modify Needs A Shower, Add Commitment Issues, Fastest/Slowest Typer, SPIA Major",
    up: async (client) => {
      console.log('Running migration 14: Update existing titles and add new ones...');
      // Update 'Needs A Shower'
      await client.query(`
        UPDATE titles
        SET 
          description = 'Complete 1000 tests',
          criteria_type = 'sessions_completed'
        WHERE key = 'needs_a_shower';
      `);

      // Add new titles
      await client.query(`
        INSERT INTO titles (key, name, description, criteria_type, criteria_value) VALUES
          ('commitment_issues', 'Commitment Issues', 'Achieve a completion rate of less than 5%', 'completion_rate_low', 5),
          ('princetons_fastest_typer', 'Princeton''s Fastest Typer', 'Highest average WPM across all users', 'global_highest_avg_wpm', 0),
          ('princetons_slowest_typer', 'Princeton''s Slowest Typer', 'Lowest average WPM across all users (min 10 sessions)', 'global_lowest_avg_wpm', 0),
          ('spia_major', 'SPIA Major', 'Type over 10,000 words in total', 'words_typed', 10000)
        ON CONFLICT (key) DO UPDATE SET -- Use UPDATE here in case migration is re-run
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          criteria_type = EXCLUDED.criteria_type,
          criteria_value = EXCLUDED.criteria_value;
      `);
      console.log('Migration 14 complete: Titles updated and added.');
    },
    down: async (client) => {
      console.log('Reverting migration 14: Remove new titles and revert Needs A Shower...');
      // Remove the four new titles
      await client.query(
        `DELETE FROM titles WHERE key IN ('commitment_issues', 'princetons_fastest_typer', 'princetons_slowest_typer', 'spia_major');`
      );

      // Restore 'Needs A Shower' to its state before migration 14
      await client.query(`
        UPDATE titles
        SET 
          description = 'Complete 1000 races', -- Original description
          criteria_type = 'races_completed'   -- Original criteria type
        WHERE key = 'needs_a_shower';
      `);
      console.log('Revert migration 14 complete.');
    }
  },
  {
    version: 15,
    description: "Fix column name inconsistency in user_titles table",
    up: async (client) => {
      console.log('Running migration 15: Checking for column name inconsistency in user_titles...');
      
      // Check if titles_id column exists
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'user_titles' AND column_name = 'titles_id';
      `);
      
      if (columnCheck.rows.length > 0) {
        console.log('Found titles_id column (plural). Converting to title_id (singular) for consistency...');
        
        // Need to drop existing primary key constraint and foreign key constraint before renaming
        await client.query(`
          ALTER TABLE user_titles DROP CONSTRAINT IF EXISTS user_titles_pkey;
          ALTER TABLE user_titles DROP CONSTRAINT IF EXISTS user_titles_titles_id_fkey;
        `);
        
        // Rename column
        await client.query(`
          ALTER TABLE user_titles RENAME COLUMN titles_id TO title_id;
        `);
        
        // Recreate constraints
        await client.query(`
          ALTER TABLE user_titles ADD CONSTRAINT user_titles_pkey PRIMARY KEY (user_id, title_id);
          ALTER TABLE user_titles ADD CONSTRAINT user_titles_title_id_fkey FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE;
        `);
        
        console.log('Successfully renamed column to title_id and recreated constraints.');
      } else {
        console.log('Column is already named title_id or table structure is different. No changes needed.');
      }
    },
    down: async (client) => {
      console.log('Reverting migration 15: Not implementing downgrade for column rename to avoid data loss.');
      // Not implementing downgrade as it could cause data loss
    }
  },
  {
    version: 16,
    description: "Add 'Record Holder' title",
    up: async (client) => {
      console.log("Running migration 16: Add 'Record Holder' title...");
      await client.query(`
        INSERT INTO titles (key, name, description, criteria_type, criteria_value) VALUES
          ('record_holder', 'Record Holder', 'Highest recorded fastest WPM across all users', 'global_highest_fastest_wpm', 0)
        ON CONFLICT (key) DO NOTHING;
      `);
      console.log("Migration 16 complete: Added 'Record Holder' title.");
    },
    down: async (client) => {
      console.log("Reverting migration 16: Remove 'Record Holder' title...");
      await client.query(
        `DELETE FROM titles WHERE key = 'record_holder';`
      );
      console.log("Revert migration 16 complete.");
    }
  },
  {
    version: 17,
    description: 'Add is_selected column to user_badges',
    up: async (client) => {
      console.log('Running migration 17: add is_selected column to user_badges...');
      await client.query(`
        ALTER TABLE user_badges
        ADD COLUMN IF NOT EXISTS is_selected BOOLEAN DEFAULT FALSE;
      `);
      console.log('Migration 17 complete.');
    },
    down: async (client) => {
      console.log('Reverting migration 17: drop is_selected column from user_badges...');
      await client.query(`
        ALTER TABLE user_badges
        DROP COLUMN IF EXISTS is_selected;
      `);
      console.log('Revert migration 17 complete.');
    }
  },
  {
    version: 18,
    description: 'Set ON DELETE SET NULL for snippet FKs (lobbies, race_results)',
    up: async (client) => {
      console.log('Migration 18: updating FK constraints on lobbies.snippet_id and race_results.snippet_id to ON DELETE SET NULL');
      await client.query(`
        ALTER TABLE lobbies
        DROP CONSTRAINT IF EXISTS lobbies_snippet_id_fkey;
        ALTER TABLE lobbies
        ADD CONSTRAINT lobbies_snippet_id_fkey
        FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE SET NULL;

        ALTER TABLE race_results
        DROP CONSTRAINT IF EXISTS race_results_snippet_id_fkey;
        ALTER TABLE race_results
        ADD CONSTRAINT race_results_snippet_id_fkey
        FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE SET NULL;
      `);
      console.log('Migration 18 complete.');
    },
    down: async (client) => {
      console.log('Reverting Migration 18: resetting FK constraints to default NO ACTION');
      await client.query(`
        ALTER TABLE lobbies
        DROP CONSTRAINT IF EXISTS lobbies_snippet_id_fkey;
        ALTER TABLE lobbies
        ADD CONSTRAINT lobbies_snippet_id_fkey
        FOREIGN KEY (snippet_id) REFERENCES snippets(id);

        ALTER TABLE race_results
        DROP CONSTRAINT IF EXISTS race_results_snippet_id_fkey;
        ALTER TABLE race_results
        ADD CONSTRAINT race_results_snippet_id_fkey
        FOREIGN KEY (snippet_id) REFERENCES snippets(id);
      `);
      console.log('Revert Migration 18 complete.');
    }
  },
  {
    version: 19,
    description: 'Add training session tables for adaptive practice mode',
    up: async (client) => {
      console.log('Running migration 19: creating training session tables...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS training_sessions (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT now(),
          completed_at TIMESTAMPTZ,
          mode VARCHAR(32) NOT NULL,
          duration_seconds INT,
          config JSONB NOT NULL,
          total_chars INT DEFAULT 0,
          error_count INT DEFAULT 0,
          corrected_errors INT DEFAULT 0,
          wpm NUMERIC(6,2),
          accuracy NUMERIC(5,2),
          snippet_id VARCHAR(64)
        );

        CREATE INDEX IF NOT EXISTS idx_training_sessions_user ON training_sessions(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS training_session_char_stats (
          session_id INT REFERENCES training_sessions(id) ON DELETE CASCADE,
          character TEXT NOT NULL,
          exposures INT NOT NULL DEFAULT 0,
          mistakes INT NOT NULL DEFAULT 0,
          extra_hits INT NOT NULL DEFAULT 0,
          avg_latency_ms NUMERIC(10,2),
          PRIMARY KEY (session_id, character)
        );

        CREATE TABLE IF NOT EXISTS training_user_char_totals (
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          character TEXT NOT NULL,
          exposures BIGINT NOT NULL DEFAULT 0,
          mistakes BIGINT NOT NULL DEFAULT 0,
          extra_hits BIGINT NOT NULL DEFAULT 0,
          total_latency_ms BIGINT NOT NULL DEFAULT 0,
          latency_samples BIGINT NOT NULL DEFAULT 0,
          last_seen TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (user_id, character)
        );

        CREATE INDEX IF NOT EXISTS idx_training_totals_user_mistakes ON training_user_char_totals(user_id, mistakes DESC);
      `);
      console.log('Migration 19 complete.');
    },
    down: async (client) => {
      console.log('Reverting migration 19: dropping training session tables...');
      await client.query(`
        DROP TABLE IF EXISTS training_session_char_stats;
        DROP TABLE IF EXISTS training_user_char_totals;
        DROP TABLE IF EXISTS training_sessions;
      `);
      console.log('Revert migration 19 complete.');
    }
  },
  {
    version: 20,
    description: 'Create training units, SRS state, and keystroke telemetry tables',
    up: async (client) => {
      console.log('Running migration 20: creating training unit catalog and analytics tables...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS training_units (
          id SERIAL PRIMARY KEY,
          unit_type VARCHAR(12) NOT NULL CHECK (unit_type IN ('char','digraph','trigraph','word','punct','digit')),
          token TEXT NOT NULL,
          display TEXT,
          UNIQUE (unit_type, token)
        );

        CREATE TABLE IF NOT EXISTS training_user_unit_totals (
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          unit_id INT REFERENCES training_units(id) ON DELETE CASCADE,
          exposures BIGINT NOT NULL DEFAULT 0,
          mistakes BIGINT NOT NULL DEFAULT 0,
          extra_hits BIGINT NOT NULL DEFAULT 0,
          latency_ms_sum BIGINT NOT NULL DEFAULT 0,
          latency_samples BIGINT NOT NULL DEFAULT 0,
          p50_latency_ms INT,
          p90_latency_ms INT,
          last_seen TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (user_id, unit_id)
        );

        CREATE TABLE IF NOT EXISTS training_user_unit_srs (
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          unit_id INT REFERENCES training_units(id) ON DELETE CASCADE,
          ease NUMERIC(4,2) NOT NULL DEFAULT 2.5,
          interval_days INT NOT NULL DEFAULT 0,
          due_at DATE NOT NULL DEFAULT CURRENT_DATE,
          stability NUMERIC(4,2),
          PRIMARY KEY (user_id, unit_id)
        );

        CREATE TABLE IF NOT EXISTS training_keystrokes (
          session_id INT REFERENCES training_sessions(id) ON DELETE CASCADE,
          idx INT NOT NULL,
          t_ms INT NOT NULL,
          expected TEXT NOT NULL,
          actual TEXT NOT NULL,
          correct BOOLEAN NOT NULL,
          backspace BOOLEAN NOT NULL DEFAULT false,
          dwell_ms INT,
          flight_ms INT,
          PRIMARY KEY (session_id, idx)
        );

        CREATE TABLE IF NOT EXISTS training_drills (
          id SERIAL PRIMARY KEY,
          text TEXT NOT NULL,
          tags TEXT[],
          difficulty INT DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_training_unit_totals_user ON training_user_unit_totals (user_id, mistakes DESC, exposures DESC);
        CREATE INDEX IF NOT EXISTS idx_training_unit_srs_due ON training_user_unit_srs (user_id, due_at);
        CREATE INDEX IF NOT EXISTS idx_training_keystrokes_session ON training_keystrokes (session_id, idx);
      `);

      await client.query(`
        INSERT INTO training_units (unit_type, token, display)
        VALUES
          ('char', ' ', 'Space'),
          ('punct', ',', ','),
          ('punct', '.', '.'),
          ('punct', '?', '?'),
          ('punct', '!', '!'),
          ('punct', ';', ';'),
          ('punct', ':', ':')
        ON CONFLICT DO NOTHING;
      `);

      await client.query(`
        WITH alphabet AS (
          SELECT unnest(ARRAY[
            'a','b','c','d','e','f','g','h','i','j','k','l','m',
            'n','o','p','q','r','s','t','u','v','w','x','y','z'
          ]) AS ch
        )
        INSERT INTO training_units (unit_type, token, display)
        SELECT 'char', alphabet.ch, upper(alphabet.ch) FROM alphabet
        ON CONFLICT DO NOTHING;
      `);

      await client.query(`
        INSERT INTO training_units (unit_type, token, display)
        SELECT 'digit', digit, digit
        FROM (VALUES ('0'),('1'),('2'),('3'),('4'),('5'),('6'),('7'),('8'),('9')) AS v(digit)
        ON CONFLICT DO NOTHING;
      `);
      console.log('Migration 20 complete.');
    },
    down: async (client) => {
      console.log('Reverting migration 20: dropping training unit catalog and analytics tables...');
      await client.query(`
        DROP TABLE IF EXISTS training_drills;
        DROP TABLE IF EXISTS training_keystrokes;
        DROP TABLE IF EXISTS training_user_unit_srs;
        DROP TABLE IF EXISTS training_user_unit_totals;
        DROP TABLE IF EXISTS training_units;
      `);
      console.log('Revert migration 20 complete.');
    }
  },
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
