'use client'

import { createContext, useContext, type ReactNode } from 'react'

type UserProfileContextValue = Readonly<{ avatarUrl: string | null }>

const UserProfileContext = createContext<UserProfileContextValue>({ avatarUrl: null })

export function UserProfileProvider({ avatarUrl, children }: Readonly<{
  avatarUrl: string | null
  children: ReactNode
}>) {
  return <UserProfileContext.Provider value={{ avatarUrl }}>{children}</UserProfileContext.Provider>
}

export function useUserProfile(): UserProfileContextValue {
  return useContext(UserProfileContext)
}
