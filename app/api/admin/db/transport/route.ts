import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { verifyAdminAuth } from '@/lib/api/admin-auth';
import { getPoolAsync, getActiveMode } from '@/lib/db/pool';

interface NameValueRow extends RowDataPacket {
  Variable_name: string;
  Value: string | null;
}

function toMap(rows: NameValueRow[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const row of rows) {
    out[row.Variable_name] = row.Value ?? null;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const authError = verifyAdminAuth(request);
  if (authError) return authError;

  try {
    const pool = await getPoolAsync();
    const conn = await pool.getConnection();
    try {
      const [statusRows] = await conn.query<NameValueRow[]>(
        "SHOW STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')"
      );
      const [variableRows] = await conn.query<NameValueRow[]>(
        "SHOW VARIABLES WHERE Variable_name IN ('require_secure_transport','have_ssl')"
      );

      const status = toMap(statusRows);
      const variables = toMap(variableRows);

      const sslCipher = status.Ssl_cipher || null;
      const sslVersion = status.Ssl_version || null;

      return NextResponse.json({
        success: true,
        activeMode: getActiveMode(),
        transport: {
          tlsActive: Boolean(sslCipher),
          sslCipher,
          sslVersion,
        },
        server: {
          requireSecureTransport: variables.require_secure_transport || null,
          haveSsl: variables.have_ssl || null,
        },
      });
    } finally {
      conn.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to inspect DB transport';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
