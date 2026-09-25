CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  email       TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  due_date    TEXT,                          -- 'YYYY-MM-DD', no time or time zone
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A user's list sorts open tasks by due date.
CREATE INDEX tasks_user_due ON tasks (user_id, due_date) WHERE done = 0;
