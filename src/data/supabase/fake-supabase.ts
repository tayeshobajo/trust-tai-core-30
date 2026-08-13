/**
 * A tiny in-memory stand-in for the Supabase client, for tests only.
 *
 * It supports exactly the query shapes Scout's persistence layer uses —
 * insert/select/update with `eq` filters and `order` — so integration tests
 * can exercise real service code end to end without a network or a database.
 *
 * It is deliberately strict: an unsupported shape throws rather than quietly
 * returning nothing, so a test never passes on a query the app cannot make.
 */

export type FakeRow = Record<string, unknown>;

interface Filter {
  column: string;
  value: unknown;
}

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;

  constructor(
    private readonly rows: FakeRow[],
    private readonly mode: "select" | "insert" | "update" | "delete" | "upsert",
    private readonly body?: FakeRow | FakeRow[],
    private readonly onWrite?: (row: FakeRow) => void,
    /** Columns that make an upsert idempotent, as PostgREST's on_conflict does. */
    private readonly conflict: string[] = [],
  ) {}


  eq(column: string, value: unknown): Query {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): Query {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number): Query {
    this.limitTo = count;
    return this;
  }

  select(): Query {
    return this;
  }

  private matched(): FakeRow[] {
    let rows = this.rows.filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);
    return rows;
  }

  private run(): { data: unknown; error: null } {
    if (this.mode === "insert") {
      const bodies = Array.isArray(this.body) ? this.body : [this.body ?? {}];
      const written = bodies.map((body) => {
        const row: FakeRow = {
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...body,
        };
        this.rows.push(row);
        this.onWrite?.(row);
        return row;
      });
      return { data: written.length === 1 ? written[0]! : written, error: null };
    }

    if (this.mode === "delete") {
      const doomed = this.matched();
      for (const row of doomed) {
        const index = this.rows.indexOf(row);
        if (index >= 0) this.rows.splice(index, 1);
      }
      return { data: doomed, error: null };
    }

    if (this.mode === "update") {
      const target = this.matched()[0];
      if (!target) return { data: null, error: null };
      Object.assign(target, this.body as FakeRow, { updated_at: new Date().toISOString() });
      this.onWrite?.(target);
      return { data: target, error: null };
    }

    return { data: this.matched(), error: null };
  }

  single(): { data: unknown; error: null } | PromiseLike<{ data: unknown; error: null }> {
    const result = this.run();
    const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
    return Promise.resolve({ data, error: null });
  }

  maybeSingle(): PromiseLike<{ data: unknown; error: null }> {
    return this.single() as PromiseLike<{ data: unknown; error: null }>;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export interface FakeSupabase {
  tables: Record<string, FakeRow[]>;
  from: (table: string) => {
    select: (columns?: string) => Query;
    insert: (body: FakeRow | FakeRow[]) => Query;
    update: (body: FakeRow) => Query;
    delete: () => Query;
  };
}

/** A fresh database. Tables are created lazily on first use. */
export function createFakeSupabase(seed: Record<string, FakeRow[]> = {}): FakeSupabase {
  const tables: Record<string, FakeRow[]> = { ...seed };
  const rowsFor = (table: string) => (tables[table] ??= []);

  return {
    tables,
    from(table: string) {
      const rows = rowsFor(table);
      return {
        select: () => new Query(rows, "select"),
        insert: (body: FakeRow | FakeRow[]) => new Query(rows, "insert", body),
        update: (body: FakeRow) => new Query(rows, "update", body),
        delete: () => new Query(rows, "delete"),
      };
    },
  };
}
