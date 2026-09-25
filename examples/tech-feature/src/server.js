const path = require('node:path');
const express = require('express');
const config = require('./config');
const migrate = require('./db/migrate');
const requireUser = require('./middleware/auth');
const tasks = require('./routes/tasks');
const users = require('./routes/users');

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/tasks', requireUser, tasks);
app.use('/api', requireUser, users);

// eslint-disable-next-line no-unused-vars -- Express recognizes an error handler by its 4 parameters.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

// Run directly: migrate, then listen. Imported (tests): only export the app.
if (require.main === module) {
  migrate();
  app.listen(config.port, () => console.log(`Tasklet running at ${config.appUrl}`));
}

module.exports = app;
