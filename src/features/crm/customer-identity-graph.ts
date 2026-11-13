import { randomUUID } from 'node:crypto';
import type { CanonicalCustomer, ChannelIdentity, ChannelIdentityType } from './types';

/**
 * Domain-only test helper. Production identity authority is the server-side
 * customer-identity-repository backed by customer_conversations, never this Map.
 */
export class CustomerIdentityResolutionGraph {
  public readonly isDomainOnly = true;
  private customers = new Map<string, CanonicalCustomer>();
  private identityIndex = new Map<string, string>();

  constructor() {
    if (process.env.NODE_ENV === 'production') throw new Error('CRM_DOMAIN_ONLY');
  }

  private makeKey(workspaceId: string, type: ChannelIdentityType, value: string): string {
    if (!workspaceId.trim() || !value.trim()) throw new Error('CRM_IDENTITY_SCOPE_REQUIRED');
    return JSON.stringify([workspaceId, type, value.trim().toLowerCase()]);
  }

  private scopedCustomer(customerId: string, workspaceId: string): CanonicalCustomer | undefined {
    const customer = this.customers.get(customerId);
    return customer?.workspaceId === workspaceId ? customer : undefined;
  }

  /** 새 고객 식별/전화번호 힌트 결속은 같은 사업장 안에서만 허용한다. */
  resolveAndLink(params: {
    workspaceId: string;
    identity: ChannelIdentity;
    customerHints?: { name?: string; phone?: string; tags?: string[]; notes?: string };
  }): CanonicalCustomer {
    const { workspaceId, identity, customerHints } = params;
    const key = this.makeKey(workspaceId, identity.type, identity.value);
    const existingCustomerId = this.identityIndex.get(key);
    const existing = existingCustomerId ? this.scopedCustomer(existingCustomerId, workspaceId) : undefined;
    if (existing) {
      const existingIdent = existing.identities.find(
        item => this.makeKey(workspaceId, item.type, item.value) === key,
      );
      if (existingIdent) {
        existingIdent.lastSeenAt = identity.lastSeenAt || new Date().toISOString();
        existingIdent.confidenceScore = Math.max(existingIdent.confidenceScore, identity.confidenceScore);
      } else {
        existing.identities.push(structuredClone(identity));
      }
      if (customerHints?.name && !existing.primaryName) existing.primaryName = customerHints.name;
      if (customerHints?.phone && !existing.primaryPhone) {
        const phoneKey = this.makeKey(workspaceId, 'PHONE_NUMBER', customerHints.phone);
        const linkedId = this.identityIndex.get(phoneKey);
        if (!linkedId || linkedId === existing.customerId) {
          existing.primaryPhone = customerHints.phone;
          this.identityIndex.set(phoneKey, existing.customerId);
        }
      }
      existing.updatedAt = new Date().toISOString();
      return structuredClone(existing);
    }

    if (customerHints?.phone) {
      const phoneKey = this.makeKey(workspaceId, 'PHONE_NUMBER', customerHints.phone);
      const matchedId = this.identityIndex.get(phoneKey);
      const matched = matchedId ? this.scopedCustomer(matchedId, workspaceId) : undefined;
      if (matched) {
        matched.identities.push(structuredClone(identity));
        this.identityIndex.set(key, matched.customerId);
        matched.updatedAt = new Date().toISOString();
        return structuredClone(matched);
      }
    }

    const customerId = `cust_${randomUUID()}`;
    const now = new Date().toISOString();
    const customer: CanonicalCustomer = {
      customerId, workspaceId, primaryName: customerHints?.name,
      primaryPhone: customerHints?.phone || (identity.type === 'PHONE_NUMBER' ? identity.value : undefined),
      identities: [structuredClone(identity)], createdAt: now, updatedAt: now,
      tags: [...(customerHints?.tags || [])], notes: customerHints?.notes,
    };
    this.customers.set(customerId, customer);
    this.identityIndex.set(key, customerId);
    if (customer.primaryPhone) {
      this.identityIndex.set(this.makeKey(workspaceId, 'PHONE_NUMBER', customer.primaryPhone), customerId);
    }
    return structuredClone(customer);
  }

  /** 구형 무범위 호출과 사업장 간 병합은 예외로 차단한다. */
  mergeCustomers(sourceCustomerId: string, targetCustomerId: string, workspaceId?: string): CanonicalCustomer {
    if (!workspaceId?.trim()) throw new Error('CRM_IDENTITY_SCOPE_REQUIRED');
    const source = this.scopedCustomer(sourceCustomerId, workspaceId);
    const target = this.scopedCustomer(targetCustomerId, workspaceId);
    if (!source || !target) throw new Error('CRM_CUSTOMER_NOT_FOUND_IN_WORKSPACE');
    if (sourceCustomerId === targetCustomerId) return structuredClone(target);

    for (const [key, customerId] of this.identityIndex) {
      if (customerId === sourceCustomerId) this.identityIndex.set(key, targetCustomerId);
    }
    for (const ident of source.identities) {
      const key = this.makeKey(workspaceId, ident.type, ident.value);
      if (!target.identities.some(item => this.makeKey(workspaceId, item.type, item.value) === key)) {
        target.identities.push(structuredClone(ident));
      }
    }
    target.primaryName = target.primaryName || source.primaryName;
    target.primaryPhone = target.primaryPhone || source.primaryPhone;
    target.tags = Array.from(new Set([...target.tags, ...source.tags]));
    target.updatedAt = new Date().toISOString();
    this.customers.delete(sourceCustomerId);
    return structuredClone(target);
  }

  lookupByIdentity(type: ChannelIdentityType, value: string, workspaceId?: string): CanonicalCustomer | undefined {
    if (!workspaceId?.trim()) return undefined;
    const customerId = this.identityIndex.get(this.makeKey(workspaceId, type, value));
    const customer = customerId ? this.scopedCustomer(customerId, workspaceId) : undefined;
    return customer ? structuredClone(customer) : undefined;
  }

  getCustomer(customerId: string, workspaceId?: string): CanonicalCustomer | undefined {
    if (!workspaceId?.trim()) return undefined;
    const customer = this.scopedCustomer(customerId, workspaceId);
    return customer ? structuredClone(customer) : undefined;
  }
}
