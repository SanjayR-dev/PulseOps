const request = require('supertest');
const app = require('../server');
const checker = require('../checker');

describe('PulseOps Sentinel API Tests', () => {
  beforeEach(() => {
    // Reset services store before each test
    checker.resetServices();
  });

  afterAll(() => {
    // Ensure background intervals are halted
    checker.stopChecker();
  });

  describe('GET /health', () => {
    it('should return HTTP 200 with { status: "ok" }', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /api/services', () => {
    it('should create a new service target with valid URL', async () => {
      const res = await request(app)
        .post('/api/services')
        .send({
          name: 'Google Production',
          url: 'https://www.google.com',
          expectedKeyword: 'Google',
          maxLatencyMs: 2000
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Google Production');
      expect(res.body.url).toBe('https://www.google.com');
      expect(res.body.expectedKeyword).toBe('Google');
      expect(res.body.maxLatencyMs).toBe(2000);
      expect(res.body.id).toBeDefined();
    });

    it('should return 400 for invalid or unsupported protocol URL', async () => {
      const res = await request(app)
        .post('/api/services')
        .send({
          name: 'Invalid Target',
          url: 'ftp://files.example.com'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/http:\/\/ or https:\/\//i);
    });

    it('should return 400 for missing name or URL', async () => {
      const res = await request(app)
        .post('/api/services')
        .send({ name: 'Only Name' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/services/:id', () => {
    it('should delete an existing service and return 200', async () => {
      const service = checker.addService({
        name: 'Temporary Service',
        url: 'http://localhost:3000/health'
      });

      const res = await request(app).delete(`/api/services/${service.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const checkGone = checker.getServiceById(service.id);
      expect(checkGone).toBeUndefined();
    });

    it('should return 404 when deleting a non-existent service ID', async () => {
      const res = await request(app).delete('/api/services/non_existent_id');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Service not found');
    });
  });

  describe('GET /api/summary', () => {
    it('should return accurate aggregated summary metrics', async () => {
      const res = await request(app).get('/api/summary');
      expect(res.status).toBe(200);
      expect(res.body.total).toBeDefined();
      expect(res.body.up).toBeDefined();
      expect(res.body.down).toBeDefined();
      expect(res.body.uptimePercent).toBeDefined();
      expect(res.body.buildNumber).toBeDefined();
    });
  });

  describe('Alerting Logic & State Transitions', () => {
    it('should only fire alerts on state transitions (UP -> DOWN and DOWN -> UP)', async () => {
      const mockAlert = jest.fn();

      const testService = {
        id: 'test_alert_svc',
        name: 'Alert Test Service',
        url: 'http://localhost:3000/mock/test',
        status: 'UP',
        previousStatus: 'UP',
        history: []
      };

      // Mock global fetch to simulate a failing server (HTTP 500)
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        status: 500,
        text: async () => 'Internal Server Error'
      });

      try {
        // First check: UP -> DOWN transition (Alert SHOULD be dispatched)
        await checker.checkService(testService, mockAlert);
        expect(testService.status).toBe('DOWN');
        expect(mockAlert).toHaveBeenCalledTimes(1);

        // Second check: DOWN -> DOWN (no transition; Alert should NOT be called again)
        await checker.checkService(testService, mockAlert);
        expect(testService.status).toBe('DOWN');
        expect(mockAlert).toHaveBeenCalledTimes(1);

        // Third check: Simulate recovery (HTTP 200) -> DOWN -> UP transition (Recovery Alert SHOULD be dispatched)
        global.fetch = jest.fn().mockResolvedValue({
          status: 200,
          text: async () => '{"status":"ok"}'
        });

        await checker.checkService(testService, mockAlert);
        expect(testService.status).toBe('UP');
        expect(mockAlert).toHaveBeenCalledTimes(2);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should mark service as DEGRADED when expected keyword is missing in HTTP 200 response', async () => {
      const mockAlert = jest.fn();

      const testService = {
        id: 'test_keyword_svc',
        name: 'Keyword Test Service',
        url: 'http://localhost:3000/mock/content',
        expectedKeyword: 'PAYMENT_SUCCESS',
        status: 'UP',
        history: []
      };

      const originalFetch = global.fetch;
      // Server returns HTTP 200 OK, but silent failure in body
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: async () => '{"error": "Database disconnected"}'
      });

      try {
        await checker.checkService(testService, mockAlert);
        expect(testService.status).toBe('DEGRADED');
        expect(mockAlert).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
