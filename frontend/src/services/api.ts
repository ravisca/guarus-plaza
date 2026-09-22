import axios, { AxiosError, AxiosRequestConfig } from 'axios'

const api = axios.create({
  baseURL: '/api',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function sair(destino = '/login') {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  // Guarda onde a pessoa estava para voltar depois do login, em vez de largá-la
  // na raiz sem contexto.
  const atual = window.location.pathname + window.location.search
  const query = atual && atual !== '/login' ? `?redirect=${encodeURIComponent(atual)}` : ''
  window.location.href = `${destino}${query}`
}

/**
 * Renova a sessão em vez de expulsar o usuário.
 *
 * O JWT dura 15 minutos e existia uma rota `/auth/refresh` que **o frontend
 * nunca chamava**: no primeiro 401 o interceptor limpava o `localStorage` e
 * jogava para o login. Na prática, o admin abria o faturamento, conferia os
 * números e era desconectado sem explicação ao clicar em "Fechar Mês" dezesseis
 * minutos depois — perdendo o contexto inteiro.
 *
 * Uma renovação por vez: sem isto, cinco requisições paralelas levando 401
 * dispariam cinco refreshes.
 */
let renovacaoEmCurso: Promise<string | null> | null = null

async function renovarToken(): Promise<string | null> {
  if (!renovacaoEmCurso) {
    renovacaoEmCurso = axios
      .post('/api/auth/refresh', null, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      .then((r) => {
        const token = r.data.token as string
        localStorage.setItem('token', token)
        return token
      })
      .catch(() => null)
      .finally(() => {
        renovacaoEmCurso = null
      })
  }
  return renovacaoEmCurso
}

interface ConfigComRetry extends AxiosRequestConfig {
  _jaTentouRenovar?: boolean
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ codigo?: string }>) => {
    const config = error.config as ConfigComRetry | undefined
    const status = error.response?.status

    // Senha provisória: não adianta renovar token, o servidor vai recusar de
    // novo até a senha ser trocada.
    if (status === 403 && error.response?.data?.codigo === 'SENHA_PROVISORIA') {
      if (window.location.pathname !== '/trocar-senha') {
        window.location.href = '/trocar-senha'
      }
      return Promise.reject(error)
    }

    if (status === 401 && config && !config._jaTentouRenovar) {
      // A própria renovação falhando não pode entrar em laço.
      if (config.url?.includes('/auth/refresh') || config.url?.includes('/auth/login')) {
        sair()
        return Promise.reject(error)
      }

      config._jaTentouRenovar = true
      const novo = await renovarToken()
      if (novo) {
        config.headers = { ...config.headers, Authorization: `Bearer ${novo}` }
        return api.request(config)
      }
      sair()
    }

    return Promise.reject(error)
  },
)

/**
 * Mensagem de erro apresentável, vinda da API quando ela mandou uma.
 *
 * As telas faziam `POST` sem `catch` nenhum: o cadastro de loja falhava sempre
 * (mandava `tenantId: ''`) e o formulário simplesmente fechava, como se tivesse
 * dado certo.
 */
export function mensagemDeErro(err: unknown, padrao = 'Não foi possível concluir a operação.'): string {
  const erro = err as AxiosError<{ error?: string; campos?: Record<string, string[]>; referencia?: string }>
  const corpo = erro?.response?.data

  if (corpo?.campos) {
    const detalhes = Object.entries(corpo.campos)
      .map(([campo, msgs]) => `${campo}: ${(msgs || []).join(', ')}`)
      .join(' · ')
    if (detalhes) return `${corpo.error || 'Dados inválidos'} — ${detalhes}`
  }

  if (corpo?.error) {
    // A referência é o que permite achar a linha correspondente no log.
    return corpo.referencia ? `${corpo.error} (ref. ${corpo.referencia})` : corpo.error
  }

  if (erro?.response?.status === 429) return 'Muitas tentativas. Aguarde um instante e tente de novo.'
  if (!erro?.response) return 'Sem resposta do servidor. Verifique a conexão.'

  return padrao
}

export default api
