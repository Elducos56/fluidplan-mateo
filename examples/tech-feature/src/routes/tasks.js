const express = require('express');
const Task = require('../models/task');

const router = express.Router();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseBody(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : undefined;
  const dueDate = body.dueDate ?? undefined;
  if (dueDate != null && !DATE.test(dueDate)) return { error: 'dueDate must be in YYYY-MM-DD format' };
  return { title, dueDate };
}

router.get('/', (req, res) => res.json(Task.listByUser(req.user.id)));

router.post('/', (req, res) => {
  const { title, dueDate, error } = parseBody(req.body);
  if (error || !title) return res.status(400).json({ error: error ?? 'title is required' });
  res.status(201).json(Task.create(req.user.id, { title, dueDate }));
});

router.patch('/:id', (req, res) => {
  const { title, dueDate, error } = parseBody(req.body);
  if (error) return res.status(400).json({ error });
  const task = Task.update(req.user.id, Number(req.params.id), { title, dueDate });
  if (!task) return res.status(404).end();
  if (typeof req.body.done === 'boolean') return res.json(Task.markDone(req.user.id, task.id, req.body.done));
  res.json(task);
});

router.delete('/:id', (req, res) => {
  res.status(Task.remove(req.user.id, Number(req.params.id)) ? 204 : 404).end();
});

module.exports = router;
