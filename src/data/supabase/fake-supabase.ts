/**
 * A tiny in-memory stand-in for the Supabase client, for tests only.
 *
 * It supports exactly the query shapes Scout's persistence layer uses
 * insert/select/update with `eq` filters and `order` · so integration tests
 * can exercise real service code end to end without a network or a database.
 *
 * It is deliberately strict: an unsupported shape throws rather than quietly
 * returning nothing, so a test never passes on a query the app cannot make.
 */

export type FakeRow = Record<string, unknown>;

interface Filter {
  column: string;
  value: unknown;
  /** `in` filters match any value in the list, as PostgREST does. */
  anyOf?: unknown[];
  /** Range filters: inclusive lower / exclusive upper bound (string compare). */
  gte?: unknown;
  lt?: unknown;
  /** Case-insensitive pattern, `%` wildcards, as PostgREST's ilike does. */
  ilike?: string;
  /** Anything but this value. */
  not?: boolean;
  /** A disjunction: the row matches when any branch matches. */
  or?: Filter[];
  /** A conjunction: the row matches when every branch matches. */
  and?: Filter[];
}

/** How much this fake database was actually asked to hand back. */
export interface FakeStats {
  /** Every query run, whatever its shape. */
  queries: number;
  /** Rows materialised into results. A head count materialises none. */
  rowsRead: number;
}

function matchesFilter(row: FakeRow, filter: Filter): boolean {
  if (filter.or) return filter.or.some((branch) => matchesFilter(row, branch));
  if (filter.and) return filter.and.every((branch) => matchesFilter(row, branch));
  if (filter.ilike !== undefined) {
    const pattern = new RegExp(
      `^${filter.ilike.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
      "i",
    );
    return pattern.test(String(row[filter.column] ?? ""));
  }
  if (filter.anyOf) {
    const hit = filter.anyOf.includes(row[filter.column]);
    return filter.not ? !hit : hit;
  }
  if (filter.gte !== undefined) return String(row[filter.column] ?? "") >= String(filter.gte);
  if (filter.lt !== undefined) return String(row[filter.column] ?? "") < String(filter.lt);
  const equal = row[filter.column] === filter.value;
  return filter.not ? !equal : equal;
}

/**
 * PostgREST's `or=(a.eq.1,b.ilike.%x%)` mini-language, enough of it for the
 * board's server-side tab and search filtering.
 */
function parseOr(expression: string): Filter[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of expression) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) parts.push(current);

  return parts.map((part) => {
    if (part.startsWith("and(")) {
      return { column: "", value: null, and: parseOr(part.slice(4, -1)) };
    }
    if (part.startsWith("or(")) {
      return { column: "", value: null, or: parseOr(part.slice(3, -1)) };
    }
    const [column, operator, ...rest] = part.split(".");
    const value = rest.join(".");
    if (operator === "ilike") return { column: column!, value: null, ilike: value };
    if (operator === "in") {
      return {
        column: column!,
        value: null,
        anyOf: value
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((entry) => entry.replace(/^"|"$/g, "")),
      };
    }
    return { column: column!, value };
  });
}

interface FakeResult {
  data: unknown;
  error: null;
  count?: number;
}

class Query implements PromiseLike<FakeResult> {
  private filters: Filter[] = [];
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitTo: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private counting = false;
  private headOnly = false;

  constructor(
    private readonly rows: FakeRow[],
    private readonly mode: "select" | "insert" | "update" | "delete" | "upsert",
    private readonly body?: FakeRow | FakeRow[],
    private readonly onWrite?: (row: FakeRow) => void,
    /** Columns that make an upsert idempotent, as PostgREST's on_conflict does. */
    private readonly conflict: string[] = [],
    /** Told how many rows each run actually handed back. */
    private readonly track?: (rows: number) => void,
  ) {}

  eq(column: string, value: unknown): Query {
    this.filters.push({ column, value });
    return this;
  }

  gte(column: string, value: unknown): Query {
    this.filters.push({ column, value: null, gte: value });
    return this;
  }

  lt(column: string, value: unknown): Query {
    this.filters.push({ column, value: null, lt: value });
    return this;
  }

  in(column: string, values: unknown[]): Query {
    this.filters.push({ column, value: values, anyOf: values });
    return this;
  }

  neq(column: string, value: unknown): Query {
    this.filters.push({ column, value, not: true });
    return this;
  }

  ilike(column: string, pattern: string): Query {
    this.filters.push({ column, value: null, ilike: pattern });
    return this;
  }

  or(expression: string): Query {
    this.filters.push({ column: "", value: null, or: parseOr(expression) });
    return this;
  }

  range(from: number, to: number): Query {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): Query {
    this.orderBy.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): Query {
    this.limitTo = count;
    return this;
  }

  select(_columns?: string, options?: { count?: string; head?: boolean }): Query {
    if (options?.count) this.counting = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  private filtered(): FakeRow[] {
    let rows = this.rows.filter((row) =>
      this.filters.every((filter) => matchesFilter(row, filter)),
    );
    for (const { column, ascending } of [...this.orderBy].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    return rows;
  }

  private matched(): FakeRow[] {
    let rows = this.filtered();
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);
    return rows;
  }

  private run(): FakeResult {
    if (this.mode === "upsert") {
      const bodies = Array.isArray(this.body) ? this.body : [this.body ?? {}];
      const written = bodies.map((body) => {
        const existing =
          this.conflict.length > 0
            ? this.rows.find((row) => this.conflict.every((column) => row[column] === body[column]))
            : undefined;
        if (existing) {
          Object.assign(existing, body, { updated_at: new Date().toISOString() });
          this.onWrite?.(existing);
          return existing;
        }
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
      // PostgREST returns a list for a list body, exactly as the real client does.
      return { data: Array.isArray(this.body) ? written : (written[0] ?? null), error: null };
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

    if (this.counting) {
      const total = this.filtered().length;
      const rows = this.headOnly ? [] : this.matched();
      this.track?.(rows.length);
      return { data: this.headOnly ? null : rows, error: null, count: total };
    }
    const rows = this.matched();
    this.track?.(rows.length);
    return { data: rows, error: null };
  }

  single(): PromiseLike<FakeResult> {
    const result = this.run();
    const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
    return Promise.resolve({ data, error: null });
  }

  maybeSingle(): PromiseLike<FakeResult> {
    return this.single();
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export interface FakeSupabase {
  tables: Record<string, FakeRow[]>;
  /** What the fake database was asked for, so a test can prove bounded reads. */
  stats: FakeStats;
  resetStats: () => void;
  from: (table: string) => {
    select: (columns?: string, options?: { count?: string; head?: boolean }) => Query;
    insert: (body: FakeRow | FakeRow[]) => Query;
    upsert: (body: FakeRow | FakeRow[], options?: { onConflict?: string }) => Query;
    update: (body: FakeRow) => Query;
    delete: () => Query;
  };
}

/** A fresh database. Tables are created lazily on first use. */
export function createFakeSupabase(seed: Record<string, FakeRow[]> = {}): FakeSupabase {
  const tables: Record<string, FakeRow[]> = { ...seed };
  const rowsFor = (table: string) => (tables[table] ??= []);
  const stats: FakeStats = { queries: 0, rowsRead: 0 };
  const track = (rows: number) => {
    stats.queries += 1;
    stats.rowsRead += rows;
  };

  return {
    tables,
    stats,
    resetStats() {
      stats.queries = 0;
      stats.rowsRead = 0;
    },
    from(table: string) {
      const rows = rowsFor(table);
      return {
        select: (columns?: string, options?: { count?: string; head?: boolean }) =>
          new Query(rows, "select", undefined, undefined, [], track).select(columns, options),
        insert: (body: FakeRow | FakeRow[]) => new Query(rows, "insert", body),
        upsert: (body: FakeRow | FakeRow[], options?: { onConflict?: string }) =>
          new Query(
            rows,
            "upsert",
            body,
            undefined,
            (options?.onConflict ?? "")
              .split(",")
              .map((column) => column.trim())
              .filter(Boolean),
          ),
        update: (body: FakeRow) => new Query(rows, "update", body),
        delete: () => new Query(rows, "delete"),
      };
    },
  };
}
