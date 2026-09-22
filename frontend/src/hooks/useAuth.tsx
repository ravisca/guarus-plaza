import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import api from '../services/api'

interface User {
  id: string
  nome: string
  email: string
  role: 'admin' | 'lojista'
  senhaProvisoria?: boolean
  tenantNome?: string | null
}

export interface Loja {
  id: string
  nome: string
  numeroLoja: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  /**
   * Lojas que este usuário enxerga. Existe porque a tela do lojista mandava
   * `user.id` no lugar de um `storeId` — funcionava só porque o backend
   * ignorava o valor. Com um inquilino que tem mais de uma loja, isso passava a
   * mostrar sempre a primeira, sem avisar que havia outra.
   */
  lojas: Loja[]
  lojaAtual: Loja | null
  selecionarLoja: (id: string) => void
  login: (token: string, user: User) => void
  logout: () => void
  carregando: boolean
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

const CHAVE_LOJA = 'lojaSelecionada'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [lojas, setLojas] = useState<Loja[]>([])
  const [lojaId, setLojaId] = useState<string | null>(() => localStorage.getItem(CHAVE_LOJA))
  const [carregando, setCarregando] = useState(!!localStorage.getItem('token'))

  // Quem sou eu e o que enxergo — perguntado ao servidor, não deduzido do que
  // está guardado no navegador.
  useEffect(() => {
    if (!token) {
      setCarregando(false)
      return
    }
    api.get('/auth/me')
      .then(({ data }) => {
        if (data.user) {
          setUser(data.user)
          localStorage.setItem('user', JSON.stringify(data.user))
        }
        setLojas(data.lojas || [])
      })
      .catch(() => { /* o interceptor já trata 401 */ })
      .finally(() => setCarregando(false))
  }, [token])

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem(CHAVE_LOJA)
    setToken(null)
    setUser(null)
    setLojas([])
    setLojaId(null)
  }

  const selecionarLoja = (id: string) => {
    localStorage.setItem(CHAVE_LOJA, id)
    setLojaId(id)
  }

  const lojaAtual = lojas.find((l) => l.id === lojaId) ?? lojas[0] ?? null

  return (
    <AuthContext.Provider
      value={{ user, token, lojas, lojaAtual, selecionarLoja, login, logout, carregando }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
