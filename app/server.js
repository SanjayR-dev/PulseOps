const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const BUILD_NUMBER = process.env.BUILD_NUMBER || 'local';

// Root endpoint: displays project identity and current build number
app.get('/', (req, res) => {
  res.status(200).send(`DevOps mini project: CI/CD with Jenkins and Docker (build #${BUILD_NUMBER})`);
});

// Health check endpoint for Docker HEALTHCHECK and Jenkins verification
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Only start the server if this file is run directly (allows clean testing with supertest)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PulseOps app listening on port ${PORT} (build #${BUILD_NUMBER})`);
  });
}

module.exports = app;
