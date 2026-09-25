// Configuration read once at startup, from the environment.
const path = require('node:path');

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  port: Number(process.env.PORT ?? 3000),
  appUrl: required('APP_URL', 'http://localhost:3000'),
  dbPath: path.resolve(process.env.DB_PATH ?? './data/tasklet.db'),
  // No default in production: a missing secret must prevent startup.
  sessionSecret: required('SESSION_SECRET', isProduction ? undefined : 'dev-secret'),
};
