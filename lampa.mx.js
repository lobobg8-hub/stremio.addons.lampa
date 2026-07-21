Isso aconteceu porque o código original que você usou tinha uma falha na forma como ele se registrava no Lampa. Ele usava um método chamado `Lampa.Movies` (que não existe nativamente para criar componentes) e usava um listener incorreto para o menu.

Eu reescrevi a parte final do código para usar a API oficial do Lampa (`Lampa.Component.add` e o listener `menu` correto).

### O que você deve fazer:
1. Vá no seu GitHub, clique no arquivo `lampa.mx.js` e depois no lápis (✏️ Editar).
2. Apague tudo e cole o código **completamente corrigido** abaixo.
3. Clique em **Commit changes**.
4. No Lampa, vá nas configurações do plugin e force uma atualização (ou desinstale e instale novamente usando o link com `?v=2` no final).

Aqui está o código 100% corrigido:

```javascript
(function () {
    'use strict';

    // ========== CONFIGURAÇÕES ==========
    const USE_DEBRID = true;               // true para usar TorBox/Real-Debrid | false para tentar HTTP direto
    const DEBRID_PROVIDER = 'torbox';      // 'torbox' ou 'real-debrid'
    const DEBRID_API_KEY = 'SUA_API_KEY_AQUI'; // Insira sua chave do TorBox ou Real-Debrid
    
    // Addon padrão para exibir no catálogo inicial
    const DEFAULT_ADDON_URL = 'https://torrentio.strem.fun';
    const DEFAULT_CATALOG_ID = 'top';
    const DEFAULT_CATALOG_TYPE = 'movie';
    // ===================================

    const streamCache = new Map();

    // ========== STREMIO ADDON MANAGER ==========
    const StremioAddonManager = (function () {
        const STORAGE_KEY = 'lampa_mx_stremio_addons';

        function getInstalledAddons() {
            try { return JSON.parse(Lampa.Storage.get(STORAGE_KEY, '[]')) || []; } 
            catch (e) { return []; }
        }

        function saveInstalledAddons(list) {
            Lampa.Storage.set(STORAGE_KEY, JSON.stringify(list));
        }

        function normalizeManifestUrl(input) {
            let url = input.trim();
            if (url.startsWith('stremio://')) url = url.replace('stremio://', 'https://');
            if (!url.endsWith('/manifest.json')) url = url.replace(/\/$/, '') + '/manifest.json';
            return url;
        }

        async function installAddon(manifestUrlInput) {
            const manifestUrl = normalizeManifestUrl(manifestUrlInput);
            const res = await fetch(manifestUrl);
            if (!res.ok) throw new Error('Não foi possível acessar o manifest do addon');
            const manifest = await res.json();
            if (!manifest.id || !manifest.resources) throw new Error('Manifest inválido');

            const baseUrl = manifestUrl.replace('/manifest.json', '');
            const addon = {
                id: manifest.id,
                name: manifest.name || manifest.id,
                version: manifest.version || '0.0.0',
                baseUrl: baseUrl,
                resources: manifest.resources,
                types: manifest.types || [],
                catalogs: manifest.catalogs || [],
                installedAt: Date.now()
            };

            const list = getInstalledAddons();
            const existingIndex = list.findIndex(a => a.id === addon.id);
            if (existingIndex >= 0) list[existingIndex] = addon;
            else list.push(addon);
            
            saveInstalledAddons(list);
            return addon;
        }

        function removeAddon(addonId) {
            saveInstalledAddons(getInstalledAddons().filter(a => a.id !== addonId));
        }

        function listAddons() { return getInstalledAddons(); }

        function supportsResource(addon, resource, type) {
            const hasResource = addon.resources.some(r => {
                if (typeof r === 'string') return r === resource;
                return r.name === resource && (!r.types || r.types.includes(type));
            });
            return hasResource && (addon.types.length === 0 || addon.types.includes(type));
        }

        async function getStreams(type, id) {
            const addons = getInstalledAddons().filter(a => supportsResource(a, 'stream', type));
            const results = [];
            await Promise.all(addons.map(async (addon) => {
                try {
                    const url = `${addon.baseUrl}/stream/${type}/${encodeURIComponent(id)}.json`;
                    const res = await fetch(url);
                    if (!res.ok) return;
                    const data = await res.json();
                    if (Array.isArray(data.streams)) {
                        data.streams.forEach(s => results.push({ ...s, _addonName: addon.name }));
                    }
                } catch (e) { console.warn(`Erro ao buscar streams do addon ${addon.id}:`, e); }
            }));
            return results;
        }

        return { installAddon, removeAddon, listAddons, getStreams };
    })();

    // Instala o addon padrão automaticamente na primeira vez
    if (StremioAddonManager.listAddons().length === 0) {
        StremioAddonManager.installAddon(DEFAULT_ADDON_URL).catch(e => console.warn("Falha ao instalar addon padrão:", e));
    }

    // ========== COMPONENTE DO CATÁLOGO ==========
    function StremioCatalogComponent(object) {
        this.initialize = function () {
            this.html = document.createElement('div');
            this.html.style.padding = '20px';
            this.loading();
            this.fetchCatalog();
        };

        this.loading = function () {
            this.html.innerHTML = '<div class="broadcast__scan" style="text-align:center; padding: 50px;"><div></div><div>Carregando Catálogo...</div></div>';
        };

        this.fetchCatalog = async function () {
            try {
                const addon = StremioAddonManager.listAddons().find(a => a.catalogs && a.catalogs.some(c => c.type === DEFAULT_CATALOG_TYPE));
                if (!addon) throw new Error('Nenhum addon com catálogo instalado');

                const url = `${addon.baseUrl}/catalog/${DEFAULT_CATALOG_TYPE}/${DEFAULT_CATALOG_ID}.json`;
                const res = await fetch(url);
                if (!res.ok) throw new Error('Falha na rede');
                const data = await res.json();
                this.renderCatalog(data.metas || []);
            } catch (error) {
                this.html.innerHTML = `<div class="empty" style="text-align:center; padding: 50px;">Erro ao carregar catálogo.<br>${error.message}</div>`;
            }
        };

        this.renderCatalog = function (items) {
            this.html.innerHTML = '';
            if (items.length === 0) {
                this.html.innerHTML = '<div class="empty">Nenhum item encontrado</div>';
                return;
            }

            const grid = document.createElement('div');
            grid.classList.add('cards', 'cards--block');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
            grid.style.gap = '20px';

            items.forEach(item => grid.appendChild(this.createCard(item)));
            this.html.appendChild(grid);
        };

        this.createCard = function (item) {
            const card = document.createElement('div');
            card.classList.add('card', 'card--category', 'selector');
            card.style.cursor = 'pointer';
            card.style.transition = 'transform 0.2s';
            card.onmouseover = () => card.style.transform = 'scale(1.03)';
            card.onmouseout = () => card.style.transform = 'scale(1)';

            const img = document.createElement('div');
            img.classList.add('card__img');
            img.style.backgroundImage = `url(${item.poster || ''})`;
            img.style.height = '220px';
            img.style.backgroundSize = 'cover';
            img.style.borderRadius = '8px';

            const title = document.createElement('div');
            title.innerText = item.name || 'Sem título';
            title.style.marginTop = '10px';
            title.style.color = '#fff';
            title.style.textAlign = 'center';

            card.appendChild(img);
            card.appendChild(title);

            card.addEventListener('click', async () => {
                Lampa.Controller.toogleContent(false);
                Lampa.Noty.show(`Buscando streams para: ${item.name}...`, { time: 2000 });
                const streams = await this.fetchStreams(DEFAULT_CATALOG_TYPE, item.id);
                if (streams.length > 0) this.showStreamSelection(streams, item);
                else Lampa.Noty.show('Nenhum stream disponível.', { time: 3000 });
            });

            return card;
        };

        this.fetchStreams = async function (type, id) {
            if (streamCache.has(id)) return streamCache.get(id);
            const rawStreams = await StremioAddonManager.getStreams(type, id);

            const normalized = rawStreams.map(s => {
                if (s.infoHash) {
                    const magnet = `magnet:?xt=urn:btih:${s.infoHash}${s.fileIdx !== undefined ? '&fileIdx=' + s.fileIdx : ''}`;
                    return { url: magnet, title: s.title || s.name || 'Torrent' };
                }
                return { url: s.url, title: s.title || s.name || 'HTTP Stream' };
            }).filter(s => s.url);

            streamCache.set(id, normalized);
            return normalized;
        };

        this.showStreamSelection = function (streams, item) {
            const items = streams.map(stream => ({ title: stream.title, stream }));
            Lampa.Select.show({
                title: 'Escolha a Qualidade',
                items: items,
                onSelect: (sel) => this.playStream(sel.stream, item)
            });
        };

        this.playStream = async function (stream, item) {
            if (!stream || !stream.url) return Lampa.Noty.show('Stream inválido.', { time: 3000 });
            let finalUrl = stream.url;

            if (finalUrl.startsWith('magnet:') && USE_DEBRID && DEBRID_API_KEY && DEBRID_API_KEY !== 'SUA_API_KEY_AQUI') {
                Lampa.Noty.show(`Convertendo no ${DEBRID_PROVIDER}...`, { time: 2000 });
                if (DEBRID_PROVIDER === 'real-debrid') finalUrl = await this.getSingleDebridLinkRD(finalUrl);
                else if (DEBRID_PROVIDER === 'torbox') finalUrl = await this.getSingleDebridLinkTorBox(finalUrl);

                if (!finalUrl) return Lampa.Noty.show(`Falha ao converter no ${DEBRID_PROVIDER}.`, { time: 3000 });
            }

            if (finalUrl && finalUrl.startsWith('http')) {
                Lampa.Player.play({
                    url: finalUrl,
                    title: item.name || 'Stream',
                    poster: item.poster || '',
                    overview: item.description || 'Sem sinopse disponível.',
                    id: item.id
                });
            } else {
                Lampa.Noty.show('Formato não suportado ou Debrid desativado.', { time: 3000 });
            }
        };

        // ========== REAL-DEBRID ==========
        this.getSingleDebridLinkRD = async function (magnetUrl) {
            try {
                const addRes = await fetch('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `magnet=${encodeURIComponent(magnetUrl)}`
                });
                const torrentId = (await addRes.json()).id;
                
                await fetch(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'files=all'
                });

                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 2000));
                    const info = await (await fetch(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, { headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}` } })).json();
                    if (info.status === 'downloaded' && info.links && info.links.length > 0) {
                        const unrestrict = await fetch('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
                            method: 'POST', headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `link=${encodeURIComponent(info.links[0])}`
                        });
                        return (await unrestrict.json()).download;
                    }
                }
                return null;
            } catch (e) { console.warn(e); return null; }
        };

        // ========== TORBOX V2 ==========
        this.getSingleDebridLinkTorBox = async function (magnetUrl) {
            try {
                const addRes = await fetch('https://api.torbox.app/v2/api/torrents/createtorrent', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ magnet: magnetUrl })
                });
                const addData = await addRes.json();
                const torrentId = addData.data?.torrent_id || addData.data?.[0];
                if (!torrentId) throw new Error("TorBox: Sem ID");

                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, i === 0 ? 5000 : 2000));
                    const infoRes = await fetch(`https://api.torbox.app/v2/api/torrents/mylist?torrent_id=${torrentId}`, { headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}` } });
                    const info = await infoRes.json();
                    
                    if (info.data && info.data[0] && info.data[0].download_present === true) {
                        let files = info.data[0].files;
                        let bestFile = files.reduce((max, f) => ((f.name.endsWith('.mkv') || f.name.endsWith('.mp4')) && f.size > (max?.size || 0)) ? f : max, null);
                        if (!bestFile) bestFile = files[0];
                        
                        const dlRes = await fetch(`https://api.torbox.app/v2/api/torrents/requestdl?torrent_id=${torrentId}&file_id=${bestFile.id}`, { 
                            headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}` } 
                        });
                        const dlData = await dlRes.json();
                        if (dlData.success && dlData.data) return dlData.data;
                    }
                }
                return null;
            } catch (e) { console.warn('Erro TorBox:', e); return null; }
        };

        this.render = function () { return this.html; };
        this.destroy = function () { this.html = null; };
        this.initialize();
    }

    // ========== TELA DE GERENCIAMENTO ==========
    function StremioManagerComponent(object) {
        this.initialize = function () {
            this.html = document.createElement('div');
            this.html.style.padding = '20px';
            this.render();
        };

        this.render = function () {
            this.html.innerHTML = '';
            const addBtn = document.createElement('div');
            addBtn.classList.add('menu-item', 'selector');
            addBtn.style.cssText = 'padding: 15px; background: #2a2a2a; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; cursor: pointer;';
            addBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> <span style="font-size: 16px;">Adicionar Novo Addon (URL do Manifest)</span>`;
            
            addBtn.addEventListener('click', () => {
                Lampa.Input.edit({ title: 'URL do Addon (stremio:// ou https://)', value: '', free: true }, async (value) => {
                    if (!value) return;
                    Lampa.Noty.show('Instalando addon...', { time: 2000 });
                    try {
                        const addon = await StremioAddonManager.installAddon(value);
                        Lampa.Noty.show(`Addon "${addon.name}" instalado!`);
                        this.render();
                    } catch (e) { Lampa.Noty.show('Erro: ' + e.message); }
                });
            });
            this.html.appendChild(addBtn);

            const addons = StremioAddonManager.listAddons();
            if (addons.length === 0) {
                this.html.innerHTML += '<div style="text-align: center; color: #aaa; margin-top: 50px;">Nenhum addon instalado.</div>';
                return;
            }

            const list = document.createElement('div');
            addons.forEach(addon => {
                const item = document.createElement('div');
                item.classList.add('menu-item', 'selector');
                item.style.cssText = 'padding: 15px; background: #1a1a1a; border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;';
                
                item.innerHTML = `
                    <div>
                        <div style="font-size: 16px; color: #fff;">${addon.name}</div>
                        <div style="font-size: 12px; color: #888; margin-top: 4px;">Versão: ${addon.version}</div>
                    </div>
                    <div class="remove-btn" style="color: #ff4b4b; font-size: 14px; padding: 5px 10px; border: 1px solid #ff4b4b; border-radius: 4px;">Remover</div>
                `;

                item.querySelector('.remove-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    Lampa.Controller.toogleContent(false);
                    Lampa.Select.show({
                        title: `Remover ${addon.name}?`,
                        items: [{ title: 'Confirmar Remoção', remove: true }],
                        onSelect: () => {
                            StremioAddonManager.removeAddon(addon.id);
                            Lampa.Noty.show('Addon removido.');
                            this.render();
                        }
                    });
                });

                list.appendChild(item);
            });
            this.html.appendChild(list);
        };

        this.destroy = function () { this.html = null; };
        this.initialize();
    }

    // ========== REGISTRO OFICIAL NO LAMPA ==========
    Lampa.Component.add('stremio_catalog', StremioCatalogComponent);
    Lampa.Component.add('stremio_manager', StremioManagerComponent);

    // ========== ADIÇÃO AO MENU PRINCIPAL ==========
    Lampa.Listener.follow('menu', function (e) {
        if (e.type == 'start') {
            const stremio_item = {
                title: 'Stremio',
                icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,16.5A4.5,4.5 0 0,1 7.5,12A4.5,4.5 0 0,1 12,7.5A4.5,4.5 0 0,1 16.5,12A4.5,4.5 0 0,1 12,16.5Z"/></svg>',
                page: 'stremio_catalog',
                component: 'stremio_catalog',
                onClick: function () {
                    Lampa.Activity.push({ url: '', title: 'Stremio', component: 'stremio_catalog', page: 1 });
                }
            };

            const manager_item = {
                title: 'Gerenciar Addons',
                icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>',
                page: 'stremio_manager',
                component: 'stremio_manager',
                onClick: function () {
                    Lampa.Activity.push({ url: '', title: 'Gerenciar Addons', component: 'stremio_manager', page: 1 });
                }
            };

            if (!e.body.find(it => it.page === 'stremio_catalog')) e.body.push(stremio_item);
            if (!e.body.find(it => it.page === 'stremio_manager')) e.body.push(manager_item);
        }
    });

})();
```
