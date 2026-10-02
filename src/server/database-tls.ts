import { X509Certificate } from 'node:crypto';

/** Pass exactly the parsed PEM certificates to TLS, including every CA in a bundle. */
export function databaseCa(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const decoded = value.replace(/\\r\\n|\\n|\\r/g, '\n');
  const blocks = decoded.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!blocks?.length) throw new Error('Invalid database CA certificate');
  try {
    return blocks.map((block) => new X509Certificate(block).toString()).join('\n');
  } catch {
    throw new Error('Invalid database CA certificate');
  }
}
