const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  }
  console.log('✅ Connected to PostgreSQL');
  release();
});

// Root route
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'rpg-task-system',
    message: 'Backend running. Use /api/* endpoints.'
  });
});

// Get game state
app.get('/api/state', async (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const result = await pool.query(
      'SELECT * FROM game_state WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    const state = result.rows[0];
    res.json({
      stats: state.stats,
      tasks: state.tasks,
      items: state.items,
      props: state.props,
      custom: state.custom,
      day: state.day,
      collapsed: state.collapsed,
      world: state.world || {}
    });
  } catch (err) {
    console.error('Error fetching state:', err);
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

// Save game state
app.post('/api/state', async (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const { stats, tasks, items, props, custom, day, collapsed, world } = req.body;

    console.log('💾 Saving state for user:', userId);

    // Check if user exists
    const existing = await pool.query(
      'SELECT id FROM game_state WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      // Update
      await pool.query(`
        UPDATE game_state 
        SET stats = $1, tasks = $2, items = $3, props = $4, custom = $5, 
            day = $6, collapsed = $7, world = $8, updated_at = NOW()
        WHERE user_id = $9
      `, [stats, tasks, items, props, custom, day, collapsed, world || {}, userId]);
      console.log('✅ State updated');
    } else {
      // Insert
      await pool.query(`
        INSERT INTO game_state (user_id, stats, tasks, items, props, custom, day, collapsed, world)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [userId, stats, tasks, items, props, custom, day, collapsed, world || {}]);
      console.log('✅ State inserted');
    }

    res.json({ success: true, message: 'State saved' });
  } catch (err) {
    console.error('❌ Error saving state:', err);
    res.status(500).json({ error: 'Failed to save state', details: err.message });
  }
});

// Update specific stat
app.patch('/api/stats/:statName', async (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const { statName } = req.params;
    const { value, delta } = req.body;

    const result = await pool.query(
      'SELECT stats FROM game_state WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    const stats = result.rows[0].stats;

    // Update stat
    if (value !== undefined) {
      stats[statName] = value;
    } else if (delta !== undefined) {
      stats[statName] = (stats[statName] || 0) + delta;
    }

    // Validate
    if (statName === 'level') {
      stats[statName] = Math.max(1, stats[statName]);
    } else if (statName === 'hearts') {
      stats[statName] = Math.max(0, Math.min(stats.maxHearts || 5, stats[statName]));
    } else if (['rupees', 'trust', 'xp'].includes(statName)) {
      stats[statName] = Math.max(0, stats[statName]);
    }

    await pool.query(
      'UPDATE game_state SET stats = $1, updated_at = NOW() WHERE user_id = $2',
      [stats, userId]
    );

    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error updating stat:', err);
    res.status(500).json({ error: 'Failed to update stat' });
  }
});

// Get custom tasks
app.get('/api/custom-tasks', async (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const result = await pool.query(
      'SELECT custom FROM game_state WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    res.json(result.rows[0].custom);
  } catch (err) {
    console.error('Error fetching custom tasks:', err);
    res.status(500).json({ error: 'Failed to fetch custom tasks' });
  }
});

// Add custom task
app.post('/api/custom-tasks', async (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const newTask = req.body.task;

    const result = await pool.query(
      'SELECT custom FROM game_state WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    const customTasks = result.rows[0].custom;

    if (!newTask.id) {
      newTask.id = 'custom_' + Date.now();
    }

    customTasks.push(newTask);

    await pool.query(
      'UPDATE game_state SET custom = $1, updated_at = NOW() WHERE user_id = $2',
      [customTasks, userId]
    );

    res.json({ success: true, task: newTask, customTasks });
  } catch (err) {
    console.error('Error adding custom task:', err);
    res.status(500).json({ error: 'Failed to add custom task' });
  }
});

// Update custom task
app.patch('/api/custom-tasks/:taskId', async (req, res) => {
  try {
    const userId = req.body.user_id || 'default';
    const { taskId } = req.params;
    const updates = req.body.updates;

    const result = await pool.query(
      'SELECT custom FROM game_state WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    let customTasks = result.rows[0].custom;
    customTasks = customTasks.map(task =>
      task.id === taskId ? { ...task, ...updates } : task
    );

    await pool.query(
      'UPDATE game_state SET custom = $1, updated_at = NOW() WHERE user_id = $2',
      [customTasks, userId]
    );

    res.json({ success: true, customTasks });
  } catch (err) {
    console.error('Error updating custom task:', err);
    res.status(500).json({ error: 'Failed to update custom task' });
  }
});

// Delete custom task
app.delete('/api/custom-tasks/:taskId', async (req, res) => {
  try {
    const userId = req.query.user_id || 'default';
    const { taskId } = req.params;

    const result = await pool.query(
      'SELECT custom FROM game_state WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'State not found' });
    }

    let customTasks = result.rows[0].custom;
    customTasks = customTasks.filter(task => task.id !== taskId);

    await pool.query(
      'UPDATE game_state SET custom = $1, updated_at = NOW() WHERE user_id = $2',
      [customTasks, userId]
    );

    res.json({ success: true, customTasks });
  } catch (err) {
    console.error('Error deleting custom task:', err);
    res.status(500).json({ error: 'Failed to delete custom task' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await pool.end();
  console.log('👋 Database connection closed');
  process.exit(0);
});