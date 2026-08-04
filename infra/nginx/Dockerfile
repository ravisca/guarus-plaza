# Nginx de borda com a config embutida na imagem.
#
# Não usar bind mount para entregar o coolify.conf: no build pack dockercompose
# do Coolify o build acontece a partir de /artifacts/<deployment> e a árvore do
# repositório não fica em /data/coolify/applications/<uuid>, então o Docker cria
# um diretório vazio no lugar do arquivo e o container morre com
# "failed to create shim task ... error mounting ... to rootfs".
#
# Com a config na imagem, o deploy não depende do layout de disco do servidor.
FROM nginx:alpine
COPY coolify.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
