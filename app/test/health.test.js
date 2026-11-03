const request = require('supertest');
const app = require('../server');

describe('PulseOps App Endpoints', () => {
  describe('GET /health', () => {
    it('should return HTTP 200 and JSON status ok', async () => {
      const response = await request(app).get('/health');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /', () => {
    it('should return HTTP 200 and project description with build identifier', async () => {
      const response = await request(app).get('/');
      expect(response.statusCode).toBe(200);
      expect(response.text).toContain('DevOps mini project: CI/CD with Jenkins and Docker (build #');
    });
  });
});
