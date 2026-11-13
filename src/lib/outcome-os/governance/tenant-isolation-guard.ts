export class TenantIsolationViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationViolationError';
  }
}

export class TenantIsolationGuard {
  enforceTenantBoundary(params: {
    actorWorkspaceId: string;
    resourceWorkspaceId: string;
    action: string;
  }): void {
    if (params.actorWorkspaceId !== params.resourceWorkspaceId) {
      throw new TenantIsolationViolationError(
        `Cross-tenant access violation: actor [${params.actorWorkspaceId}] cannot perform [${params.action}] on resource [${params.resourceWorkspaceId}]`
      );
    }
  }

  maskSensitiveData(data: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};

    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'string') {
        // Phone number 010-XXXX-YYYY
        if (/^01[0-9]-[0-9]{3,4}-[0-9]{4}$/.test(val)) {
          masked[key] = val.replace(/^01([0-9])-([0-9]{3,4})-([0-9]{4})$/, '01$1-****-$3');
          continue;
        }
        // Resident Registration Number (RRN) XXXXXX-YYYYYYY
        if (/^[0-9]{6}-[0-9]{7}$/.test(val)) {
          masked[key] = val.replace(/^([0-9]{6})-[0-9]{7}$/, '$1-*******');
          continue;
        }
        // OAuth / Secret token (length > 20, or starts with EAAB)
        if (val.length >= 24 || val.startsWith('EAAB')) {
          masked[key] = `${val.slice(0, 6)}***${val.slice(-4)}`;
          continue;
        }
        masked[key] = val;
      } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        masked[key] = this.maskSensitiveData(val);
      } else {
        masked[key] = val;
      }
    }

    return masked;
  }
}
