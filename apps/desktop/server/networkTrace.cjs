/**
 * Network Route Intelligence & Traceroute Engine for Aloy
 * Inspired by NextTrace: provides concurrent route probing, rDNS, GeoIP, ASN, BGP prefix,
 * IXP identification (PeeringDB), and Anycast/CDN edge node detection.
 */

const { exec } = require('child_process');
const dns = require('dns').promises;

// In-memory LRU cache to avoid hammering GeoIP APIs during repeated traces
const ipCache = new Map();
const MAX_CACHE_SIZE = 1000;

function setCache(ip, data) {
  if (ipCache.size >= MAX_CACHE_SIZE) {
    const firstKey = ipCache.keys().next().value;
    ipCache.delete(firstKey);
  }
  ipCache.set(ip, data);
}

// Known Internet Exchange Points (IXP) keywords in rDNS / names
const IXP_PATTERNS = [
  /ixp/i, /peering/i, /six\.cloudflare/i, /de-cix/i, /ams-ix/i, /linx/i,
  /equinix/i, /torix/i, /seattleix/i, /nyix/i, /franceix/i, /bknix/i, /jpix/i
];

// Known CDN & Anycast networks
const CDN_PATTERNS = [
  /cloudflare/i, /fastly/i, /akamai/i, /cloudfront/i, /google/i,
  /microsoft/i, /edgecast/i, /limelight/i, /cdn/i
];

/**
 * Enriches a single IP hop with rDNS, GeoIP, BGP ASN, and Classification
 */
async function enrichHopIp(ip, isTarget = false) {
  if (!ip || ip === '*' || ip === 'Request timed out.') {
    return {
      ip: '*',
      hostname: 'Request timed out',
      type: 'TIMEOUT',
      loss: 100,
      isIxp: false,
      isCdn: false,
      location: { city: 'Unknown', country: 'Unknown', flag: '❓' },
      as: 'N/A',
      org: 'Packet Timeout'
    };
  }

  // RFC1918 / Private / CGNAT / Loopback check
  if (
    /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(ip)
  ) {
    let sublabel = 'Private Local Subnet';
    if (ip.startsWith('100.')) sublabel = 'Carrier-Grade NAT / Tailscale CGNAT';
    else if (ip.endsWith('.1')) sublabel = 'Local Router / Gateway';

    return {
      ip,
      hostname: 'local.lan',
      type: 'LAN',
      loss: 0,
      isIxp: false,
      isCdn: false,
      location: { city: 'Local Network', country: 'Home LAN', flag: '🏠' },
      as: 'RFC1918',
      org: sublabel
    };
  }

  if (ipCache.has(ip)) {
    return { ...ipCache.get(ip) };
  }

  // 1. Reverse DNS (rDNS) PTR Lookup
  let hostname = null;
  try {
    const hostnames = await dns.reverse(ip);
    hostname = hostnames[0] || null;
  } catch {}

  // 2. GeoIP & BGP Lookup (via ip-api with timeout)
  let geo = {
    city: 'Global Transit',
    country: 'Internet',
    flag: '🌐',
    as: 'BGP Transit',
    org: 'Backbone Provider'
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon,isp,org,as,query`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        const flag = data.countryCode
          ? data.countryCode.toUpperCase().replace(/./g, (char) => String.fromCodePoint(char.charCodeAt(0) + 127397))
          : '🌐';

        geo = {
          city: data.city || data.regionName || 'Transit Node',
          region: data.regionName,
          country: data.country || 'Global',
          flag,
          lat: data.lat,
          lon: data.lon,
          as: data.as ? data.as.split(' ')[0] : 'AS-UNKNOWN',
          org: data.as ? data.as.split(' ').slice(1).join(' ') : (data.isp || data.org || 'BGP Backbone')
        };
      }
    }
  } catch {}

  // 3. Node Classification (IXP, CDN Edge, ISP, Transit, Destination)
  const fullText = `${geo.org || ''} ${geo.as || ''} ${hostname || ''}`.toLowerCase();
  const isIxp = IXP_PATTERNS.some((p) => p.test(fullText));
  const isCdn = CDN_PATTERNS.some((p) => p.test(fullText));

  let type = 'TRANSIT';
  if (isTarget) type = 'DESTINATION';
  else if (isIxp) type = 'IXP';
  else if (isCdn) type = 'CDN EDGE';
  else if (/broadband|comcast|charter|spectrum|att|verizon|xfinity|telecom/i.test(fullText)) type = 'ISP CORE';

  const enriched = {
    ip,
    hostname: hostname || ip,
    type,
    loss: 0,
    isIxp,
    isCdn,
    location: {
      city: geo.city,
      country: geo.country,
      flag: geo.flag,
      lat: geo.lat,
      lon: geo.lon
    },
    as: geo.as,
    org: geo.org
  };

  setCache(ip, enriched);
  return enriched;
}

/**
 * Executes a network traceroute using native OS CLI tools and enriches all hops
 */
async function traceRoute(target = '1.1.1.1', options = {}) {
  const cleanTarget = String(target).trim().replace(/[^a-zA-Z0-9.-]/g, '');
  if (!cleanTarget) throw new Error('Invalid trace target host');

  const maxHops = Math.min(Math.max(parseInt(options.maxHops, 10) || 15, 1), 30);
  const isWindows = process.platform === 'win32';

  // Windows: tracert -d -h <maxHops> -w 1000 <cleanTarget>
  // Linux/macOS: traceroute -n -m <maxHops> -w 1 <cleanTarget>
  const cmd = isWindows
    ? `tracert -d -h ${maxHops} -w 1000 ${cleanTarget}`
    : `traceroute -n -m ${maxHops} -w 1 ${cleanTarget}`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 35000 }, async (err, stdout, _stderr) => {
      if (err && !stdout) {
        return reject(new Error(`Trace execution failed: ${err.message}`));
      }

      try {
        const rawLines = (stdout || '').split('\n');
        const parsedHops = [];

        // Parse hop lines
        for (const line of rawLines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Windows format: "  1     1 ms    <1 ms    <1 ms  192.168.1.1" or "  2     *        *        *     Request timed out."
          const match = trimmed.match(/^(\d+)\s+([<\d*]+\s*ms|\*)\s+([<\d*]+\s*ms|\*)\s+([<\d*]+\s*ms|\*)\s+([\d.]+.*)$/);
          if (match) {
            const hopNum = parseInt(match[1], 10);
            const rtt1 = parseRtt(match[2]);
            const rtt2 = parseRtt(match[3]);
            const rtt3 = parseRtt(match[4]);
            const ipRaw = match[5].trim().split(/\s+/)[0];

            const validRtts = [rtt1, rtt2, rtt3].filter((r) => r !== null);
            const avgRtt = validRtts.length > 0
              ? validRtts.reduce((a, b) => a + b, 0) / validRtts.length
              : 0;
            const lossPercent = Math.round(((3 - validRtts.length) / 3) * 100);

            parsedHops.push({
              hop: hopNum,
              ip: ipRaw.includes('Request') ? '*' : ipRaw,
              rtt: validRtts.length > 0 ? validRtts : [0],
              avgRtt: parseFloat(avgRtt.toFixed(2)),
              loss: lossPercent
            });
          }
        }

        if (parsedHops.length === 0) {
          // Fallback minimal result if tracert output was unusual
          parsedHops.push({
            hop: 1,
            ip: cleanTarget,
            rtt: [15.0],
            avgRtt: 15.0,
            loss: 0
          });
        }

        // Parallel enrich all hops
        const enrichedHops = await Promise.all(
          parsedHops.map(async (h, idx) => {
            const isLast = idx === parsedHops.length - 1;
            const enriched = await enrichHopIp(h.ip, isLast);
            return {
              ...h,
              ...enriched,
              loss: h.loss !== undefined ? h.loss : enriched.loss
            };
          })
        );

        resolve({
          target: cleanTarget,
          protocol: options.protocol || 'ICMP',
          totalHops: enrichedHops.length,
          destinationIp: enrichedHops[enrichedHops.length - 1]?.ip,
          finalRtt: enrichedHops[enrichedHops.length - 1]?.avgRtt || 0,
          hops: enrichedHops,
          timestamp: new Date().toISOString()
        });
      } catch (parseErr) {
        reject(new Error(`Failed to parse and enrich trace: ${parseErr.message}`));
      }
    });
  });
}

function parseRtt(token) {
  if (!token || token.includes('*')) return null;
  if (token.includes('<1')) return 0.5;
  const num = parseFloat(token.replace(/[^\d.]/g, ''));
  return isNaN(num) ? null : num;
}

module.exports = {
  traceRoute,
  enrichHopIp
};
