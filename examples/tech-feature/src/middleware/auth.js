// Demo authentication: the user id arrives in the `x-user-id` header, set by the
// front end. Replace with a real session before going live.
const User = require('../models/user');

module.exports = function requireUser(req, res, next) {
  const id = Number(req.get('x-user-id'));
  const user = Number.isInteger(id) ? User.findById(id) : undefined;
  if (!user) return res.status(401).json({ error: 'not signed in' });
  req.user = user;
  next();
};
