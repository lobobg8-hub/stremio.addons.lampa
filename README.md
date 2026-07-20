# MX Stremio — Plugin Lampa Next Gen

Plugin que integra o protocolo de addons do Stremio com debrid via TorBox no Lampa Next Gen.

## 📁 Estrutura do repo

```
stremio.addons.lampa/
└── sal/
    ├── manifest.json     ← adicione esta URL no Lampa
    ├── lampa.mx.js       ← código do plugin (carregado via manifest)
    └── README.md
```

## 🚀 Instalação (TL;DR)

**Cole esta URL no Lampa Next Gen** (Configurações → Plugins → Adicionar plugin):

```
https://raw.githubusercontent.com/lobobg8-hub/stremio.addons.lampa/main/sal/manifest.json
```

## ⚙️ Configuração após instalar

1. **Settings → MX — TorBox API Key** → cole sua key do [torbox.app](https://torbox.app)
2. **Settings → MX — Usar TorBox** → deixe marcado
3. **Reinicie o Lampa**

## 📦 Adicionar addons Stremio

1. Volte pro menu principal → **Gerenciar Addons Stremio**
2. **+ Instalar novo addon**
3. Cole uma URL de manifest. Sugestões:
   - `https://torrentio.strem.fun/manifest.json` — streams (o melhor)
   - `https://cinemeta.strem.io/manifest.json` — catálogo de filmes/séries
   - `https://opensubtitles.strem.io/manifest.json` — legendas

## 🎬 Como usar

1. Menu principal → **Stremio Catálogo**
2. Toca num filme/série
3. Aguarda streams carregarem (5-30s se for via TorBox)
4. Escolhe um stream no seletor
5. 🎉

## 🐛 Solução de problemas

| Sintoma | Causa | Fix |
|---|---|---|
| Card "Sem título" + ⚠️ vermelho | URL errada (apontou pro .js direto) | Apague e adicione a URL do `manifest.json` |
| Não aparece menu "Stremio" | Plugin não carregou | Verifique a URL do manifest, recarregue |
| "Nenhum addon com catálogo" | Faltou instalar addon | Vá em Gerenciar Addons → instale Torrentio |
| Streams demoram e falham | API key inválida ou plano free esgotado | Teste a key em api.torbox.app |
| Erro de CORS | Addon bloqueia requests externos | Use addons CORS-friendly |
| `sal.js` antigo na raiz | Upload antigo do plugin v0 | Delete pelo GitHub |

## 📋 Logs / Debug

No console, procure `[MX]` para ver logs do plugin. Para abrir o DevTools:
- **Settings → Sobre** → toque 7x no logo
- Logs: `[MX][Stremio]`, `[MX][TorBox]`, `[MX] Plugin carregado`

## 🔖 Versão

- **v1.1.0** — Adicionado first-run check, manifest com campo `url` correto
- **v1.0.0** — Release inicial (Stremio Addons + TorBox debrid)
