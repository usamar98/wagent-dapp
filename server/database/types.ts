import type { databaseSchema, ModelName, ModelRows } from './schema.js';

export interface QueryOptions { where?: Record<string, unknown>; include?: Record<string, unknown>; select?: Record<string, unknown>; orderBy?: unknown; take?: number; skip?: number }
export interface MutationOptions extends QueryOptions { data: Record<string, unknown> }
type Relations<M extends ModelName> = typeof databaseSchema[M]['relations'];
type Target<M extends ModelName, K extends keyof Relations<M>> = Relations<M>[K] extends { model: infer R extends ModelName } ? R : never;
type RelationValue<M extends ModelName, K extends keyof Relations<M>, A> = Relations<M>[K] extends { many: true } ? Result<Target<M, K>, A extends true ? {} : A>[] : Relations<M>[K] extends { nullable: true } ? Result<Target<M, K>, A extends true ? {} : A> | null : Result<Target<M, K>, A extends true ? {} : A>;
type Projection<M extends ModelName, S> = { [K in keyof S as S[K] extends false | undefined ? never : K extends keyof ModelRows[M] | keyof Relations<M> ? K : never]: K extends keyof ModelRows[M] ? ModelRows[M][K] : K extends keyof Relations<M> ? RelationValue<M, K, S[K]> : never };
export type Result<M extends ModelName, A> = A extends { select: infer S } ? Projection<M, S> : ModelRows[M] & (A extends { include: infer I } ? Projection<M, I> : {});
