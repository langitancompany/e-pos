// app/api/health/route.ts
// Endpoint ringan untuk Healthcheck Coolify (tanpa akses database).

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: 'ok' });
}