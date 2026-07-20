[ Tutorial Completo: Plugin MX Stremio no Lampa Next Gen
Tutorial do zero — desde criar o repo no GitHub até assistir filme via TorBox.

🎯 O que esse plugin faz
Adiciona suporte a addons Stremio (Torrentio, Cinemeta, OpenSubtitles, etc.) ao Lampa Next Gen
Converte magnet links em links diretos via TorBox debrid
Catálogo de filmes/séries navegável dentro do Lampa
Gerenciador pra instalar/remover addons sem editar código
📋 Pré-requisitos
Conta no GitHub (grátis): https://github.com
App Lampa Next Gen instalado (Android, TV Box, ou Web)
Conta no TorBox com API Key: https://torbox.app
🚀 Passo 1: Criar o repositório no GitHub
1.1 — Cria o repo
1.
Acessa https://github.com/new
2.
Preenche:
Repository name: stremio.addons.lampa (ou o nome que tu quiser)
Description: "Plugin Stremio + TorBox para Lampa Next Gen"
Public ✅ (tem que ser público pra Lampa acessar)
Add a README file ✅ (marca essa opção)
3.
Clica em Create repository
1.2 — Espera o repo ser criado
Anota a URL: https://github.com/SEU_USUARIO/stremio.addons.lampa

📁 Passo 2: Subir os arquivos do plugin
2.1 — Cria o lampa.mx.js
1.
No teu repo, clica em Add file → Create new file (ou Upload files)
2.
Nome do arquivo: lampa.mx.js
3.
Cola o conteúdo que está em /workspace/lampa.mx.js (32 KB)
4.
Clica em Commit new file
2.2 — Cria o manifest.json
1.
Clica em Add file → Create new file de novo
2.
Nome: manifest.json
3.
Cola exatamente:
json

Copy
{

    "name": "MX Stremio",

    "version": "1.1.0",

    "description": "Stremio Addons + TorBox Debrid para Lampa Next Gen",

    "type": "plugin",

    "author": "MX Team",

    "url": "https://raw.githubusercontent.com/SEU_USUARIO/stremio.addons.lampa/main/lampa.mx.js"

}
⚠️ Substitui SEU_USUARIO pelo teu username do GitHub

1.
Clica em Commit new file
2.3 — Verifica a estrutura
Seu repo deve ter exatamente:

text

Copy
stremio.addons.lampa/

├── README.md         (criado automaticamente)

├── lampa.mx.js       (32 KB)

└── manifest.json     (275 bytes)
🧪 Passo 3: Testar as URLs
Abre no navegador e confirma que ambas respondem HTTP 200:

1.
Manifest: https://raw.githubusercontent.com/SEU_USUARIO/stremio.addons.lampa/main/manifest.json
Deve mostrar o JSON
2.
Plugin JS: https://raw.githubusercontent.com/SEU_USUARIO/stremio.addons.lampa/main/lampa.mx.js
Deve mostrar o código JS
⚠️ Importante: o GitHub às vezes demora 1-2 min pra servir o arquivo novo. Se der 404, espera e tenta de novo.

📱 Passo 4: Instalar no Lampa Next Gen
4.1 — Abre o app
4.2 — Vai em Extensões
Menu principal → Configurações (engrenagem) → Extensões ou Plugins

4.3 — Adiciona o plugin
1.
Clica em + Adicionar ou Adicionar plugin
2.
Cola a URL do manifest.json: https://raw.githubusercontent.com/SEU_USUARIO/stremio.addons.lampa/main/manifest.json
3.
Confirma
4.
Fecha e abre o Lampa (algumas mudanças só aplicam no boot)
4.4 — Confirma que apareceu
Na lista de extensões deve aparecer:

Nome: MX Stremio ✅
Versão: 1.1.0
Cadeado verde + 200 + Verificado
Sem ponto de exclamação vermelho ✅
🔑 Passo 5: Configurar a API Key do TorBox
5.1 — Pega a key no TorBox
1.
Acessa https://torbox.app
2.
Login (cria conta se não tiver — tem plano free)
3.
Vai em Settings → API
4.
Copia a API Key (string longa tipo torbox_xxxxx...)
5.2 — Cola no Lampa
1.
No Lampa: Configurações
2.
Procura a seção MX
3.
Toca em MX — TorBox API Key
4.
Cola a key
5.
MX — Usar TorBox → deixa marcado ✅
6.
Fecha e abre o Lampa de novo
5.3 — Confirmação
Na primeira execução após configurar, deve aparecer uma notificação:

"MX Stremio: configure sua API Key do TorBox em Settings → MX — TorBox API Key"

Se ela NÃO aparecer, tá tudo certo (só aparece uma vez e se a key não tá configurada).

📦 Passo 6: Instalar addons Stremio
6.1 — Abre o gerenciador
Volta pro menu principal → deve aparecer:

Stremio Catálogo
Gerenciar Addons Stremio
Toca em Gerenciar Addons Stremio.

6.2 — Instala o Torrentio (recomendado)
1.
Toca em + Instalar novo addon
2.
Cola: https://torrentio.strem.fun/manifest.json
3.
Confirma
4.
Aguarda "Addon Torrentio instalado com sucesso!"
6.3 — (Opcional) Instala o Cinemeta
Para ter catálogo navegável:

1.
+ Instalar novo addon → https://cinemeta.strem.io/manifest.json
2.
Confirma
6.4 — Lista de addons úteis
URL	Função
https://torrentio.strem.fun/manifest.json	Streams (torrents)
https://cinemeta.strem.io/manifest.json	Catálogo de filmes/séries
https://opensubtitles.strem.io/manifest.json	Legendas
https://animeo.strem.io/manifest.json	Anime
🎬 Passo 7: Assistir um filme
1.
Menu principal → Stremio Catálogo
2.
Toca em qualquer filme/série
3.
Aguarda "Buscando streams..." (5-30s)
4.
Se for magnet, vai aparecer "Convertendo X/Y via TorBox..." (mais 5-30s)
5.
Lista de streams aparece
6.
Toca no que quiser
7.
🎉 Player abre e reproduz
🐛 Solução de problemas
"Não puderam ser carregados" / "Sem título"
O plugin tá com erro de registro. Causas comuns:

1.
Arquivo manifest (1).json — Se o GitHub renomeou com espaço e parênteses, renomeia pra manifest.json
2.
URL errada dentro do manifest — Confere que o url aponta pro lampa.mx.js certo
3.
CORS — Testa abrindo a URL do .js no browser, deve mostrar código (não página de erro)
Fix rápido: deleta o plugin do Lampa → re-adiciona com a URL correta do manifest

Streams demoram muito e falham
1.
API Key errada — testa ela direto em https://api.torbox.app/v2/api/torrents/mylist
2.
Plano free esgotado — TorBox free limita a 10 torrents ativos
3.
CORS no addon — Torrentio e Cinemeta são CORS-friendly, outros podem não ser
Erro "Lampa is not defined"
O plugin foi carregado antes do Lampa estar pronto. Reinicia o app.

Card mostra "Sem título" com ponto de exclamação
Tu adicionou a URL do .js direto em vez do manifest.json. Remove e adiciona o manifest.

Como abrir o console pra debug
1.
Configurações → Sobre → toca 7x no logo do Lampa
2.
DevTools abre
3.
Aba Console → procura linhas com [MX]
📁 Estrutura final do projeto
text

Copy
stremio.addons.lampa/

├── README.md              (opcional, infos do projeto)

├── lampa.mx.js            (32 KB - código do plugin)

└── manifest.json          (275 bytes - metadata pro Lampa)
Total: ~35 KB

🔄 Atualizando o plugin
Quando sair versão nova:

1.
Edita o lampa.mx.js no GitHub
2.
Incrementa a versão no manifest.json (campo version)
3.
No Lampa, o plugin atualiza sozinho (Lampa faz cache por ~5 min)
🆘 Precisa de ajuda?
Copia e cola qualquer mensagem de erro do console que eu te ajudo a debugar.

Comandos úteis do console do Lampa:

javascript

Copy
// Ver addons instalados

Lampa.Storage.get('lampa_mx_stremio_addons')


// Ver config TorBox

Lampa.Storage.get('mx_torbox_key')


// Ver se plugin registrou

Lampa.Manifest.plugins
📜 Versões
v1.1.0 — Auto-registro via Lampa.Manifest.plugins + first-run check
v1.0.0 — Release inicial (Stremio Addons + TorBox debrid)
](https://matrix-internal.oss-us-east-1.aliyuncs.com/Mavis/311074154105470981/files/421955288879372/README.md?Expires=1784580222&OSSAccessKeyId=LTAI5tRgbJ63ieNp3YeXRwFH&Signature=EPrxY6%2BYTAHqhO8U3v4B5RhVqHM%3D)
