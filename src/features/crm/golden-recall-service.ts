export interface GoldenRecallCustomer {
  customerId: string
  customerName: string
  customerHandle?: string
  lastVisitDate: string
  daysElapsed: number
  serviceName: string
  recallStatus: 'DUE' | 'UPCOMING' | 'OVERDUE'
  suggestedBenefit: string
  draftMessage: string
}

export class GoldenRecallService {
  /**
   * @deprecated Reservation rows cannot prove visits, workspace-scoped consent,
   * or approved benefits. Use prepareRevisitCandidates with explicit evidence.
   */
  static findRecallCandidates(reservations: readonly unknown[]): GoldenRecallCustomer[] {
    void reservations
    return []
  }
}
