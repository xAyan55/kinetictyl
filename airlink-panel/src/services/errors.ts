export class InsufficientCoinsError extends Error {
  public readonly balance: number;
  public readonly required: number;

  constructor(balance: number, required: number) {
    super(`Insufficient coins: have ${balance}, need ${required}`);
    this.name = 'InsufficientCoinsError';
    this.balance = balance;
    this.required = required;
  }
}

export class ResourceLimitExceededError extends Error {
  public readonly resource: string;
  public readonly available: number;
  public readonly requested: number;

  constructor(resource: string, available: number, requested: number) {
    super(`Resource limit exceeded for ${resource}: available ${available}, requested ${requested}`);
    this.name = 'ResourceLimitExceededError';
    this.resource = resource;
    this.available = available;
    this.requested = requested;
  }
}

export class CouponExpiredError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(`Coupon '${code}' has expired`);
    this.name = 'CouponExpiredError';
    this.code = code;
  }
}

export class CouponNotYetActiveError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(`Coupon '${code}' is not yet active`);
    this.name = 'CouponNotYetActiveError';
    this.code = code;
  }
}

export class CouponFullyRedeemedError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(`Coupon '${code}' has reached its usage limit`);
    this.name = 'CouponFullyRedeemedError';
    this.code = code;
  }
}

export class CouponPerUserLimitReachedError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(`Coupon '${code}' already redeemed by this user`);
    this.name = 'CouponPerUserLimitReachedError';
    this.code = code;
  }
}

export class CouponDisabledError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(`Coupon '${code}' is disabled`);
    this.name = 'CouponDisabledError';
    this.code = code;
  }
}

export class CouponNotFoundError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(`Coupon '${code}' not found`);
    this.name = 'CouponNotFoundError';
    this.code = code;
  }
}

export class PermissionDeniedError extends Error {
  public readonly required: string;

  constructor(required: string) {
    super(`Permission denied: ${required} required`);
    this.name = 'PermissionDeniedError';
    this.required = required;
  }
}

export class ConcurrentModificationError extends Error {
  public readonly entity: string;

  constructor(entity: string) {
    super(`Concurrent modification detected on ${entity}`);
    this.name = 'ConcurrentModificationError';
    this.entity = entity;
  }
}

export class ServerSuspendedError extends Error {
  public readonly serverId: string;

  constructor(serverId: string) {
    super(`Server ${serverId} is suspended`);
    this.name = 'ServerSuspendedError';
    this.serverId = serverId;
  }
}

export class ProductLimitReachedError extends Error {
  public readonly productId: number;

  constructor(productId: number) {
    super(`Purchase limit reached for product ${productId}`);
    this.name = 'ProductLimitReachedError';
    this.productId = productId;
  }
}

export class WalletNotFoundError extends Error {
  public readonly userId: number;

  constructor(userId: number) {
    super(`Wallet not found for user ${userId}`);
    this.name = 'WalletNotFoundError';
    this.userId = userId;
  }
}

export class ServerNotFoundError extends Error {
  public readonly serverId: string;

  constructor(serverId: string) {
    super(`Server ${serverId} not found`);
    this.name = 'ServerNotFoundError';
    this.serverId = serverId;
  }
}

export class StoreProductNotFoundError extends Error {
  public readonly productId: number;

  constructor(productId: number) {
    super(`Store product ${productId} not found`);
    this.name = 'StoreProductNotFoundError';
    this.productId = productId;
  }
}

export class ProductDisabledError extends Error {
  public readonly productId: number;

  constructor(productId: number) {
    super(`Store product ${productId} is disabled`);
    this.name = 'ProductDisabledError';
    this.productId = productId;
  }
}

export class InvalidResourceTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidResourceTargetError';
  }
}
