const tls = require('tls');
const { URL } = require('url');

// In-memory store for monitored services
let services = [];
let checkerInterval = null;

// Helper: generate unique IDs
function generateId() {
  return 'svc_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

// Seed initial default service: Self health check
function seedDefaults() {
  if (services.length === 0) {
    services.push({
      id: 'svc_self_health',
      name: 'Self Health Check',
      url: 'http://127.0.0.1:3000/health',
      expectedKeyword: 'status',
      maxLatencyMs: 1000,
      status: 'PENDING',
      previousStatus: 'PENDING',
      responseTimeMs: 0,
      lastChecked: null,
      ssl: {
        checked: false,
        valid: null,
        daysRemaining: null,
        issuer: null,
        expiryDate: null,
        error: null
      },
      history: []
    });
  }
}

// Check SSL certificate details for HTTPS targets
function checkSslCertificate(urlString) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(urlString);
      if (parsedUrl.protocol !== 'https:') {
        return resolve({
          checked: false,
          valid: null,
          daysRemaining: null,
          issuer: null,
          expiryDate: null,
          error: null
        });
      }

      const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 443;
      const socket = tls.connect(
        {
          host: parsedUrl.hostname,
          port: port,
          servername: parsedUrl.hostname,
          timeout: 4000,
          rejectUnauthorized: false // examine cert even if self-signed
        },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();

          if (cert && cert.valid_to) {
            const expiry = new Date(cert.valid_to);
            const now = new Date();
            const daysRemaining = Math.round((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const issuer = cert.issuer ? (cert.issuer.O || cert.issuer.CN || 'Unknown') : 'Unknown';

            resolve({
              checked: true,
              valid: daysRemaining > 0,
              daysRemaining: daysRemaining,
              issuer: issuer,
              expiryDate: expiry.toISOString(),
              error: null
            });
          } else {
            resolve({
              checked: true,
              valid: false,
              daysRemaining: null,
              issuer: null,
              expiryDate: null,
              error: 'No certificate returned'
            });
          }
        }
      );

      socket.on('error', (err) => {
        resolve({
          checked: true,
          valid: false,
          daysRemaining: null,
          issuer: null,
          expiryDate: null,
          error: err.message
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          checked: true,
          valid: false,
          daysRemaining: null,
          issuer: null,
          expiryDate: null,
          error: 'TLS connection timed out'
        });
      });
    } catch (err) {
      resolve({
        checked: false,
        valid: null,
        daysRemaining: null,
        issuer: null,
        expiryDate: null,
        error: err.message
      });
    }
  });
}

// Send webhook notification to Slack and Discord
async function sendWebhookAlert(messageText, title, colorHex, fields = []) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl || typeof webhookUrl !== 'string' || webhookUrl.trim() === '') {
    return; // Silently skip if webhook URL is not configured
  }

  // Decimal color codes for Discord: Red = 15158332, Amber = 15844367, Green = 3066993
  const colorDecimal = colorHex === 'red' ? 15158332 : (colorHex === 'amber' ? 15844367 : 3066993);

  const payload = {
    text: messageText, // Slack compatible
    content: messageText, // Discord compatible
    embeds: [
      {
        title: title || 'PulseOps Sentinel Notification',
        description: messageText,
        color: colorDecimal,
        fields: fields,
        timestamp: new Date().toISOString(),
        footer: {
          text: `PulseOps Sentinel • Build #${process.env.BUILD_NUMBER || 'local'}`
        }
      }
    ]
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    console.error(`[PulseOps Alert] Failed to send webhook alert: ${err.message}`);
  }
}

// Check an individual service target
async function checkService(service, customAlertSender = sendWebhookAlert) {
  const startTime = Date.now();
  let status = 'DOWN';
  let reason = 'Unknown error';
  let responseTimeMs = 0;

  let targetUrl = service.url;
  try {
    let res;
    try {
      res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
        headers: { 'User-Agent': 'PulseOps-Sentinel/1.0' }
      });
    } catch (fetchErr) {
      // IPv6/IPv4 fallback: if localhost failed with connection error, attempt 127.0.0.1
      if (targetUrl.includes('localhost')) {
        const fallbackUrl = targetUrl.replace('localhost', '127.0.0.1');
        res = await fetch(fallbackUrl, {
          signal: AbortSignal.timeout(5000),
          redirect: 'follow',
          headers: { 'User-Agent': 'PulseOps-Sentinel/1.0' }
        });
      } else {
        throw fetchErr;
      }
    }

    responseTimeMs = Date.now() - startTime;

    if (res.status >= 200 && res.status < 400) {
      status = 'UP';
      reason = `HTTP ${res.status}`;

      // Content Verification: check for expected keyword in response body
      if (service.expectedKeyword && service.expectedKeyword.trim() !== '') {
        try {
          const bodyText = await res.text();
          if (!bodyText.includes(service.expectedKeyword)) {
            status = 'DEGRADED';
            reason = `HTTP ${res.status} OK but missing expected keyword "${service.expectedKeyword}"`;
          }
        } catch (e) {
          status = 'DEGRADED';
          reason = `HTTP ${res.status} OK but failed to read body: ${e.message}`;
        }
      }

      // Latency SLA Check
      if (status === 'UP' && service.maxLatencyMs && responseTimeMs > service.maxLatencyMs) {
        status = 'DEGRADED';
        reason = `HTTP ${res.status} OK but latency ${responseTimeMs}ms exceeded threshold ${service.maxLatencyMs}ms`;
      }
    } else {
      status = 'DOWN';
      reason = `HTTP ${res.status}`;
    }
  } catch (err) {
    responseTimeMs = Date.now() - startTime;
    status = 'DOWN';
    reason = err.name === 'TimeoutError' ? 'Request timed out (5s limit)' : err.message;
  }

  // Check SSL Certificate if HTTPS
  const sslDetails = await checkSslCertificate(service.url);

  // Record history (keep last 20 checks)
  const nowIso = new Date().toISOString();
  const historyEntry = {
    time: nowIso,
    status: status,
    ms: responseTimeMs,
    reason: reason
  };

  service.history.push(historyEntry);
  if (service.history.length > 20) {
    service.history.shift();
  }

  service.responseTimeMs = responseTimeMs;
  service.lastChecked = nowIso;
  service.ssl = sslDetails;

  // State-change Alerting logic
  const oldStatus = service.status;
  service.status = status;

  if (oldStatus !== 'PENDING' && oldStatus !== status) {
    // Status has changed! Trigger alert
    if (status === 'DOWN') {
      const msg = `ALERT: ${service.name} is DOWN! (${service.url}) - ${reason}`;
      await customAlertSender(msg, `🚨 SERVICE DOWN: ${service.name}`, 'red', [
        { name: 'Target URL', value: service.url, inline: true },
        { name: 'Error', value: reason, inline: true },
        { name: 'Latency', value: `${responseTimeMs}ms`, inline: true }
      ]);
    } else if (status === 'DEGRADED') {
      const msg = `WARNING: ${service.name} is DEGRADED! (${service.url}) - ${reason}`;
      await customAlertSender(msg, `⚠️ SERVICE DEGRADED: ${service.name}`, 'amber', [
        { name: 'Target URL', value: service.url, inline: true },
        { name: 'Warning', value: reason, inline: true },
        { name: 'Latency', value: `${responseTimeMs}ms`, inline: true }
      ]);
    } else if (status === 'UP') {
      const msg = `RECOVERED: ${service.name} is back UP (${service.url}) [${responseTimeMs}ms]`;
      await customAlertSender(msg, `✅ SERVICE RECOVERED: ${service.name}`, 'green', [
        { name: 'Target URL', value: service.url, inline: true },
        { name: 'Status', value: reason, inline: true },
        { name: 'Response Time', value: `${responseTimeMs}ms`, inline: true }
      ]);
    }
  }

  // SSL Certificate Expiration Warning (if expiring in <= 14 days)
  if (sslDetails.checked && sslDetails.valid && sslDetails.daysRemaining !== null && sslDetails.daysRemaining <= 14 && !service.sslAlertSent) {
    const sslMsg = `SECURITY ALERT: ${service.name} SSL certificate expires in ${sslDetails.daysRemaining} days! (Issuer: ${sslDetails.issuer})`;
    await customAlertSender(sslMsg, `🔒 SSL CERTIFICATE EXPIRING: ${service.name}`, 'amber', [
      { name: 'Domain', value: service.url, inline: true },
      { name: 'Days Left', value: `${sslDetails.daysRemaining} days`, inline: true },
      { name: 'Issuer', value: sslDetails.issuer || 'Unknown', inline: true }
    ]);
    service.sslAlertSent = true;
  }

  return service;
}

// Check all services in the store
async function checkAllServices() {
  for (const svc of services) {
    await checkService(svc);
  }
}

// Start periodic checker loop
function startChecker(intervalSec = parseInt(process.env.CHECK_INTERVAL_SEC, 10) || 30) {
  if (checkerInterval) return;
  seedDefaults();
  // Run immediate first check
  checkAllServices().catch((err) => console.error('[PulseOps Checker Error]:', err));
  // Schedule ongoing checks
  checkerInterval = setInterval(() => {
    checkAllServices().catch((err) => console.error('[PulseOps Checker Error]:', err));
  }, intervalSec * 1000);
}

// Stop periodic checker loop (used for clean teardown and testing)
function stopChecker() {
  if (checkerInterval) {
    clearInterval(checkerInterval);
    checkerInterval = null;
  }
}

// Service CRUD operations
function getAllServices() {
  return services;
}

function getServiceById(id) {
  return services.find((s) => s.id === id);
}

function addService({ name, url, expectedKeyword, maxLatencyMs }) {
  const newService = {
    id: generateId(),
    name: name.trim(),
    url: url.trim(),
    expectedKeyword: expectedKeyword ? expectedKeyword.trim() : null,
    maxLatencyMs: maxLatencyMs ? parseInt(maxLatencyMs, 10) : null,
    status: 'PENDING',
    previousStatus: 'PENDING',
    responseTimeMs: 0,
    lastChecked: null,
    ssl: {
      checked: false,
      valid: null,
      daysRemaining: null,
      issuer: null,
      expiryDate: null,
      error: null
    },
    history: []
  };

  services.push(newService);
  return newService;
}

function deleteService(id) {
  const initialLength = services.length;
  services = services.filter((s) => s.id !== id);
  return services.length < initialLength;
}

function resetServices() {
  services = [];
  seedDefaults();
}

function getSummary() {
  const total = services.length;
  let up = 0;
  let degraded = 0;
  let down = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const s of services) {
    if (s.status === 'UP') up++;
    else if (s.status === 'DEGRADED') degraded++;
    else if (s.status === 'DOWN') down++;

    if (s.responseTimeMs > 0) {
      totalLatency += s.responseTimeMs;
      latencyCount++;
    }
  }

  const uptimePercent = total > 0 ? parseFloat((((up + degraded) / total) * 100).toFixed(1)) : 100.0;
  const avgLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;

  return {
    total,
    up,
    degraded,
    down,
    uptimePercent,
    avgLatencyMs
  };
}

module.exports = {
  services,
  generateId,
  seedDefaults,
  checkSslCertificate,
  sendWebhookAlert,
  checkService,
  checkAllServices,
  startChecker,
  stopChecker,
  getAllServices,
  getServiceById,
  addService,
  deleteService,
  resetServices,
  getSummary
};
