// Application records stored in Supabase PostgreSQL. Keep in sync with SQL migrations.
import type { PermissionTokenScope } from '../../shared/permission-scope.js';
export interface ModelRows {
  SolanaWalletWithdrawal: { id: string; userId: string; walletAddress: string; ownerAddress: string; mint: string; amount: string; signature: string; status: string; lastValidBlockHeight: string; error: string | null; createdAt: Date; updatedAt: Date };
  SolanaTradingWallet: { userId: string; address: string; ownerAddress: string; encryptedSecret: string; createdAt: Date };
  SolanaTradePermission: { id: string; userId: string; channelId: string; channelFingerprint: string; channelOwnerId: string; instanceId: string; ownerAddress: string; tradingAddress: string; tokenScope: PermissionTokenScope; allowedMints: string[]; perTradeLamports: string; dailyLamports: string; maxFeeLamports: string; slippageBps: number; expiresAt: Date; revokedAt: Date | null; revokeReason: string | null; consentMessage: string; signature: string; createdAt: Date };
  SolanaPermissionChallenge: { id: string; userId: string; sessionId: string; purpose: string; address: string; message: string; payload: any; expiresAt: Date };
  SolanaChatTrade: { id: string; userId: string; commandId: string; permissionId: string; walletAddress: string; side: string; mint: string; amount: string; budgetLamports: string; status: string; providerRequestId: string | null; signature: string | null; quote: any; error: string | null; createdAt: Date; updatedAt: Date };
  SolanaTokenDiscovery: { mint: string; firstSeenAt: Date; lastSeenAt: Date };
  SolanaWallet: { userId: string; address: string; verifiedAt: Date };
  SolanaWalletChallenge: { id: string; userId: string; sessionId: string; address: string; message: string; expiresAt: Date };
  SolanaSwap: { id: string; userId: string; clientRequestId: string; providerRequestId: string; walletAddress: string; inputMint: string; outputMint: string; inputAmount: string; outputAmount: string; unsignedTransaction: string; quote: any; status: string; signature: string | null; error: string | null; expiresAt: Date; createdAt: Date; updatedAt: Date };
  SolanaAlertRule: { id: string; userId: string; name: string; kind: string; source: string; mint: string | null; threshold: number | null; delivery: string; minLiquidityUsd: number; maxDiscoveryAgeMinutes: number; cooldownMinutes: number; enabled: boolean; lastMatched: boolean; discoveryBaselineAt: Date | null; lastObservedAt: Date | null; lastCheckedAt: Date | null; lastTriggeredAt: Date | null; lastError: string | null; createdAt: Date; updatedAt: Date };
  SolanaAlertEvent: { id: string; userId: string; ruleId: string; dedupeKey: string; title: string; body: string; snapshot: any; createdAt: Date };
  User: {
    id: string;
    walletAddress: string | null;
    name: string;
    role: string;
    emergencyStop: boolean;
    inboxEnabled: boolean;
    disabled: boolean;
    createdAt: Date;
  };
  CreatorProfile: {
    id: string;
    userId: string;
    bio: string;
    stripeAccountId: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  };
  Session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
  WalletChallenge: {
    id: string;
    walletAddress: string;
    chainId: number;
    domain: string;
    message: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
  };
  Agent: {
    id: string;
    creatorId: string;
    name: string;
    description: string;
    category: string;
    market: string;
    tags: string[];
    cover: string;
    createdAt: Date;
  };
  AgentVersion: {
    id: string;
    agentId: string;
    number: number;
    config: unknown;
    status: string;
    priceCents: number;
    setupInstructions: string;
    reviewNote: string | null;
    testedAt: Date | null;
    createdAt: Date;
  };
  Listing: {
    id: string;
    agentId: string;
    versionId: string;
    publishedAt: Date;
  };
  Order: {
    id: string;
    buyerId: string;
    agentId: string;
    versionId: string;
    creatorId: string;
    amountCents: number;
    commissionCents: number;
    creatorCents: number;
    status: string;
    provider: string;
    providerSessionId: string | null;
    paymentIntentId: string | null;
    payoutStatus: string;
    checkoutAttempt: number;
    createdAt: Date;
  };
  Entitlement: {
    id: string;
    buyerId: string;
    agentId: string;
    versionId: string;
    orderId: string;
    status: string;
    environment: string;
    createdAt: Date;
  };
  PaymentEvent: {
    id: string;
    provider: string;
    orderId: string | null;
    type: string;
    processedAt: Date;
  };
  Payout: {
    id: string;
    creatorId: string;
    providerPayoutId: string;
    status: string;
    amountCents: number;
    currency: string;
    providerEventAt: Date;
    updatedAt: Date;
  };
  Review: {
    id: string;
    buyerId: string;
    agentId: string;
    rating: number;
    text: string;
    createdAt: Date;
  };
  Connection: {
    id: string;
    userId: string;
    provider: string;
    label: string;
    encryptedCredentials: string;
    recipient: string | null;
    verificationHash: string | null;
    verificationExpiresAt: Date | null;
    verifiedAt: Date | null;
    consentAt: Date | null;
    optedOutAt: Date | null;
    templateName: string | null;
    templateStatus: string;
    eligibility: string;
    createdAt: Date;
  };
  ConsentRecord: {
    id: string;
    userId: string;
    connectionId: string;
    action: string;
    text: string;
    createdAt: Date;
  };
  Instance: {
    id: string;
    userId: string;
    versionId: string;
    status: string;
    cashCents: number;
    lastSignalAt: Date | null;
    createdAt: Date;
  };
  Execution: {
    id: string;
    instanceId: string;
    bucket: string;
    status: string;
    source: string;
    marketTimestamp: Date;
    error: string | null;
    createdAt: Date;
  };
  Signal: {
    id: string;
    instanceId: string;
    executionId: string;
    symbol: string;
    action: string;
    price: number;
    reason: string;
    source: string;
    marketTimestamp: Date;
    createdAt: Date;
  };
  PaperTrade: {
    id: string;
    instanceId: string;
    signalId: string;
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    amountCents: number;
    status: string;
    createdAt: Date;
  };
  Position: {
    id: string;
    instanceId: string;
    symbol: string;
    quantity: number;
    entryPrice: number;
    costCents: number;
  };
  Notification: {
    id: string;
    userId: string;
    signalId: string | null;
    channel: string;
    title: string;
    body: string;
    status: string;
    readAt: Date | null;
    createdAt: Date;
  };
  Moderation: {
    id: string;
    adminId: string;
    versionId: string;
    action: string;
    note: string;
    createdAt: Date;
  };
  Report: {
    id: string;
    userId: string;
    agentId: string;
    reason: string;
    status: string;
    createdAt: Date;
  };
  Setting: {
    key: string;
    value: string;
  };
  TradingWorkspace: {
    userId: string;
    activeInstanceId: string | null;
    maxOrderCents: number;
    maxDailyCents: number;
    updatedAt: Date;
  };
  PersonalAgentChannel: {
    appUrl: string | null;
    id: string;
    userId: string;
    label: string;
    encryptedToken: string;
    tokenFingerprint: string;
    ownerId: string | null;
    agentId: string | null;
    pairingHash: string | null;
    pairingExpiresAt: Date | null;
    enabled: boolean;
    offset: string;
    leaseToken: string | null;
    leaseUntil: Date | null;
    nextPollAt: Date;
    lastPollAt: Date | null;
    lastMessageAt: Date | null;
    lastError: string | null;
    consentAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  AgentCommand: {
    id: string;
    userId: string;
    source: string;
    externalId: string;
    text: string;
    reply: string;
    status: string;
    intentId: string | null;
    channelId: string | null;
    recipientId: string | null;
    deliveryStatus: string;
    replyMessageId: string | null;
    createdAt: Date;
  };
  TradeIntent: {
    id: string;
    userId: string;
    instanceId: string;
    confirmationCode: string;
    side: string;
    symbol: string;
    amountCents: number;
    price: number;
    source: string;
    status: string;
    expiresAt: Date;
    filledAt: Date | null;
    createdAt: Date;
  };
  BrokerAuthorization: {
    userId: string;
    encryptedTokens: string;
    scope: string;
    expiresAt: Date;
    refreshLeaseUntil: Date | null;
    connectedAt: Date;
  };
  BrokerOAuthState: {
    id: string;
    userId: string;
    sessionId: string;
    encryptedVerifier: string;
    expiresAt: Date;
  };
}
export type ModelName = keyof ModelRows;

export const databaseSchema = {
  SolanaWalletWithdrawal: { columns:['id','userId','walletAddress','ownerAddress','mint','amount','signature','status','lastValidBlockHeight','error','createdAt','updatedAt'],primaryKey:['id'],unique:[['id'],['signature']],generatedId:true,updatedAt:['updatedAt'],json:[],relations:{} },
  SolanaTradingWallet: { columns:['userId','address','ownerAddress','encryptedSecret','createdAt'],primaryKey:['userId'],unique:[['userId'],['address']],generatedId:false,updatedAt:[],json:[],relations:{} },
  SolanaTradePermission: { columns:['id','userId','channelId','channelFingerprint','channelOwnerId','instanceId','ownerAddress','tradingAddress','tokenScope','allowedMints','perTradeLamports','dailyLamports','maxFeeLamports','slippageBps','expiresAt','revokedAt','revokeReason','consentMessage','signature','createdAt'],primaryKey:['id'],unique:[['id']],generatedId:true,updatedAt:[],json:[],relations:{} },
  SolanaPermissionChallenge: { columns:['id','userId','sessionId','purpose','address','message','payload','expiresAt'],primaryKey:['id'],unique:[['id'],['userId','purpose']],generatedId:true,updatedAt:[],json:['payload'],relations:{} },
  SolanaChatTrade: { columns:['id','userId','commandId','permissionId','walletAddress','side','mint','amount','budgetLamports','status','providerRequestId','signature','quote','error','createdAt','updatedAt'],primaryKey:['id'],unique:[['id'],['commandId'],['providerRequestId']],generatedId:true,updatedAt:['updatedAt'],json:['quote'],relations:{} },
  SolanaTokenDiscovery: { columns:['mint','firstSeenAt','lastSeenAt'],primaryKey:['mint'],unique:[['mint']],generatedId:false,updatedAt:[],json:[],relations:{} },
  SolanaWallet: { columns:['userId','address','verifiedAt'],primaryKey:['userId'],unique:[['userId'],['address']],generatedId:false,updatedAt:[],json:[],relations:{} },
  SolanaWalletChallenge: { columns:['id','userId','sessionId','address','message','expiresAt'],primaryKey:['id'],unique:[['id'],['userId']],generatedId:true,updatedAt:[],json:[],relations:{} },
  SolanaSwap: { columns:['id','userId','clientRequestId','providerRequestId','walletAddress','inputMint','outputMint','inputAmount','outputAmount','unsignedTransaction','quote','status','signature','error','expiresAt','createdAt','updatedAt'],primaryKey:['id'],unique:[['id'],['providerRequestId'],['userId','clientRequestId']],generatedId:true,updatedAt:['updatedAt'],json:['quote'],relations:{} },
  SolanaAlertRule: { columns:['id','userId','name','kind','source','mint','threshold','delivery','minLiquidityUsd','maxDiscoveryAgeMinutes','cooldownMinutes','enabled','lastMatched','discoveryBaselineAt','lastObservedAt','lastCheckedAt','lastTriggeredAt','lastError','createdAt','updatedAt'],primaryKey:['id'],unique:[['id']],generatedId:true,updatedAt:['updatedAt'],json:[],relations:{} },
  SolanaAlertEvent: { columns:['id','userId','ruleId','dedupeKey','title','body','snapshot','createdAt'],primaryKey:['id'],unique:[['id'],['ruleId','dedupeKey']],generatedId:true,updatedAt:[],json:['snapshot'],relations:{} },
  "User": {
    "columns": [
      "id",
      "walletAddress",
      "name",
      "role",
      "emergencyStop",
      "inboxEnabled",
      "disabled",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "walletAddress"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "profile": {
        "model": "CreatorProfile",
        "local": "id",
        "remote": "userId",
        "many": false,
        "nullable": true
      },
      "agents": {
        "model": "Agent",
        "local": "id",
        "remote": "creatorId",
        "many": true,
        "nullable": false
      },
      "sessions": {
        "model": "Session",
        "local": "id",
        "remote": "userId",
        "many": true,
        "nullable": false
      },
      "orders": {
        "model": "Order",
        "local": "id",
        "remote": "buyerId",
        "many": true,
        "nullable": false
      },
      "entitlements": {
        "model": "Entitlement",
        "local": "id",
        "remote": "buyerId",
        "many": true,
        "nullable": false
      },
      "instances": {
        "model": "Instance",
        "local": "id",
        "remote": "userId",
        "many": true,
        "nullable": false
      }
    }
  },
  "CreatorProfile": {
    "columns": [
      "id",
      "userId",
      "bio",
      "stripeAccountId",
      "chargesEnabled",
      "payoutsEnabled"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "userId"
      ],
      [
        "stripeAccountId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "user": {
        "model": "User",
        "local": "userId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "Session": {
    "columns": [
      "id",
      "userId",
      "expiresAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": false,
    "updatedAt": [],
    "json": [],
    "relations": {
      "user": {
        "model": "User",
        "local": "userId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "WalletChallenge": {
    "columns": [
      "id",
      "walletAddress",
      "chainId",
      "domain",
      "message",
      "expiresAt",
      "usedAt",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": false,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "Agent": {
    "columns": [
      "id",
      "creatorId",
      "name",
      "description",
      "category",
      "market",
      "tags",
      "cover",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "creator": {
        "model": "User",
        "local": "creatorId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "versions": {
        "model": "AgentVersion",
        "local": "id",
        "remote": "agentId",
        "many": true,
        "nullable": false
      },
      "listing": {
        "model": "Listing",
        "local": "id",
        "remote": "agentId",
        "many": false,
        "nullable": true
      },
      "orders": {
        "model": "Order",
        "local": "id",
        "remote": "agentId",
        "many": true,
        "nullable": false
      },
      "entitlements": {
        "model": "Entitlement",
        "local": "id",
        "remote": "agentId",
        "many": true,
        "nullable": false
      }
    }
  },
  "AgentVersion": {
    "columns": [
      "id",
      "agentId",
      "number",
      "config",
      "status",
      "priceCents",
      "setupInstructions",
      "reviewNote",
      "testedAt",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "agentId",
        "number"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [
      "config"
    ],
    "relations": {
      "agent": {
        "model": "Agent",
        "local": "agentId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "listing": {
        "model": "Listing",
        "local": "id",
        "remote": "versionId",
        "many": false,
        "nullable": true
      },
      "orders": {
        "model": "Order",
        "local": "id",
        "remote": "versionId",
        "many": true,
        "nullable": false
      },
      "entitlements": {
        "model": "Entitlement",
        "local": "id",
        "remote": "versionId",
        "many": true,
        "nullable": false
      },
      "instances": {
        "model": "Instance",
        "local": "id",
        "remote": "versionId",
        "many": true,
        "nullable": false
      }
    }
  },
  "Listing": {
    "columns": [
      "id",
      "agentId",
      "versionId",
      "publishedAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "agentId"
      ],
      [
        "versionId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "agent": {
        "model": "Agent",
        "local": "agentId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "version": {
        "model": "AgentVersion",
        "local": "versionId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "Order": {
    "columns": [
      "id",
      "buyerId",
      "agentId",
      "versionId",
      "creatorId",
      "amountCents",
      "commissionCents",
      "creatorCents",
      "status",
      "provider",
      "providerSessionId",
      "paymentIntentId",
      "payoutStatus",
      "checkoutAttempt",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "providerSessionId"
      ],
      [
        "paymentIntentId"
      ],
      [
        "buyerId",
        "agentId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "buyer": {
        "model": "User",
        "local": "buyerId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "agent": {
        "model": "Agent",
        "local": "agentId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "version": {
        "model": "AgentVersion",
        "local": "versionId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "Entitlement": {
    "columns": [
      "id",
      "buyerId",
      "agentId",
      "versionId",
      "orderId",
      "status",
      "environment",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "orderId"
      ],
      [
        "buyerId",
        "agentId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "buyer": {
        "model": "User",
        "local": "buyerId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "agent": {
        "model": "Agent",
        "local": "agentId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "version": {
        "model": "AgentVersion",
        "local": "versionId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "PaymentEvent": {
    "columns": [
      "id",
      "provider",
      "orderId",
      "type",
      "processedAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": false,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "Payout": {
    "columns": [
      "id",
      "creatorId",
      "providerPayoutId",
      "status",
      "amountCents",
      "currency",
      "providerEventAt",
      "updatedAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "providerPayoutId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [
      "updatedAt"
    ],
    "json": [],
    "relations": {}
  },
  "Review": {
    "columns": [
      "id",
      "buyerId",
      "agentId",
      "rating",
      "text",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "buyerId",
        "agentId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "Connection": {
    "columns": [
      "id",
      "userId",
      "provider",
      "label",
      "encryptedCredentials",
      "recipient",
      "verificationHash",
      "verificationExpiresAt",
      "verifiedAt",
      "consentAt",
      "optedOutAt",
      "templateName",
      "templateStatus",
      "eligibility",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "userId",
        "provider"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "ConsentRecord": {
    "columns": [
      "id",
      "userId",
      "connectionId",
      "action",
      "text",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "Instance": {
    "columns": [
      "id",
      "userId",
      "versionId",
      "status",
      "cashCents",
      "lastSignalAt",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "userId",
        "versionId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "user": {
        "model": "User",
        "local": "userId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "version": {
        "model": "AgentVersion",
        "local": "versionId",
        "remote": "id",
        "many": false,
        "nullable": false
      },
      "executions": {
        "model": "Execution",
        "local": "id",
        "remote": "instanceId",
        "many": true,
        "nullable": false
      },
      "signals": {
        "model": "Signal",
        "local": "id",
        "remote": "instanceId",
        "many": true,
        "nullable": false
      },
      "trades": {
        "model": "PaperTrade",
        "local": "id",
        "remote": "instanceId",
        "many": true,
        "nullable": false
      },
      "positions": {
        "model": "Position",
        "local": "id",
        "remote": "instanceId",
        "many": true,
        "nullable": false
      }
    }
  },
  "Execution": {
    "columns": [
      "id",
      "instanceId",
      "bucket",
      "status",
      "source",
      "marketTimestamp",
      "error",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "instanceId",
        "bucket"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "instance": {
        "model": "Instance",
        "local": "instanceId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "Signal": {
    "columns": [
      "id",
      "instanceId",
      "executionId",
      "symbol",
      "action",
      "price",
      "reason",
      "source",
      "marketTimestamp",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "executionId",
        "symbol"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "instance": {
        "model": "Instance",
        "local": "instanceId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "PaperTrade": {
    "columns": [
      "id",
      "instanceId",
      "signalId",
      "symbol",
      "side",
      "quantity",
      "price",
      "amountCents",
      "status",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "signalId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "instance": {
        "model": "Instance",
        "local": "instanceId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "Position": {
    "columns": [
      "id",
      "instanceId",
      "symbol",
      "quantity",
      "entryPrice",
      "costCents"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "instanceId",
        "symbol"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {
      "instance": {
        "model": "Instance",
        "local": "instanceId",
        "remote": "id",
        "many": false,
        "nullable": false
      }
    }
  },
  "Notification": {
    "columns": [
      "id",
      "userId",
      "signalId",
      "channel",
      "title",
      "body",
      "status",
      "readAt",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "signalId",
        "channel"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "Moderation": {
    "columns": [
      "id",
      "adminId",
      "versionId",
      "action",
      "note",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "Report": {
    "columns": [
      "id",
      "userId",
      "agentId",
      "reason",
      "status",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "Setting": {
    "columns": [
      "key",
      "value"
    ],
    "primaryKey": [
      "key"
    ],
    "unique": [
      [
        "key"
      ]
    ],
    "generatedId": false,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "TradingWorkspace": {
    "columns": [
      "userId",
      "activeInstanceId",
      "maxOrderCents",
      "maxDailyCents",
      "updatedAt"
    ],
    "primaryKey": [
      "userId"
    ],
    "unique": [
      [
        "userId"
      ]
    ],
    "generatedId": false,
    "updatedAt": [
      "updatedAt"
    ],
    "json": [],
    "relations": {}
  },
  "PersonalAgentChannel": {
    "columns": [
      "appUrl",
      "id",
      "userId",
      "label",
      "encryptedToken",
      "tokenFingerprint",
      "ownerId",
      "agentId",
      "pairingHash",
      "pairingExpiresAt",
      "enabled",
      "offset",
      "leaseToken",
      "leaseUntil",
      "nextPollAt",
      "lastPollAt",
      "lastMessageAt",
      "lastError",
      "consentAt",
      "createdAt",
      "updatedAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "userId"
      ],
      [
        "tokenFingerprint"
      ]
    ],
    "generatedId": true,
    "updatedAt": [
      "updatedAt"
    ],
    "json": [],
    "relations": {}
  },
  "AgentCommand": {
    "columns": [
      "id",
      "userId",
      "source",
      "externalId",
      "text",
      "reply",
      "status",
      "intentId",
      "channelId",
      "recipientId",
      "deliveryStatus",
      "replyMessageId",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "userId",
        "source",
        "externalId"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "TradeIntent": {
    "columns": [
      "id",
      "userId",
      "instanceId",
      "confirmationCode",
      "side",
      "symbol",
      "amountCents",
      "price",
      "source",
      "status",
      "expiresAt",
      "filledAt",
      "createdAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ],
      [
        "userId",
        "confirmationCode"
      ]
    ],
    "generatedId": true,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "BrokerAuthorization": {
    "columns": [
      "userId",
      "encryptedTokens",
      "scope",
      "expiresAt",
      "refreshLeaseUntil",
      "connectedAt"
    ],
    "primaryKey": [
      "userId"
    ],
    "unique": [
      [
        "userId"
      ]
    ],
    "generatedId": false,
    "updatedAt": [],
    "json": [],
    "relations": {}
  },
  "BrokerOAuthState": {
    "columns": [
      "id",
      "userId",
      "sessionId",
      "encryptedVerifier",
      "expiresAt"
    ],
    "primaryKey": [
      "id"
    ],
    "unique": [
      [
        "id"
      ]
    ],
    "generatedId": false,
    "updatedAt": [],
    "json": [],
    "relations": {}
  }
} as const;
