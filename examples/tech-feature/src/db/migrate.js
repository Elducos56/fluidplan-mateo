// Applies the files in migrations/ that haven't been applied yet, in alphabetical order.
// A gap in the numbering is fine: only the order matters.
const fs = require('node:fs');
const path = require('node:path');
const db = require('./index');

const dir = path.join(__dirname, 'migrations');

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all());
  const pending = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();

  for (const name of pending) {
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime('now'))").run(name);
    })();
    console.log(`applied migration: ${name}`);
  }
  return pending;
}

if (require.main === module) migrate();

module.exports = migrate;
