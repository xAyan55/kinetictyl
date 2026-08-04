import dotenv from 'dotenv';
dotenv.config();

const ALL_ZEROS = '00000000000000000000000000000000';

const required = (key: string, fallback?: string): string => {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    return fallback || 'default_key_change_me_12345';
  }
  return val;
};

const daemonKey = required('key', 'default_key_change_me_12345');

const config = {
  remote: required('remote', '127.0.0.1'),
  key: daemonKey,
  port: parseInt(process.env.PORT || '3001', 10),
  debug: process.env.DEBUG === 'true',
  version: '1.0.0',
  statsInterval: parseInt(process.env.STATS_INTERVAL ?? '10000', 10),
  allowedIps:
    process.env.ALLOWED_IPS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [],
  tlsCertPath: process.env.TLS_CERT ?? null,
  tlsKeyPath: process.env.TLS_KEY ?? null,
} as const;

export default config;
