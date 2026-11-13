export type ActionError = {
  message: string
  requestId: string
}

export type ActionResult<T> =
  | {
      data: T
      error?: never
    }
  | {
      data?: never
      error: ActionError
    }
