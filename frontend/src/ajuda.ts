/**
 * Atalhos para a central de ajuda (frontend/ajuda, servida em /ajuda).
 *
 * Cada tela abre a seção do manual que fala dela. A âncora vem do título da
 * seção: mudou o título no manual, rode `node ajuda/ajuda.mjs conferir --codigo src`.
 */
const SECOES: Record<string, string> = {
  '/login': '/ajuda/lojista.html#2-1-entrar-pela-primeira-vez',
  '/trocar-senha': '/ajuda/lojista.html#2-3-trocar-a-senha-quando-quiser',
  '/lojista': '/ajuda/lojista.html#3-meu-consumo-a-tela-principal',
  '/lojista/historico': '/ajuda/lojista.html#4-historico-as-suas-faturas',
  '/lojista/alertas': '/ajuda/lojista.html#5-alertas-ser-avisado-sem-ficar-olhando-o-painel',
  '/admin': '/ajuda/administrador.html#3-dashboard-o-shopping-de-relance',
  '/admin/lojas': '/ajuda/administrador.html#4-lojas',
  '/admin/medidores': '/ajuda/administrador.html#5-medidores-relogios',
  '/admin/tarifas': '/ajuda/administrador.html#6-tarifas',
  '/admin/inquilinos': '/ajuda/administrador.html#7-lojistas-e-acessos',
  '/admin/faturamento': '/ajuda/administrador.html#8-faturamento-fechar-o-mes',
}

export function ajudaDaTela(caminho: string, role?: string): string {
  return SECOES[caminho] ?? (role === 'admin' ? '/ajuda/administrador.html' : '/ajuda/lojista.html')
}
