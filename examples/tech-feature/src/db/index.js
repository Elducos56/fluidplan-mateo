const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');

const inTests = process.env.NODE_ENV === 'test';
if (!inTests) fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(inTests ? ':memory:' : config.dbPath);
// WAL: API reads are not blocked while a write is in progress.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
