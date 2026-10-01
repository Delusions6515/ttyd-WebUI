const express = require('express');

function sendError(res, error) {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  res.status(status).json({ error: error.message || 'Session operation failed' });
}

module.exports = function createSessionsRouter(sessionManager) {
  const router = express.Router();

  router.get('/shells', (_req, res) => {
    res.json({ shells: sessionManager.getShells() });
  });

  router.get('/', (_req, res) => {
    res.json({ sessions: sessionManager.list() });
  });

  router.post('/', async (req, res) => {
    try {
      const { name, shell } = req.body || {};
      const session = await sessionManager.create(name, shell);
      res.status(201).json(session);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:name/stop', async (req, res) => {
    try {
      res.json(await sessionManager.stop(req.params.name));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:name/restart', async (req, res) => {
    try {
      res.json(await sessionManager.restart(req.params.name));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/:name', async (req, res) => {
    try {
      res.json(await sessionManager.remove(req.params.name));
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
};
