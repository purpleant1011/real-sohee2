export type OperatorPermission =
  | 'dashboard.read'
  | 'workspace.read'
  | 'workspace.support_session.create'
  | 'workspace.lifecycle.manage'
  | 'member.read'
  | 'member.manage'
  | 'agreement.read'
  | 'agreement.request'
  | 'agreement.verify'
  | 'agent.read'
  | 'agent.pause'
  | 'agent.resume'
  | 'agent.retry.request'
  | 'agent.reconcile.request'
  | 'agent.policy.change.request'
  | 'capability.read'
  | 'capability.change.request'
  | 'content.read'
  | 'content.manage'
  | 'channel.read'
  | 'channel.assist'
  | 'channel.disconnect.request'
  | 'channel.capability.override.request'
  | 'crm.read'
  | 'crm.support'
  | 'crm.send.request'
  | 'booking.read'
  | 'booking.manage.request'
  | 'publish.read'
  | 'publish.retry.request'
  | 'publish.reconcile.request'
  | 'billing.read'
  | 'revenue.read'
  | 'payment.verify'
  | 'refund.request'
  | 'subscription.manage'
  | 'credit.read'
  | 'credit.adjust.request'
  | 'credit.adjust.approve'
  | 'usage.read'
  | 'finops.read'
  | 'pricing.manage.request'
  | 'margin.policy.manage.request'
  | 'system.read'
  | 'incident.manage'
  | 'queue.reconcile.request'
  | 'deployment.read'
  | 'admin.read'
  | 'admin.invite'
  | 'admin.role.change.request'
  | 'session.revoke.request'
  | 'audit.read'
  | 'audit.export.request'
  | 'governance.read'
  | 'runtime_control.read'
  | 'runtime_control.change.request'
  | 'privacy.read'
  | 'data.delete.request'

export const operatorPermissions = [
  'dashboard.read',
  'workspace.read',
  'workspace.support_session.create',
  'workspace.lifecycle.manage',
  'member.read',
  'member.manage',
  'agreement.read',
  'agreement.request',
  'agreement.verify',
  'agent.read',
  'agent.pause',
  'agent.resume',
  'agent.retry.request',
  'agent.reconcile.request',
  'agent.policy.change.request',
  'capability.read',
  'capability.change.request',
  'content.read',
  'content.manage',
  'channel.read',
  'channel.assist',
  'channel.disconnect.request',
  'channel.capability.override.request',
  'crm.read',
  'crm.support',
  'crm.send.request',
  'booking.read',
  'booking.manage.request',
  'publish.read',
  'publish.retry.request',
  'publish.reconcile.request',
  'billing.read',
  'revenue.read',
  'payment.verify',
  'refund.request',
  'subscription.manage',
  'credit.read',
  'credit.adjust.request',
  'credit.adjust.approve',
  'usage.read',
  'finops.read',
  'pricing.manage.request',
  'margin.policy.manage.request',
  'system.read',
  'incident.manage',
  'queue.reconcile.request',
  'deployment.read',
  'admin.read',
  'admin.invite',
  'admin.role.change.request',
  'session.revoke.request',
  'audit.read',
  'audit.export.request',
  'governance.read',
  'runtime_control.read',
  'runtime_control.change.request',
  'privacy.read',
  'data.delete.request',
] as const satisfies readonly OperatorPermission[]
