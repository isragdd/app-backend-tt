const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const db = new Database('rpg_tasks.db');

// Create tables if they don't exist
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
    message: 'Backend running. Use /api/* endpoints.'
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

app.post('/api/state', (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const { stats, tasks, items, props, custom, day, collapsed } = req.body;

    db.prepare(`
      INSERT INTO game_state (user_id, stats, tasks, items, props, custom, day, collapsed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        stats=excluded.stats,
        tasks=excluded.tasks,
        items=excluded.items,
        props=excluded.props,
        custom=excluded.custom,
        day=excluded.day,
        collapsed=excluded.collapsed,
        updated_at=CURRENT_TIMESTAMP
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

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save state' });
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
