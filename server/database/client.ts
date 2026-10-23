import { randomUUID } from 'node:crypto';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { databaseSchema, type ModelName } from './schema.js';
import { columnName, definition, identifier, object, orderSql, Parameters, parameterValue, positiveLimit, tableName, uniqueWhere, whereSql, type Relation } from './query.js';
import type { MutationOptions, QueryOptions, Result } from './types.js';

// Application timestamps are UTC, including PostgreSQL's timestamp-without-zone columns.
types.setTypeParser(1114, value => new Date(value.replace(' ', 'T') + 'Z'));
type Row = Record<string, unknown>;
type TransactionOptions = { timeout?: number; maxWait?: number; isolationLevel?: 'Serializable' };
export class RecordNotFound extends Error { readonly code = 'NOT_FOUND'; constructor() { super('Record not found'); } }
export type Database = SqlSession & { [M in ModelName as Uncapitalize<M>]: Repository<M> };

function attach(pool: Pool, client?: PoolClient, deadline?: number): Database {
  const session = new SqlSession(pool, client, deadline);
  for (const model of Object.keys(databaseSchema) as ModelName[]) Object.defineProperty(session, model[0].toLowerCase() + model.slice(1), { value: new Repository(model, session), enumerable: true });
  return session as Database;
}

class SqlSession {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly pool: Pool, private readonly client?: PoolClient, private readonly deadline?: number) {}
  async raw<T extends QueryResultRow = Row>(text: string, values: unknown[] = []) {
    const execute = () => {
      if (this.deadline && Date.now() >= this.deadline) throw new Error('Database transaction timed out.');
      return (this.client || this.pool).query<T>(text, values.map(parameterValue));
    };
    if (!this.client) return execute();
    const result = this.pending.then(execute);
    this.pending = result.catch(() => undefined);
    return result;
  }
  async sql<T extends QueryResultRow = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    const text = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    return (await this.raw<T>(text, values)).rows;
  }
  async close() { if (!this.client) await this.pool.end(); }
  async transaction<T>(fn: (tx: Database) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    if (this.client) return fn(this as unknown as Database);
    const timeout = options.timeout ?? 20000;
    const maxWait = options.maxWait ?? 15000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000 || !Number.isSafeInteger(maxWait) || maxWait < 1 || maxWait > 120000) throw new Error('Invalid transaction timeout.');
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query(options.isolationLevel === 'Serializable' ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${timeout}ms'`);
      await client.query(`SET LOCAL lock_timeout = '${Math.min(maxWait, timeout)}ms'`);
      const deadline = Date.now() + timeout;
      const result = await fn(attach(this.pool, client, deadline));
      if (Date.now() >= deadline) throw new Error('Database transaction timed out.');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  async read(model: ModelName, options: QueryOptions = {}, grouping?: { field: string; values: unknown[] }): Promise<Row[]> {
    if (options.select && options.include) throw new Error('Choose a database projection or relation includes.');
    const parameters = new Parameters();
    let where = whereSql(model, options.where, parameters);
    if (grouping) {
      if (!grouping.values.length) return [];
      where += ` AND t.${columnName(model, grouping.field)} IN (${grouping.values.map(value => parameters.add(value)).join(', ')})`;
    }
    const order = orderSql(model, options.orderBy);
    const take = positiveLimit(options.take), skip = positiveLimit(options.skip, 0)!;
    let text: string;
    if (grouping && (take !== undefined || skip)) {
      const rankOrder = order || definition(model).primaryKey.map(field => `t.${columnName(model, field)}`).join(', ');
      text = `SELECT * FROM (SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.${columnName(model, grouping.field)} ORDER BY ${rankOrder}) AS "_wagent_rank" FROM ${tableName(model)} t WHERE ${where}) ranked WHERE "_wagent_rank" > ${parameters.add(skip)}`;
      if (take !== undefined) text += ` AND "_wagent_rank" <= ${parameters.add(skip + take)}`;
      text += ' ORDER BY "_wagent_rank"';
    } else {
      text = `SELECT t.* FROM ${tableName(model)} t WHERE ${where}${order ? ` ORDER BY ${order}` : ''}`;
      if (take !== undefined) text += ` LIMIT ${parameters.add(take)}`;
      if (skip) text += ` OFFSET ${parameters.add(skip)}`;
    }
    const rows = (await this.raw(text, parameters.values)).rows;
    for (const row of rows) delete row._wagent_rank;
    return this.decorate(model, rows, options);
  }

  async decorate(model: ModelName, rows: Row[], options: QueryOptions): Promise<Row[]> {
    const requested = options.select || options.include || {}, relations = definition(model).relations;
    for (const [field, choice] of Object.entries(requested)) {
      if (!choice) continue;
      if (Object.hasOwn(relations, field)) {
        const relation = relations[field];
        const keys = [...new Set(rows.map(row => row[relation.local]).filter(value => value !== null && value !== undefined))];
        const relatedOptions = choice === true ? {} : object(choice) as QueryOptions;
        // Preserve the join key when a related record has a narrow projection.
        const loadedOptions = relatedOptions.select ? { ...relatedOptions, select: { ...relatedOptions.select, [relation.remote]: true } } : relatedOptions;
        const related = await this.read(relation.model, loadedOptions, { field: relation.remote, values: keys });
        const grouped = new Map<unknown, Row[]>();
        for (const item of related) { const key = item[relation.remote]; const group = grouped.get(key) || []; group.push(item); grouped.set(key, group); }
        for (const row of rows) {
          const items = grouped.get(row[relation.local]) || [];
          const values = relatedOptions.select ? items.map(item => project(item, relatedOptions.select!)) : items;
          if (!relation.many && !relation.nullable && !values.length) throw new Error('Required database relation is missing.');
          row[field] = relation.many ? values : values[0] ?? null;
        }
      } else if (options.select && !definition(model).columns.includes(field)) throw new Error(`Unknown ${model} projection: ${field}`);
      else if (options.include) throw new Error(`Unknown ${model} relation: ${field}`);
    }
    return options.select ? rows.map(row => project(row, options.select!)) : rows;
  }
}

function project(row: Row, select: Record<string, unknown>) { return Object.fromEntries(Object.keys(select).filter(field => !!select[field]).map(field => [field, row[field]])); }

class Repository<M extends ModelName> {
  constructor(readonly model: M, private readonly session: SqlSession) {}
  async findMany<const A extends QueryOptions = {}>(options?: A): Promise<Result<M, A>[]> { return await this.session.read(this.model, options) as Result<M, A>[]; }
  async findFirst<const A extends QueryOptions = {}>(options?: A): Promise<Result<M, A> | null> { return (await this.session.read(this.model, { ...options, take: 1 }))[0] as Result<M, A> ?? null; }
  async findUnique<const A extends QueryOptions>(options: A): Promise<Result<M, A> | null> { uniqueWhere(this.model, options.where); return this.findFirst(options); }
  async findUniqueOrThrow<const A extends QueryOptions>(options: A): Promise<Result<M, A>> { const row = await this.findUnique(options); if (!row) throw new RecordNotFound(); return row; }
  async count(options: Pick<QueryOptions, 'where'> = {}): Promise<number> {
    const parameters = new Parameters();
    const where = whereSql(this.model, options.where, parameters);
    return (await this.session.raw<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${tableName(this.model)} t WHERE ${where}`, parameters.values)).rows[0].count;
  }
  async create<const A extends MutationOptions>(options: A): Promise<Result<M, A>> {
    return this.session.transaction(async tx => {
      const { scalar, nested } = this.prepare(options.data, true);
      const parameters = new Parameters(), fields = Object.keys(scalar);
      const row = (await tx.raw(`INSERT INTO ${tableName(this.model)} (${fields.map(field => columnName(this.model, field)).join(', ')}) VALUES (${fields.map(field => this.value(field, scalar[field], parameters)).join(', ')}) RETURNING *`, parameters.values)).rows[0];
      await this.createChildren(tx, row, nested);
      return (await tx.decorate(this.model, [row], options))[0] as Result<M, A>;
    });
  }
  async update<const A extends MutationOptions>(options: A): Promise<Result<M, A>> {
    uniqueWhere(this.model, options.where);
    const row = (await this.updateRows(options))[0];
    if (!row) throw new RecordNotFound();
    return (await this.session.decorate(this.model, [row], options))[0] as Result<M, A>;
  }
  async updateMany(options: MutationOptions): Promise<{ count: number }> { return { count: (await this.updateRows(options)).length }; }
  private async updateRows(options: MutationOptions) {
    if (!options.where) throw new Error('Database updates require an explicit filter.');
    const { scalar, nested } = this.prepare(options.data, false);
    if (Object.keys(nested).length) throw new Error('Nested database updates are unsupported.');
    if (!Object.keys(scalar).length) return this.session.read(this.model, { where: options.where });
    const parameters = new Parameters(), assignments = this.assignments(scalar, parameters);
    const where = whereSql(this.model, options.where, parameters);
    return (await this.session.raw(`UPDATE ${tableName(this.model)} t SET ${assignments.join(', ')} WHERE ${where} RETURNING t.*`, parameters.values)).rows;
  }
  async upsert<const A extends QueryOptions & { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }>(options: A): Promise<Result<M, A>> {
    return this.session.transaction(async tx => {
      const table = definition(this.model), where = options.where;
      const alias = Object.keys(where).length === 1 ? Object.keys(where)[0] : '';
      const composite = table.unique.find(fields => fields.length > 1 && fields.join('_') === alias);
      const uniqueValues = composite ? object(where[alias]) : where;
      const conflict = composite || table.unique.find(fields => fields.length === Object.keys(uniqueValues).length && fields.every(field => Object.hasOwn(uniqueValues, field)));
      if (!conflict || conflict.some(field => uniqueValues[field] === undefined || uniqueValues[field] === null || options.create[field] !== uniqueValues[field])) throw new Error('Upsert requires a complete matching unique key.');
      const { scalar, nested } = this.prepare(options.create, true), change = this.prepare(options.update, false);
      if (Object.keys(change.nested).length) throw new Error('Nested database updates are unsupported.');
      const parameters = new Parameters(), fields = Object.keys(scalar);
      const values = fields.map(field => this.value(field, scalar[field], parameters));
      const assignments = this.assignments(change.scalar, parameters);
      const result = await tx.raw(`INSERT INTO ${tableName(this.model)} (${fields.map(field => columnName(this.model, field)).join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT (${conflict.map(field => columnName(this.model, field)).join(', ')}) DO ${assignments.length ? `UPDATE SET ${assignments.join(', ')}` : 'NOTHING'} RETURNING *, (xmax = 0) AS "_wagent_inserted"`, parameters.values);
      let row = result.rows[0];
      if (row) { const inserted = row._wagent_inserted; delete row._wagent_inserted; if (inserted) await this.createChildren(tx, row, nested); }
      if (!row) { const repository = tx[this.model[0].toLowerCase() + this.model.slice(1) as keyof Database] as Repository<M>; row = await repository.findUniqueOrThrow({ where }) as Row; }
      return (await tx.decorate(this.model, [row], options))[0] as Result<M, A>;
    });
  }
  async delete<const A extends QueryOptions>(options: A): Promise<Result<M, A>> {
    uniqueWhere(this.model, options.where);
    if (options.include || (options.select && Object.keys(options.select).some(field => !definition(this.model).columns.includes(field)))) throw new Error('Delete supports scalar projections only.');
    const rows = await this.deleteRows(options);
    if (!rows[0]) throw new RecordNotFound();
    return (options.select ? project(rows[0], options.select) : rows[0]) as Result<M, A>;
  }
  async deleteMany(options: Pick<QueryOptions, 'where'>): Promise<{ count: number }> { return { count: (await this.deleteRows(options)).length }; }
  private async deleteRows(options: Pick<QueryOptions, 'where'>) {
    if (!options.where) throw new Error('Database deletes require an explicit filter.');
    const parameters = new Parameters(), where = whereSql(this.model, options.where, parameters);
    return (await this.session.raw(`DELETE FROM ${tableName(this.model)} t WHERE ${where} RETURNING t.*`, parameters.values)).rows;
  }
  async aggregate<const A extends { where?: Record<string, unknown>; _sum: Record<string, boolean> }>(options: A): Promise<{ _sum: { [K in keyof A['_sum']]: number | null } }> {
    const parameters = new Parameters(), fields = Object.keys(options._sum).filter(field => options._sum[field]);
    if (!fields.length) throw new Error('Choose a database aggregate field.');
    const columns = fields.map(field => `SUM(t.${columnName(this.model, field)}) AS ${identifier(field)}`).join(', ');
    const where = whereSql(this.model, options.where, parameters);
    const row = (await this.session.raw(`SELECT ${columns} FROM ${tableName(this.model)} t WHERE ${where}`, parameters.values)).rows[0];
    const sums = Object.fromEntries(fields.map(field => [field, row[field] === null ? null : Number(row[field])]));
    if (Object.values(sums).some(value => value !== null && !Number.isFinite(value))) throw new Error('Database aggregate is not finite.');
    return { _sum: sums } as { _sum: { [K in keyof A['_sum']]: number | null } };
  }
  private prepare(data: Record<string, unknown>, creating: boolean) {
    const scalar: Row = {}, nested: Record<string, { relation: Relation; create: Row[] }> = {}, table = definition(this.model);
    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (table.columns.includes(field)) scalar[field] = value;
      else if (Object.hasOwn(table.relations, field)) {
        const relation = table.relations[field], input = object(value);
        if (!Object.hasOwn(input, 'create') || Object.keys(input).some(key => key !== 'create')) throw new Error('Unsupported nested database write.');
        nested[field] = { relation, create: (Array.isArray(input.create) ? input.create : [input.create]).map(object) };
      } else throw new Error(`Unknown ${this.model} write column: ${field}`);
    }
    if (creating && table.generatedId && scalar.id === undefined) scalar.id = randomUUID();
    if (creating || Object.keys(scalar).length) for (const field of table.updatedAt) if (scalar[field] === undefined) scalar[field] = new Date();
    return { scalar, nested };
  }
  private value(field: string, value: unknown, parameters: Parameters) { return parameters.add(definition(this.model).json.includes(field) && value !== null ? JSON.stringify(value) : value); }
  private assignments(data: Row, parameters: Parameters) {
    return Object.entries(data).map(([field, value]) => {
      if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && !definition(this.model).json.includes(field)) {
        const change = object(value);
        if (Object.keys(change).length !== 1 || typeof change.increment !== 'number' || !Number.isFinite(change.increment)) throw new Error('Unsupported database update expression.');
        return `${columnName(this.model, field)} = ${columnName(this.model, field)} + ${parameters.add(change.increment)}`;
      }
      return `${columnName(this.model, field)} = ${this.value(field, value, parameters)}`;
    });
  }
  private async createChildren(tx: Database, row: Row, nested: Record<string, { relation: Relation; create: Row[] }>) {
    for (const { relation, create } of Object.values(nested)) for (const input of create) {
      if (row[relation.local] === undefined) throw new Error('Nested database write requires its parent key.');
      const repository = tx[relation.model[0].toLowerCase() + relation.model.slice(1) as keyof Database] as Repository<ModelName>;
      await repository.create({ data: { ...input, [relation.remote]: row[relation.local] } });
    }
  }
}

export function createDatabase(connectionString: string | undefined): Database {
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000, query_timeout: 30000, idleTimeoutMillis: 30000, allowExitOnIdle: true });
  pool.on('error', () => console.error('An idle PostgreSQL connection ended; new requests will reconnect.'));
  return attach(pool);
}
