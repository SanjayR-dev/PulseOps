const express = require('express');
const path = require('path');
const checker = require('./checker');

const app = express();
const PORT = process.env.PORT || 3000;
const BUILD_NUMBER = process.env.BUILD_NUMBER || 'local';

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mock target state for testing and live outage demos
let mockHealthy = true;

// Health check endpoint for Docker HEALTHCHECK & Jenkins verification
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// GET /api/services: List all monitored services
app.get('/api/services', (req, res) => {
  res.status(200).json(checker.getAllServices());
});

// POST /api/services: Add a new service target
app.post('/api/services', (req, res) => {
  const { name, url, expectedKeyword, maxLatencyMs } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Service name is required' });
  }

  if (!url || typeof url !== 'string' || url.trim() === '') {
    return res.status(400).json({ error: 'Service URL is required' });
  }

  // Validate URL protocol (strictly http:// or https://)
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'URL must use http:// or https:// protocol' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const newService = checker.addService({
    name,
    url,
    expectedKeyword,
    maxLatencyMs
  });

  // Run initial check asynchronously so the user immediately sees live metrics (skip in automated tests)
  if (process.env.NODE_ENV !== 'test') {
    checker.checkService(newService).catch((e) => console.error('[Initial Check Error]:', e));
  }

  res.status(201).json(newService);
});

// DELETE /api/services/:id: Remove a service
app.delete('/api/services/:id', (req, res) => {
  const deleted = checker.deleteService(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Service not found' });
  }
  res.status(200).json({ success: true, message: 'Service removed successfully' });
});

// POST /api/services/:id/check: Trigger an immediate check for a specific service
app.post('/api/services/:id/check', async (req, res) => {
  const service = checker.getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }

  const updated = await checker.checkService(service);
  res.status(200).json(updated);
});

// GET /api/summary: High-level metrics for dashboard cards
app.get('/api/summary', (req, res) => {
  const summary = checker.getSummary();
  res.status(200).json({
    ...summary,
    buildNumber: BUILD_NUMBER
  });
});

// Demo Helper: GET /api/mock/target - Mock endpoint to simulate live outages in demos
app.get('/api/mock/target', (req, res) => {
  if (mockHealthy) {
    res.status(200).json({ status: 'ok', message: 'Mock service is healthy and operational' });
  } else {
    res.status(500).json({ status: 'error', message: 'Simulated 500 Internal Server Error' });
  }
});

// Demo Helper: POST /api/mock/toggle - Flip mock service health state
app.post('/api/mock/toggle', (req, res) => {
  mockHealthy = !mockHealthy;
  res.status(200).json({
    mockHealthy,
    message: `Mock service is now ${mockHealthy ? 'HEALTHY (HTTP 200)' : 'UNHEALTHY (HTTP 500)'}`
  });
});

// Start listening if run directly
if (require.main === module) {
  checker.seedDefaults();
  checker.startChecker();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PulseOps Sentinel running on port ${PORT} (Build #${BUILD_NUMBER})`);
  });
}

module.exports = app;
