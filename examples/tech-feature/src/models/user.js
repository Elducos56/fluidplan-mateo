const db = require('../db');

function findById(id) {
  return db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id);
}

function findByEmail(email) {
  return db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email.toLowerCase());
}

function updateProfile(id, { name }) {
  db.prepare('UPDATE users SET name = COALESCE(?, name) WHERE id = ?').run(name ?? null, id);
  return findById(id);
}

module.exports = { findById, findByEmail, updateProfile };
