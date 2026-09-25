const express = require('express');
const User = require('../models/user');

const router = express.Router();

router.get('/me', (req, res) => res.json(req.user));

router.patch('/me', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : undefined;
  if (name === '') return res.status(400).json({ error: 'name must not be empty' });
  res.json(User.updateProfile(req.user.id, { name }));
});

module.exports = router;
