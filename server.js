const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' folder

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

// Check if default user exists, if not create it
const existingState = db.prepare('SELECT * FROM game_state WHERE user_id = ?').get('default');
if (!existingState) {
  const initialStats = JSON.stringify({ trust: 0, rupees: 0, hearts: 3, maxHearts: 5, xp: 0, level: 1, ticksToday: 0 });
  const emptyArray = JSON.stringify([]);
  const emptyObject = JSON.stringify({});
  
  db.prepare(`
    INSERT INTO game_state (user_id, stats, tasks, items, props, custom, day, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('default', initialStats, emptyArray, emptyArray, emptyArray, emptyArray, '', emptyObject);
}

// API Routes

// Get game state
app.get('/api/state', (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const state = db.prepare('SELECT * FROM game_state WHERE user_id = ?').get(userId);
    
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    res.json({
      stats: JSON.parse(state.stats),
      tasks: JSON.parse(state.tasks),
      items: JSON.parse(state.items),
      props: JSON.parse(state.props),
      custom: JSON.parse(state.custom),
      day: state.day,
      collapsed: JSON.parse(state.collapsed)
    });
  } catch (error) {
    console.error('Error fetching state:', error);
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

// Save game state
app.post('/api/state', (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const { stats, tasks, items, props, custom, day, collapsed } = req.body;
    
    // Check if user exists
    const existing = db.prepare('SELECT id FROM game_state WHERE user_id = ?').get(userId);
    
    if (existing) {
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
    } else {
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
    }
    
    res.json({ success: true, message: 'State saved successfully' });
  } catch (error) {
    console.error('Error saving state:', error);
    res.status(500).json({ error: 'Failed to save state' });
  }
});

// Get stats only (for quick checks)
app.get('/api/stats', (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const state = db.prepare('SELECT stats FROM game_state WHERE user_id = ?').get(userId);
    
    if (!state) {
      return res.status(404).json({ error: 'Stats not found' });
    }
    
    res.json(JSON.parse(state.stats));
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Update specific stat (for stats editor)
app.patch('/api/stats/:statName', (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const statName = req.params.statName;
    const { value, delta } = req.body;
    
    // Get current state
    const state = db.prepare('SELECT stats FROM game_state WHERE user_id = ?').get(userId);
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    const stats = JSON.parse(state.stats);
    
    // Update stat - either absolute value or delta
    if (value !== undefined) {
      stats[statName] = value;
    } else if (delta !== undefined) {
      stats[statName] = (stats[statName] || 0) + delta;
    }
    
    // Prevent negative values for certain stats
    if (['hearts', 'rupees', 'trust', 'xp', 'level'].includes(statName)) {
      if (statName === 'level') {
        stats[statName] = Math.max(1, stats[statName]);
      } else if (statName === 'hearts') {
        stats[statName] = Math.max(0, Math.min(stats.maxHearts || 5, stats[statName]));
        // Don't change maxHearts - keep it unchanged
      } else {
        stats[statName] = Math.max(0, stats[statName]);
      }
    }
    
    // Save back to database
    db.prepare('UPDATE game_state SET stats = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(JSON.stringify(stats), userId);
    
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error updating stat:', error);
    res.status(500).json({ error: 'Failed to update stat' });
  }
});

// Custom Tasks Management

// Get custom tasks
app.get('/api/custom-tasks', (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const state = db.prepare('SELECT custom FROM game_state WHERE user_id = ?').get(userId);
    
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    res.json(JSON.parse(state.custom));
  } catch (error) {
    console.error('Error fetching custom tasks:', error);
    res.status(500).json({ error: 'Failed to fetch custom tasks' });
  }
});

// Add custom task
app.post('/api/custom-tasks', (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const newTask = req.body.task;
    
    // Get current state
    const state = db.prepare('SELECT custom FROM game_state WHERE user_id = ?').get(userId);
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    const customTasks = JSON.parse(state.custom);
    
    // Add new task with generated ID if not provided
    if (!newTask.id) {
      newTask.id = 'custom_' + Date.now();
    }
    
    customTasks.push(newTask);
    
    // Save back to database
    db.prepare('UPDATE game_state SET custom = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(JSON.stringify(customTasks), userId);
    
    res.json({ success: true, task: newTask, customTasks });
  } catch (error) {
    console.error('Error adding custom task:', error);
    res.status(500).json({ error: 'Failed to add custom task' });
  }
});

// Update custom task
app.patch('/api/custom-tasks/:taskId', (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const taskId = req.params.taskId;
    const updates = req.body.updates;
    
    // Get current state
    const state = db.prepare('SELECT custom FROM game_state WHERE user_id = ?').get(userId);
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    let customTasks = JSON.parse(state.custom);
    
    // Find and update task
    customTasks = customTasks.map(task => 
      task.id === taskId ? { ...task, ...updates } : task
    );
    
    // Save back to database
    db.prepare('UPDATE game_state SET custom = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(JSON.stringify(customTasks), userId);
    
    res.json({ success: true, customTasks });
  } catch (error) {
    console.error('Error updating custom task:', error);
    res.status(500).json({ error: 'Failed to update custom task' });
  }
});

// Delete custom task
app.delete('/api/custom-tasks/:taskId', (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const taskId = req.params.taskId;
    
    // Get current state
    const state = db.prepare('SELECT custom FROM game_state WHERE user_id = ?').get(userId);
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }
    
    let customTasks = JSON.parse(state.custom);
    
    // Remove task
    customTasks = customTasks.filter(task => task.id !== taskId);
    
    // Save back to database
    db.prepare('UPDATE game_state SET custom = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(JSON.stringify(customTasks), userId);
    
    res.json({ success: true, customTasks });
  } catch (error) {
    console.error('Error deleting custom task:', error);
    res.status(500).json({ error: 'Failed to delete custom task' });
  }
});

// Backup endpoint (optional)
app.get('/api/backup', (req, res) => {
  try {
    const allStates = db.prepare('SELECT * FROM game_state').all();
    const backup = allStates.map(state => ({
      user_id: state.user_id,
      stats: JSON.parse(state.stats),
      tasks: JSON.parse(state.tasks),
      items: JSON.parse(state.items),
      props: JSON.parse(state.props),
      custom: JSON.parse(state.custom),
      day: state.day,
      collapsed: JSON.parse(state.collapsed),
      updated_at: state.updated_at
    }));
    
    res.json(backup);
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   RPG Task System Server                  ║
║   Running on http://localhost:${PORT}      ║
║                                           ║
║   API Endpoints:                          ║
║   GET  /api/state   - Get game state      ║
║   POST /api/state   - Save game state     ║
║   GET  /api/stats   - Get stats only      ║
║   GET  /api/backup  - Backup all data     ║
║   GET  /api/health  - Health check        ║
╚═══════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  console.log('\nDatabase closed. Server shutting down...');
  process.exit(0);
});