import { createContext, useContext } from 'react'

export interface Account {
  userId: string
  email: string
  /** 프로필의 표시 이름. 새 실험의 담당자 칸을 미리 채우는 데 쓴다. */
  displayName: string
  setDisplayName: (name: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
}

/** 서버 저장소를 쓸 때 로그인한 계정. 로컬 저장소(로그인 없음)에서는 null이다. */
export const AccountContext = createContext<Account | null>(null)

export function useAccount(): Account | null {
  return useContext(AccountContext)
}
