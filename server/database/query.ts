import { databaseSchema, type ModelName } from './schema.js';

export interface Relation { model: ModelName; local: string; remote: string; many: boolean; nullable: boolean }
export interface TableDefinition { columns: readonly string[]; primaryKey: readonly string[]; unique: readonly (readonly string[])[]; generatedId: boolean; updatedAt: readonly string[]; json: readonly string[]; relations: Readonly<Record<string, Relation>> }
export const definition = (model: ModelName): TableDefinition => databaseSchema[model];
export const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const tableName = (model: ModelName) => `public.${identifier(model)}`;
export function columnName(model: ModelName, field: string) {
  if (!definition(model).columns.includes(field)) throw new Error(`Unknown ${model} column: ${field}`);
  return identifier(field);
}
export function uniqueWhere(model: ModelName, input: unknown) {
  const where = object(input);
  const present = (value: unknown) => value !== undefined && value !== null && (typeof value === 'string' || typeof value === 'number');
  const valid = definition(model).unique.some(fields => {
    if (fields.every(field => present(where[field]))) return true;
    if (fields.length < 2) return false;
    const composite = where[fields.join('_')];
    return !!composite && typeof composite === 'object' && fields.every(field => present((composite as Record<string, unknown>)[field]));
  });
  if (!valid) throw new Error('A complete unique database filter is required.');
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) throw new Error('Expected database query options.');
  return value as Record<string, unknown>;
}
export const parameterValue = (value: unknown): unknown => value instanceof Date ? value.toISOString() : value;
export class Parameters {
  readonly values: unknown[] = [];
  private aliases = 0;
  add(value: unknown) { if (value === undefined) throw new Error('Undefined database query parameter.'); this.values.push(parameterValue(value)); return `$${this.values.length}`; }
  alias() { return `r${++this.aliases}`; }
}

function scalar(column: string, value: unknown, parameters: Parameters): string {
  if (value === undefined) throw new Error('Undefined database filter; refusing an unscoped query.');
  if (value === null) return `${column} IS NULL`;
  if (typeof value !== 'object' || value instanceof Date || Array.isArray(value)) return `${column} = ${parameters.add(value)}`;
  const clauses: string[] = [];
  for (const [operator, operand] of Object.entries(object(value))) {
    if (operator === 'equals') clauses.push(scalar(column, operand, parameters));
    else if (operator === 'not') clauses.push(`NOT (${scalar(column, operand, parameters)})`);
    else if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(operand)) throw new Error('Database membership filters require an array.');
      clauses.push(operand.length ? `${column} ${operator === 'in' ? 'IN' : 'NOT IN'} (${operand.map(item => parameters.add(item)).join(', ')})` : operator === 'in' ? 'FALSE' : 'TRUE');
    } else {
      const comparisons: Record<string, string> = { lt: '<', lte: '<=', gt: '>', gte: '>=' };
      if (!Object.hasOwn(comparisons, operator)) throw new Error(`Unsupported database comparison: ${operator}`);
      clauses.push(`${column} ${comparisons[operator]} ${parameters.add(operand)}`);
    }
  }
  if (!clauses.length) throw new Error('Empty scalar database filter.');
  return clauses.map(clause => `(${clause})`).join(' AND ');
}

export function whereSql(model: ModelName, input: unknown, parameters: Parameters, alias = 't'): string {
  if (input === undefined) return 'TRUE';
  const clauses: string[] = [];
  const fields = object(input), table = definition(model);
  for (const [field, value] of Object.entries(fields)) {
    if (['AND', 'OR', 'NOT'].includes(field)) {
      const items = Array.isArray(value) ? value : [value];
      const combined = items.map(item => `(${whereSql(model, item, parameters, alias)})`).join(field === 'OR' ? ' OR ' : ' AND ') || (field === 'OR' ? 'FALSE' : 'TRUE');
      clauses.push(field === 'NOT' ? `NOT (${combined})` : combined);
    } else if (Object.hasOwn(table.relations, field)) {
      const relation = table.relations[field], relatedAlias = parameters.alias();
      const join = `${relatedAlias}.${columnName(relation.model, relation.remote)} = ${alias}.${columnName(model, relation.local)}`;
      if (!relation.many) {
        if (value === null) clauses.push(`NOT EXISTS (SELECT 1 FROM ${tableName(relation.model)} ${relatedAlias} WHERE ${join})`);
        else clauses.push(`EXISTS (SELECT 1 FROM ${tableName(relation.model)} ${relatedAlias} WHERE ${join} AND (${whereSql(relation.model, value, parameters, relatedAlias)}))`);
      } else {
        const filters = Object.entries(object(value));
        if (!filters.length) throw new Error('Empty relation database filter.');
        for (const [operator, condition] of filters) {
          if (!['some', 'none', 'every'].includes(operator)) throw new Error('Unsupported relation database filter.');
          const match = whereSql(relation.model, condition, parameters, relatedAlias);
          clauses.push(`${operator === 'some' ? '' : 'NOT '}EXISTS (SELECT 1 FROM ${tableName(relation.model)} ${relatedAlias} WHERE ${join} AND (${operator === 'every' ? `NOT (${match})` : match}))`);
        }
      }
    } else if (table.columns.includes(field)) clauses.push(scalar(`${alias}.${columnName(model, field)}`, value, parameters));
    else {
      const composite = table.unique.find(columns => columns.length > 1 && columns.join('_') === field);
      if (!composite) throw new Error(`Unknown ${model} filter: ${field}`);
      const values = object(value);
      if (Object.keys(values).length !== composite.length || composite.some(column => !Object.hasOwn(values, column))) throw new Error('Incomplete unique database filter.');
      clauses.push(...composite.map(column => scalar(`${alias}.${columnName(model, column)}`, values[column], parameters)));
    }
  }
  return clauses.map(clause => `(${clause})`).join(' AND ') || 'TRUE';
}

export function orderSql(model: ModelName, input: unknown, alias = 't'): string {
  if (input === undefined) return '';
  const items = (Array.isArray(input) ? input : [input]).flatMap(item => Object.entries(object(item)));
  return items.map(([field, direction]) => {
    if (direction !== 'asc' && direction !== 'desc') throw new Error('Invalid database ordering.');
    return `${alias}.${columnName(model, field)} ${direction.toUpperCase()}`;
  }).join(', ');
}

export function positiveLimit(input: unknown, fallback?: number) {
  if (input === undefined) return fallback;
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > 100000) throw new Error('Invalid database result limit.');
  return input;
}
