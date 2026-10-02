import { z } from 'zod';

const key = z
  .string()
  .refine(
    (v) => /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, 'base64').length === 32,
    'Expected 32 random bytes in base64',
  );
const schema = z.object({
  PUBLIC_ORIGIN: z.url().refine((v) => {
    const u = new URL(v);
    return u.protocol === 'https:' && u.origin === v;
  }),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).default('true'),
  DATABASE_SSL_CA: z.string().optional(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  PIN_PEPPER: key,
  HMAC_KEY: key,
  ENCRYPTION_KEY: key,
  TRUSTED_IP_HEADER: z.string().default(''),
  TEST_TRAFFIC_SECRET: z.string().default(''),
  STATISTICS_TIMEOUT_MS: z.coerce.number().int().min(20).max(1000).default(150),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return result.data;
}
