# Database Scalability Recommendations
**[AI GENERATED FILE]**

## Current Schema Analysis

The current database schema for TigerType uses PostgreSQL with several tables:

- `users` - Stores user information and stats
- `snippets` - Stores text excerpts for typing
- `lobbies` - Manages race sessions
- `race_results` - Stores performance data
- `lobby_players` - Junction table for users in lobbies

The main scalability concern identified is the potential growth of the `lobbies` table if the application grows to handle hundreds of thousands of lobbies.

## Scalability Recommendations

### 1. Lobby Lifecycle Management

Currently, lobbies remain in the database indefinitely. This will lead to significant scaling issues:

```sql
-- Current structure
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
```

**Recommendations:**

1. **Implement Automatic Lobby Cleanup**:
   - Add a cron job or scheduled task to archive or delete inactive/completed lobbies
   - For practice lobbies, delete immediately after completion
   - For public/private lobbies, archive after 24-48 hours

2. **Add Lobby Expiration**:
   - Add an `expires_at` column to the `lobbies` table
   - Set default expiration (e.g., 48 hours for regular lobbies, 1 hour for practice)
   - Create an index on this column for efficient cleanup operations

3. **Implement Lobby Archiving**:
   - Create a `lobby_archives` table with the same structure as `lobbies`
   - Move completed lobbies to the archive table after a set period
   - Maintain only active/recent lobbies in the main table

### 2. Database Indexing Improvements

Current indexes are good but could be expanded:

```sql
CREATE INDEX IF NOT EXISTS idx_race_results_user_id ON race_results(user_id);
CREATE INDEX IF NOT EXISTS idx_race_results_lobby_id ON race_results(lobby_id);
CREATE INDEX IF NOT EXISTS idx_lobby_players_lobby_id ON lobby_players(lobby_id);
CREATE INDEX IF NOT EXISTS idx_lobby_players_user_id ON lobby_players(user_id);
```

**Recommendations:**

1. **Add Compound Indexes**:
   ```sql
   -- Index for finding active lobbies efficiently
   CREATE INDEX idx_lobbies_status_type ON lobbies(status, type);
   
   -- Index for finding lobbies by creation time (for cleanup)
   CREATE INDEX idx_lobbies_created_at ON lobbies(created_at);
   
   -- Index for finding lobbies by code (for joining)
   CREATE INDEX idx_lobbies_code ON lobbies(code);
   ```

2. **Add Partial Indexes** for common queries:
   ```sql
   -- Index only for active lobbies (most common query)
   CREATE INDEX idx_lobbies_active ON lobbies(id, created_at) 
   WHERE status IN ('waiting', 'countdown', 'racing');
   ```

### 3. Lobby Code Management

The current system uses an 8-character unique code for each lobby:

```sql
code VARCHAR(8) UNIQUE NOT NULL
```

This could lead to index bloat and performance issues as the number of lobbies grows.

**Recommendations:**

1. **Code Recycling**:
   - Implement a system to recycle lobby codes after lobbies are archived/deleted
   - Maintain a pool of available codes that can be reused

2. **Sharding by Prefix**:
   - Consider using a prefix in the lobby code to indicate the type or age of the lobby
   - This can help with partitioning or sharding if needed in the future

### 4. Partitioning

For extremely large-scale deployments (millions of lobbies):

**Recommendations:**

1. **Time-Based Partitioning**:
   - Partition the `lobbies` table by month or quarter
   - This makes cleanup more efficient and keeps active partitions smaller

2. **Type-Based Partitioning**:
   - Partition by lobby type (`practice`, `public`, `private`)
   - This can improve query performance as `practice` lobbies may have different access patterns

### 5. Query Optimization

**Recommendations:**

1. **Optimize Lobby Listing Queries**:
   - Current query for finding active public lobbies:
   ```sql
   SELECT l.*, s.category, COUNT(lp.user_id) as player_count
   FROM lobbies l
   JOIN lobby_players lp ON l.id = lp.lobby_id
   JOIN snippets s ON l.snippet_id = s.id
   WHERE l.type = 'public' AND l.status = 'waiting'
   GROUP BY l.id, s.category
   ORDER BY l.created_at ASC;
   ```
   
   - Optimize by limiting results and using better indexes:
   ```sql
   SELECT l.id, l.code, l.created_at, s.category, COUNT(lp.user_id) as player_count
   FROM lobbies l
   JOIN lobby_players lp ON l.id = lp.lobby_id
   JOIN snippets s ON l.snippet_id = s.id
   WHERE l.type = 'public' AND l.status = 'waiting'
   GROUP BY l.id, l.code, l.created_at, s.category
   ORDER BY l.created_at DESC
   LIMIT 20;
   ```

2. **Implement Pagination**:
   - Use cursor-based pagination rather than offset-based for better performance
   - Example:
   ```sql
   SELECT l.id, l.code, l.created_at, s.category, COUNT(lp.user_id) as player_count
   FROM lobbies l
   JOIN lobby_players lp ON l.id = lp.lobby_id
   JOIN snippets s ON l.snippet_id = s.id
   WHERE l.type = 'public' AND l.status = 'waiting'
   AND l.created_at < $1  -- Cursor value from previous page
   GROUP BY l.id, l.code, l.created_at, s.category
   ORDER BY l.created_at DESC
   LIMIT 20;
   ```

### 6. Caching

**Recommendations:**

1. **Implement Redis Cache**:
   - Cache active lobby lists with short TTL (5-10 seconds)
   - Cache lobby details for frequently accessed lobbies
   - Invalidate cache when lobby status changes

2. **Lobby List Caching**:
   - Cache the results of common queries like "list of available public lobbies"
   - Update the cache when new lobbies are created or lobbies change status

## Implementation Priority

1. Lobby lifecycle management (highest priority)
2. Improved indexing
3. Lobby code recycling
4. Query optimization
5. Caching
6. Partitioning (only when reaching millions of records)

By implementing these recommendations, the TigerType database will be able to efficiently handle hundreds of thousands of lobbies while maintaining good performance. 