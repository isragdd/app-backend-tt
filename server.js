const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const path = require('path');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Use proper database path
const dbPath = path.join(dataDir, 'rpg_tasks.db');
console.log('📁 Database location:', dbPath);

const db = new Database(dbPath, { verbose: console.log });

// Create tables if they don't exist
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT DEFAULT 'default',
      stats TEXT NOT NULL,
      tasks TEXT NOT NULL,
      items TEXT NOT NULL,
      props TEXT NOT NULL,
      custom TEXT NOT NULL,
      day TEXT NOT NULL,
      collapsed TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_user_id ON game_state(user_id);
  `);
  console.log('✅ Database tables initialized');
} catch (err) {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
}

// Ensure default user exists
const existingState = db.prepare(
  'SELECT 1 FROM game_state WHERE user_id = ?'
).get('default');

if (!existingState) {
  db.prepare(`
    INSERT INTO game_state (user_id, stats, tasks, items, props, custom, day, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'default',
    JSON.stringify({ trust: 0, rupees: 0, hearts: 3, maxHearts: 5, xp: 0, level: 1, ticksToday: 0 }),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    '',
    JSON.stringify({})
  );
}

//
// ✅ ROOT ROUTE (IMPORTANT FIX)
//
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'app-backend-tt',
    message: 'Backend running. Use /api/* endpoints.',
    cats: 'still loving them'
  });
});

//
// API ROUTES
//

app.get('/api/state', (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const state = db.prepare(
      'SELECT * FROM game_state WHERE user_id = ?'
    ).get(userId);

    if (!state) return res.status(404).json({ error: 'State not found' });

    res.json({
      stats: JSON.parse(state.stats),
      tasks: JSON.parse(state.tasks),
      items: JSON.parse(state.items),
      props: JSON.parse(state.props),
      custom: JSON.parse(state.custom),
      day: state.day,
      collapsed: JSON.parse(state.collapsed)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

app.patch('/api/stats/:statName', (req, res) => {
  const { statName } = req.params
  const { delta } = req.body

  if (!statName || typeof delta !== 'number') {
    return res.status(400).json({ error: 'Invalid request' })
  }

  try {
    const row = db.prepare('SELECT data FROM states WHERE id = ?').get('global')

    if (!row) {
      return res.status(404).json({ error: 'State not found' })
    }

    const state = JSON.parse(row.data)

    if (!(statName in state.stats)) {
      return res.status(400).json({ error: 'Invalid stat' })
    }

    state.stats[statName] += delta

    db.prepare('UPDATE states SET data = ? WHERE id = ?')
      .run(JSON.stringify(state), 'global')

    res.json({ stats: state.stats })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update stat' })
  }
})

app.post('/api/state', (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const { stats, tasks, items, props, custom, day, collapsed } = req.body;
    
    console.log('💾 Saving state for user:', userId);
    console.log('📊 Stats:', stats);
    
    // Check if user exists
    const existing = db.prepare('SELECT id FROM game_state WHERE user_id = ?').get(userId);
    
    if (existing) {
      console.log('🔄 Updating existing state, ID:', existing.id);
      // Update existing state
      db.prepare(`
        UPDATE game_state 
        SET stats = ?, tasks = ?, items = ?, props = ?, custom = ?, day = ?, collapsed = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(
        JSON.stringify(stats),
        JSON.stringify(tasks),
        JSON.stringify(items),
        JSON.stringify(props),
        JSON.stringify(custom),
        day,
        JSON.stringify(collapsed),
        userId
      );
      console.log('✅ State updated successfully');
    } else {
      console.log('➕ Inserting new state');
      // Insert new state
      db.prepare(`
        INSERT INTO game_state (user_id, stats, tasks, items, props, custom, day, collapsed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        JSON.stringify(stats),
        JSON.stringify(tasks),
        JSON.stringify(items),
        JSON.stringify(props),
        JSON.stringify(custom),
        day,
        JSON.stringify(collapsed)
      );
      console.log('✅ State inserted successfully');
    }
    
    res.json({ success: true, message: 'State saved successfully' });
  } catch (error) {
    console.error('❌ ERROR saving state:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Failed to save state',
      details: error.message  // Send error to frontend too
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
