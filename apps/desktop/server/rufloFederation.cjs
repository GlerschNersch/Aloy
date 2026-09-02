// RUFLO FEDERATION ENGINE (Harvested from ruvnet/ruflo - ruflo-federation)
// Implements cross-machine agent federation with zero-trust HMAC signatures,
// 4-tier peer trust model, outbound PII/path scrubbing pipeline, and circuit breakers.

const crypto = require('crypto');
const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

const TRUST_LEVELS = {
  UNTRUSTED: 0,
  VERIFIED: 1,
  TRUSTED: 2,
  PRIVILEGED: 3
};

const DEFAULT_CIRCUIT_BREAKER = {
  maxHops: 4,
  maxPayloadBytes: 1024 * 512, // 512KB
  timeoutMs: 15000
};

class RufloFederationEngine {
  constructor(options = {}) {
    this.store = options.store || defaultStore;
    this.nodeId = options.nodeId || process.env.ALOY_NODE_ID || `aloy-node-${crypto.randomBytes(4).toString('hex')}`;
    this.nodeSecret = options.nodeSecret || process.env.ALOY_FEDERATION_SECRET || 'aloy-federation-shared-key-2026';
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  /**
   * Retrieves all registered federation peers.
   */
  getPeers() {
    const data = this.store.load();
    return data.federationPeers || [];
  }

  /**
   * Registers or updates a federation peer node.
   */
  registerPeer({ peerId, name, endpoint, trustLevel = TRUST_LEVELS.VERIFIED, secretKey = null, tags = [] }) {
    if (!peerId || !endpoint) {
      throw new Error('peerId and endpoint are required to register a federation peer.');
    }

    const peers = this.getPeers();
    const existingIdx = peers.findIndex(p => p.peerId === peerId);

    const peerRecord = {
      peerId,
      name: name || peerId,
      endpoint: endpoint.replace(/\/+$/, ''),
      trustLevel: Math.max(0, Math.min(3, trustLevel !== undefined && trustLevel !== null ? Number(trustLevel) : 1)),
      secretKey: secretKey || this.nodeSecret,
      tags: Array.isArray(tags) ? tags : [],
      registeredAt: existingIdx >= 0 ? peers[existingIdx].registeredAt : new Date().toISOString(),
      lastSeenAt: null,
      status: 'active'
    };

    if (existingIdx >= 0) {
      peers[existingIdx] = { ...peers[existingIdx], ...peerRecord };
    } else {
      peers.push(peerRecord);
    }

    this.store.save({ federationPeers: peers });
    logAuditEvent({ action: 'federation_register_peer', peerId, name: peerRecord.name, trustLevel: peerRecord.trustLevel });
    return peerRecord;
  }

  /**
   * Removes a federation peer by ID.
   */
  removePeer(peerId) {
    const peers = this.getPeers().filter(p => p.peerId !== peerId);
    this.store.save({ federationPeers: peers });
    logAuditEvent({ action: 'federation_remove_peer', peerId });
    return { success: true, remaining: peers.length };
  }

  /**
   * Generates a tamper-proof HMAC-SHA256 signature for a payload.
   */
  signPayload(payload, secret) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(serialized).digest('hex');
  }

  /**
   * Creates a signed federation message envelope.
   */
  createSignedEnvelope(messageType, payload, secret = this.nodeSecret, hops = 0) {
    const timestamp = Date.now();
    const body = {
      sourceNodeId: this.nodeId,
      messageType,
      payload,
      hops,
      timestamp
    };
    const signature = this.signPayload(body, secret);
    return { ...body, signature };
  }

  /**
   * Verifies an incoming signed federation message envelope.
   */
  verifyEnvelope(envelope, secret = this.nodeSecret, maxAgeMs = 300000) {
    if (!envelope || !envelope.signature || !envelope.timestamp) {
      return { valid: false, reason: 'Malformed envelope structure' };
    }

    // Replay attack prevention
    const age = Math.abs(Date.now() - envelope.timestamp);
    if (age > maxAgeMs) {
      return { valid: false, reason: `Envelope timestamp expired or clock drift exceeded (${age}ms)` };
    }

    const { signature, ...body } = envelope;
    const expectedSig = this.signPayload(body, secret);

    if (signature !== expectedSig) {
      return { valid: false, reason: 'Invalid HMAC signature' };
    }

    return { valid: true, body };
  }

  /**
   * Outbound PII and sensitive path redaction pipeline.
   * Strips personal user directories and internal tokens before network transit.
   */
  scrubOutboundPayload(payload) {
    let raw = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Redact hardcoded Windows / Linux user profiles (handling JSON escaped and unescaped backslashes)
    raw = raw.replace(/[A-Za-z]:\\\\(?:Users|users)\\\\[^"\\\\\/]+/gi, '%USERPROFILE%');
    raw = raw.replace(/[A-Za-z]:\\(?:Users|users)\\[^"\\\\\/]+/gi, '%USERPROFILE%');
    raw = raw.replace(/\/home\/[^\/]+/g, '~');

    // Redact common bearer / api token patterns
    raw = raw.replace(/Bearer\s+[A-Za-z0-9_\-\.]{15,}/gi, 'Bearer [REDACTED_TOKEN]');
    raw = raw.replace(/ghp_[A-Za-z0-9]{36}/g, 'ghp_[REDACTED]');
    raw = raw.replace(/github_pat_[A-Za-z0-9_]{82}/g, 'github_pat_[REDACTED]');

    return typeof payload === 'string' ? raw : JSON.parse(raw);
  }

  /**
   * Dispatches an agent task to a remote federation peer with circuit-breaker protection.
   */
  async dispatchTask(peerId, taskData, options = {}) {
    const peers = this.getPeers();
    const peer = peers.find(p => p.peerId === peerId);

    if (!peer) {
      throw new Error(`Federation peer '${peerId}' not found.`);
    }

    const hops = Number(options.hops || 0);
    const maxHops = options.maxHops || DEFAULT_CIRCUIT_BREAKER.maxHops;

    if (hops >= maxHops) {
      throw new Error(`Circuit breaker triggered: HOP_LIMIT_EXCEEDED (Current: ${hops}, Max: ${maxHops})`);
    }

    // Scrub outbound data
    const sanitizedTask = this.scrubOutboundPayload(taskData);
    const envelope = this.createSignedEnvelope('task_dispatch', sanitizedTask, peer.secretKey, hops + 1);

    const serialized = JSON.stringify(envelope);
    if (serialized.length > DEFAULT_CIRCUIT_BREAKER.maxPayloadBytes) {
      throw new Error('Circuit breaker triggered: PAYLOAD_SIZE_EXCEEDED');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_CIRCUIT_BREAKER.timeoutMs);

    const startTime = Date.now();
    try {
      const resp = await this.fetchImpl(`${peer.endpoint}/api/federation/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
        signal: controller.signal
      });

      clearTimeout(timeout);
      const elapsedMs = Date.now() - startTime;

      if (!resp.ok) {
        throw new Error(`Remote node responded with HTTP ${resp.status}`);
      }

      const resJson = await resp.json();
      peer.lastSeenAt = new Date().toISOString();
      this.store.save({ federationPeers: peers });

      logAuditEvent({
        action: 'federation_dispatch_success',
        peerId,
        hops: hops + 1,
        latencyMs: elapsedMs
      });

      return {
        success: true,
        peerId,
        hops: hops + 1,
        latencyMs: elapsedMs,
        result: resJson
      };
    } catch (err) {
      clearTimeout(timeout);
      logAuditEvent({
        action: 'federation_dispatch_failed',
        peerId,
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Inbound federated message receiver.
   * Validates signature, checks peer trust tier, and executes task.
   */
  async handleIncomingMessage(envelope, localExecutor) {
    const peers = this.getPeers();
    const sender = peers.find(p => p.peerId === envelope.sourceNodeId);
    const secret = sender ? sender.secretKey : this.nodeSecret;

    const verification = this.verifyEnvelope(envelope, secret);
    if (!verification.valid) {
      return { success: false, error: verification.reason, status: 401 };
    }

    const trustLevel = sender ? sender.trustLevel : TRUST_LEVELS.UNTRUSTED;
    if (trustLevel < TRUST_LEVELS.VERIFIED) {
      return { success: false, error: 'Peer trust level insufficient for remote execution', status: 403 };
    }

    if (envelope.hops > DEFAULT_CIRCUIT_BREAKER.maxHops) {
      return { success: false, error: 'Circuit breaker triggered: HOP_LIMIT_EXCEEDED', status: 400 };
    }

    try {
      let executionResult = null;
      if (typeof localExecutor === 'function') {
        executionResult = await localExecutor(envelope.payload, sender);
      } else {
        executionResult = { executedOn: this.nodeId, received: envelope.payload };
      }

      return {
        success: true,
        nodeId: this.nodeId,
        hops: envelope.hops,
        output: executionResult
      };
    } catch (err) {
      return { success: false, error: err.message, status: 500 };
    }
  }
}

module.exports = {
  TRUST_LEVELS,
  DEFAULT_CIRCUIT_BREAKER,
  RufloFederationEngine
};
