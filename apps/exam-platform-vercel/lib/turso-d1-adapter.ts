import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";

let client: Client | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || (!url.startsWith("file:") && !authToken)) throw new Error("Turso 데이터베이스 환경변수가 연결되지 않았습니다.");
  client = createClient({ url, authToken: authToken || undefined });
  return client;
}

export class TursoPreparedStatement {
  readonly sql: string;
  readonly args: unknown[];

  constructor(sql: string, args: unknown[] = []) {
    this.sql = sql;
    this.args = args;
  }

  bind(...args: unknown[]) {
    return new TursoPreparedStatement(this.sql, args);
  }

  private statement(): InStatement {
    return { sql: this.sql, args: this.args as InArgs };
  }

  async run() {
    const result = await getClient().execute(this.statement());
    return { success: true, meta: { changes: result.rowsAffected } };
  }

  async all<T>() {
    const result = await getClient().execute(this.statement());
    return { results: result.rows as unknown as T[] };
  }

  async first<T>() {
    const result = await getClient().execute(this.statement());
    return (result.rows[0] as unknown as T | undefined) ?? null;
  }
}

export function tursoDatabase() {
  return {
    prepare(sql: string) {
      return new TursoPreparedStatement(sql);
    },
    async batch(statements: TursoPreparedStatement[]) {
      const results = await getClient().batch(
        statements.map((statement) => ({ sql: statement.sql, args: statement.args as InArgs })),
        "write",
      );
      return results.map((result) => ({ success: true, meta: { changes: result.rowsAffected } }));
    },
  };
}
