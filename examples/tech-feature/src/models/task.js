const db = require('../db');

const columns = 'id, user_id AS userId, title, due_date AS dueDate, done, done_at AS doneAt';

function listByUser(userId) {
  // Open tasks first, then by due date; tasks without a due date last.
  return db
    .prepare(`SELECT ${columns} FROM tasks WHERE user_id = ? ORDER BY done, due_date IS NULL, due_date`)
    .all(userId);
}

function findById(userId, id) {
  return db.prepare(`SELECT ${columns} FROM tasks WHERE user_id = ? AND id = ?`).get(userId, id);
}

function create(userId, { title, dueDate = null }) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO tasks (user_id, title, due_date) VALUES (?, ?, ?)')
    .run(userId, title, dueDate);
  return findById(userId, lastInsertRowid);
}

function update(userId, id, { title, dueDate }) {
  db.prepare('UPDATE tasks SET title = COALESCE(?, title), due_date = COALESCE(?, due_date) WHERE user_id = ? AND id = ?')
    .run(title ?? null, dueDate ?? null, userId, id);
  return findById(userId, id);
}

function markDone(userId, id, done = true) {
  db.prepare("UPDATE tasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now') END WHERE user_id = ? AND id = ?")
    .run(done ? 1 : 0, done ? 1 : 0, userId, id);
  return findById(userId, id);
}

function remove(userId, id) {
  return db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?').run(userId, id).changes === 1;
}

module.exports = { listByUser, findById, create, update, markDone, remove };
