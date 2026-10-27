export const permissionTokenScopes = ['AGENT_MINTS', 'ANY_SOLANA'] as const;
export type PermissionTokenScope = typeof permissionTokenScopes[number];
export const anySolanaTokenLabel = 'Any supported Solana token';
