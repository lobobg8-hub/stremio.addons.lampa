# MX — Stremio Addons + TorBox para Lampa Next Gen

Plugin que integra o protocolo de addons do Stremio com debrid via TorBox no Lampa Next Gen.

## Arquivos

- `lampa.mx.js` — código principal do plugin
- `manifest.json` — metadata (obrigatório pro Lampa reconhecer)

## Instalação

1. Suba os dois arquivos pro seu host (GitHub, Gist, IPTV, etc.) na mesma pasta
2. No Lampa Next Gen, vá em **Settings → Plugins → Adicionar plugin**
3. Cole a URL completa do `lampa.mx.js` (ex: `https://raw.githubusercontent.com/seuuser/seurepo/main/lampa.mx.js`)
4. Reinicie o app

## Configuração inicial

Após instalar:

1. **Settings → MX — TorBox API Key** → cole sua key do [torbox.app](https://torbox.app)
2. **Settings → MX — Usar TorBox** → deixe marcado
3. Volte ao menu principal → vai aparecer **"Stremio Catálogo"** e **"Gerenciar Addons Stremio"**

## Adicionar addons

1. Abra o menu **"Gerenciar Addons Stremio"**
2. Clique em **"+ Instalar novo addon"**
3. Cole a URL do manifest. Exemplos populares:
   - `https://torrentio.strem.fun/manifest.json`
   - `https://cinemeta.strem.io/manifest.json`
   - `https://opensubtitles.strem.io/manifest.json`
4. Aguarde o download do manifest e confirmação

## Como funciona

- **Catálogo:** o plugin pega o primeiro catálogo disponível do primeiro addon instalado
- **Streams:** ao clicar num item, busca streams de TODOS os addons instalados em paralelo
- **Debrid:** se for magnet, passa pelo TorBox automaticamente (até 3 em paralelo, 12 retries)
- **Seleção:** depois de converter, abre um seletor com todos os streams jogáveis

## Limites e caveats

- TorBox free: 10 torrents ativos por vez
- Cada conversão TorBox leva 5-30s (polling)
- Addons sem CORS habilitado vão falhar
- Polling pode estourar rate limit se rodar em paralelo com muitos addons

## Suporte

Em caso de bug, abra o DevTools (Settings → About → tap 7x no logo) e veja o console. Logs do plugin têm prefixo `[MX]`.
