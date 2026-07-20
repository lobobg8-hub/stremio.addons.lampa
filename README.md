(function() {
    'use strict';

    // =================================================================
    //  CONFIGURAÇÕES GLOBAIS
    // =================================================================
    const USE_DEBRID = true;                     // true para usar TorBox
    const DEBRID_API_KEY = 'SUA_API_KEY_AQUI';   // Obtenha em torbox.app
    // =================================================================

    // =================================================================
    //  STREMIO ADDON MANAGER (persistência, instalação, listagem)
    // =================================================================
    const StremioAddonManager = (function() {
        const STORAGE_KEY = 'lampa_mx_stremio_addons';

        function getInstalledAddons() {
            try {
                return JSON.parse(Lampa.Storage.get(STORAGE_KEY, '[]'));
            } catch (e) {
                return [];
            }
        }

        function saveInstalledAddons(list) {
            Lampa.Storage.set(STORAGE_KEY, JSON.stringify(list));
        }

        function normalizeManifestUrl(input) {
            let url = input.trim();
            if (url.startsWith('stremio://')) {
                url = url.replace('stremio://', 'https://');
            }
            if (!url.endsWith('manifest.json')) {
                url = url.replace(/\/$/, '') + '/manifest.json';
            }
            return url;
        }

        async function installAddon(manifestUrlInput) {
            const manifestUrl = normalizeManifestUrl(manifestUrlInput);
            const res = await fetch(manifestUrl);
            if (!res.ok) throw new Error('Não foi possível acessar o manifest do addon');
            const manifest = await res.json();
            if (!manifest.id || !manifest.resources) {
                throw new Error('Manifest inválido: faltam campos obrigatórios');
            }
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
            if (existingIndex >= 0) {
                list[existingIndex] = addon;
            } else {
                list.push(addon);
            }
            saveInstalledAddons(list);
            return addon;
        }

        function removeAddon(addonId) {
            const list = getInstalledAddons().filter(a => a.id !== addonId);
            saveInstalledAddons(list);
        }

        function listAddons() {
            return getInstalledAddons();
        }

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
                        data.streams.forEach(s => {
                            results.push({
                                ...s,
                                _addonId: addon.id,
                                _addonName: addon.name
                            });
                        });
                    }
                } catch (e) {
                    console.warn(`Erro ao buscar streams do addon ${addon.id}:`, e);
                }
            }));
            return results;
        }

        async function getCatalog(addon, type, catalogId, extra = {}) {
            let url = `${addon.baseUrl}/catalog/${type}/${catalogId}.json`;
            const extraParams = Object.entries(extra)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                .join('&');
            if (extraParams) url = url.replace('.json', `/${extraParams}.json`);
            const res = await fetch(url);
            if (!res.ok) throw new Error('Falha ao buscar catálogo');
            return res.json();
        }

        return {
            installAddon,
            removeAddon,
            listAddons,
            getStreams,
            getCatalog,
            supportsResource
        };
    })();

    // =================================================================
    //  CONVERSÃO TORBOX (API v2) – polling com seleção de vídeo
    // =================================================================
    async function convertMagnetToDebrid(streams) {
        const debridStreams = [];
        const MAX_RETRIES = 12;
        const INITIAL_DELAY = 5000;
        const RETRY_DELAY = 2000;

        const magnetStreams = streams.filter(s => s.url && s.url.startsWith('magnet:'));

        // Processa em chunks para não estourar rate limit
        const chunkSize = 3;
        for (let i = 0; i < magnetStreams.length; i += chunkSize) {
            const chunk = magnetStreams.slice(i, i + chunkSize);
            const results = await Promise.allSettled(
                chunk.map(stream => processSingleTorBox(stream, MAX_RETRIES, INITIAL_DELAY, RETRY_DELAY))
            );
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    debridStreams.push(result.value);
                }
            }
            if (i + chunkSize < magnetStreams.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        const httpStreams = streams.filter(s => s.url && !s.url.startsWith('magnet:'));
        debridStreams.push(...httpStreams);
        return debridStreams;
    }

    async function processSingleTorBox(stream, maxRetries, initialDelay, retryDelay) {
        const magnet = stream.url;

        // 1. Adicionar magnet
        const addResponse = await fetch('https://api.torbox.app/v2/api/torrents/createtorrent', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DEBRID_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ magnet: magnet })
        });
        if (!addResponse.ok) {
            const errText = await addResponse.text();
            throw new Error(`TorBox add magnet falhou: ${errText}`);
        }
        const addData = await addResponse.json();
        if (!addData.success) {
            throw new Error(`TorBox erro: ${addData.message || 'desconhecido'}`);
        }
        const torrentId = addData.data.torrent_id;

        // 2. Polling com backoff
        let downloadUrl = null;
        let retries = 0;
        let delay = initialDelay;

        while (retries < maxRetries) {
            await new Promise(r => setTimeout(r, delay));

            const infoResponse = await fetch(
                'https://api.torbox.app/v2/api/torrents/mylist',
                { headers: { 'Authorization': `Bearer ${DEBRID_API_KEY}` } }
            );
            if (!infoResponse.ok) {
                console.warn('Erro ao buscar mylist, tentando novamente...');
                delay = retryDelay;
                retries++;
                continue;
            }
            const infoData = await infoResponse.json();
            if (!infoData.success || !infoData.data) {
                console.warn('Resposta mylist inválida, tentando novamente...');
                delay = retryDelay;
                retries++;
                continue;
            }

            const torrentInfo = infoData.data.find(t => t.torrent_id === torrentId);
            if (!torrentInfo) {
                delay = retryDelay;
                retries++;
                continue;
            }

            const isReady = torrentInfo.cached === true ||
                            torrentInfo.download_present === true ||
                            (torrentInfo.progress === 1 && torrentInfo.download_finished === true);

            if (isReady) {
                const files = torrentInfo.files || [];
                const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                let bestFile = null;
                const videoFiles = files.filter(f =>
                    videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
                );
                if (videoFiles.length > 0) {
                    bestFile = videoFiles.reduce((a, b) => (a.size > b.size ? a : b));
                } else if (files.length > 0) {
                    bestFile = files.reduce((a, b) => (a.size > b.size ? a : b));
                }
                if (!bestFile) {
                    throw new Error('Nenhum arquivo válido encontrado no torrent');
                }

                const dlResponse = await fetch(
                    'https://api.torbox.app/v2/api/torrents/requestdl',
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${DEBRID_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            torrent_id: torrentId,
                            file_id: bestFile.id
                        })
                    }
                );
                if (!dlResponse.ok) {
                    throw new Error(`Falha ao gerar link: ${dlResponse.status}`);
                }
                const dlData = await dlResponse.json();
                if (!dlData.success) {
                    throw new Error(`Erro no requestdl: ${dlData.message || ''}`);
                }
                downloadUrl = dlData.data?.url || dlData.data?.download_url || dlData.data?.link;
                if (!downloadUrl) {
                    throw new Error('URL de download não retornada');
                }
                break; // sucesso
            }

            delay = Math.min(retryDelay * (retries + 1), 10000);
            retries++;
        }

        if (!downloadUrl) {
            throw new Error(`Tempo esgotado para o torrent ${torrentId}`);
        }

        return {
            url: downloadUrl,
            title: stream.title || 'Stream via TorBox',
            _addonId: stream._addonId,
            _addonName: stream._addonName
        };
    }

    // =================================================================
    //  COMPONENTE DE CATÁLOGO (exibe pôsteres e reproduz)
    // =================================================================
    function StremioCatalogComponent(object) {
        this.initialize = function() {
            this.html = document.createElement('div');
            this.html.style.padding = '20px';
            this.loading();
            this.loadCatalog();
        };

        this.loading = function() {
            this.html.innerHTML = '<div class="broadcast__scan" style="text-align:center; padding: 50px;"><div></div><div>Carregando catálogo...</div></div>';
        };

        this.loadCatalog = async function() {
            try {
                const addons = StremioAddonManager.listAddons();
                // Pega o primeiro addon que oferece catálogo de filmes (ou séries)
                const catalogAddon = addons.find(a =>
                    StremioAddonManager.supportsResource(a, 'catalog', 'movie') ||
                    StremioAddonManager.supportsResource(a, 'catalog', 'series')
                );
                if (!catalogAddon) {
                    this.html.innerHTML = '<div class="empty" style="text-align:center; padding: 50px;">Nenhum addon com catálogo instalado. Vá em "Gerenciar Addons" para adicionar.</div>';
                    return;
                }

                // Usa o primeiro catálogo disponível
                let catalogId = 'top';
                let catalogType = 'movie';
                if (catalogAddon.catalogs && catalogAddon.catalogs.length > 0) {
                    const first = catalogAddon.catalogs[0];
                    catalogType = first.type || 'movie';
                    catalogId = first.id || 'top';
                }

                const data = await StremioAddonManager.getCatalog(catalogAddon, catalogType, catalogId);
                this.renderCatalog(data.metas || [], catalogAddon);
            } catch (error) {
                this.html.innerHTML = `<div class="empty" style="text-align:center; padding: 50px;">Erro ao carregar catálogo: ${error.message}</div>`;
            }
        };

        this.renderCatalog = function(items, addon) {
            this.html.innerHTML = '';
            if (items.length === 0) {
                this.html.innerHTML = '<div class="empty">Nenhum item encontrado</div>';
                return;
            }

            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
            grid.style.gap = '20px';

            items.forEach(item => {
                const card = document.createElement('div');
                card.style.cursor = 'pointer';
                card.style.transition = 'transform 0.2s';
                card.onmouseover = () => card.style.transform = 'scale(1.03)';
                card.onmouseout = () => card.style.transform = 'scale(1)';

                const img = document.createElement('div');
                img.style.backgroundImage = `url(${item.poster || 'https://via.placeholder.com/300x450?text=No+Poster'})`;
                img.style.height = '220px';
                img.style.backgroundSize = 'cover';
                img.style.backgroundPosition = 'center';
                img.style.borderRadius = '8px';

                const title = document.createElement('div');
                title.innerText = item.name || 'Sem título';
                title.style.marginTop = '10px';
                title.style.color = '#fff';
                title.style.fontWeight = '500';
                title.style.textAlign = 'center';

                const year = document.createElement('div');
                year.style.fontSize = '12px';
                year.style.color = '#aaa';
                year.style.textAlign = 'center';
                year.innerText = item.year || '';

                card.appendChild(img);
                card.appendChild(title);
                if (item.year) card.appendChild(year);

                card.addEventListener('click', () => {
                    this.playItem(item, addon);
                });

                grid.appendChild(card);
            });

            this.html.appendChild(grid);
        };

        this.playItem = async function(item, addon) {
            const type = item.type || 'movie'; // 'movie' ou 'series'
            const id = item.id; // ex: 'tt1234567'

            Lampa.Noty.show(`Buscando streams para: ${item.name}...`, { time: 2000 });

            // Busca streams de todos os addons instalados
            const rawStreams = await StremioAddonManager.getStreams(type, id);

            // Normaliza (converte infoHash para magnet)
            const normalized = rawStreams.map(s => {
                if (s.infoHash) {
                    const magnet = `magnet:?xt=urn:btih:${s.infoHash}`;
                    return { url: magnet, title: s.title || s.name || 'Stream' };
                }
                return { url: s.url, title: s.title || s.name || 'Stream' };
            }).filter(s => s.url);

            if (normalized.length === 0) {
                Lampa.Noty.show('Nenhum stream disponível.', { time: 3000 });
                return;
            }

            let playableStreams = normalized;
            if (USE_DEBRID && DEBRID_API_KEY && DEBRID_API_KEY !== 'SUA_API_KEY_AQUI') {
                playableStreams = await convertMagnetToDebrid(normalized);
            }

            const validStreams = playableStreams.filter(s => s.url && s.url.startsWith('http'));
            if (validStreams.length === 0) {
                Lampa.Noty.show('Nenhum stream jogável encontrado (talvez seja necessário debrid).', { time: 4000 });
                return;
            }

            const stream = validStreams[0];
            Lampa.Player.play({
                url: stream.url,
                title: item.name || 'Stream',
                poster: item.poster || ''
            });
        };

        this.render = function() {
            return this.html;
        };

        this.destroy = function() {
            this.html = null;
        };

        this.initialize();
    }

    // =================================================================
    //  COMPONENTE DE GERENCIAMENTO DE ADDONS
    // =================================================================
    function StremioManagerComponent(object) {
        this.initialize = function() {
            this.html = document.createElement('div');
            this.html.style.padding = '20px';
            this.render();
        };

        this.render = function() {
            const addons = StremioAddonManager.listAddons();
            this.html.innerHTML = '';

            const title = document.createElement('h2');
            title.innerText = 'Addons Stremio Instalados';
            title.style.color = '#fff';
            title.style.marginBottom = '20px';
            this.html.appendChild(title);

            const installBtn = document.createElement('button');
            installBtn.innerText = '+ Adicionar Addon';
            installBtn.style.cssText = `
                background: #e50914;
                color: #fff;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-size: 16px;
                cursor: pointer;
                margin-bottom: 20px;
            `;
            installBtn.onclick = () => this.showInstallPrompt();
            this.html.appendChild(installBtn);

            if (addons.length === 0) {
                const empty = document.createElement('div');
                empty.innerText = 'Nenhum addon instalado. Clique em "Adicionar" para começar.';
                empty.style.color = '#aaa';
                empty.style.padding = '40px';
                empty.style.textAlign = 'center';
                this.html.appendChild(empty);
                return;
            }

            const list = document.createElement('div');
            list.style.display = 'flex';
            list.style.flexDirection = 'column';
            list.style.gap = '12px';

            addons.forEach(addon => {
                const card = document.createElement('div');
                card.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #1a1a2e;
                    padding: 16px 20px;
                    border-radius: 8px;
                    border-left: 4px solid #e50914;
                `;

                const info = document.createElement('div');
                info.innerHTML = `
                    <strong style="color:#fff; font-size:16px;">${addon.name}</strong>
                    <span style="color:#888; font-size:13px; margin-left: 16px;">v${addon.version}</span>
                    <div style="color:#666; font-size:12px; margin-top:4px;">${addon.id}</div>
                    <div style="color:#555; font-size:11px; margin-top:2px;">${addon.resources.join(', ')}</div>
                `;

                const removeBtn = document.createElement('button');
                removeBtn.innerText = 'Remover';
                removeBtn.style.cssText = `
                    background: #444;
                    color: #fff;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                `;
                removeBtn.onclick = () => {
                    if (confirm(`Remover addon "${addon.name}"?`)) {
                        StremioAddonManager.removeAddon(addon.id);
                        this.render();
                        Lampa.Noty.show(`Addon "${addon.name}" removido.`);
                    }
                };

                card.appendChild(info);
                card.appendChild(removeBtn);
                list.appendChild(card);
            });

            this.html.appendChild(list);
        };

        this.showInstallPrompt = function() {
            Lampa.Input.edit({
                title: 'URL do Addon Stremio',
                placeholder: 'Ex: https://torrentio.strem.fun/manifest.json',
                free: true
            }, async (value) => {
                if (!value) return;
                try {
                    const addon = await StremioAddonManager.installAddon(value);
                    Lampa.Noty.show(`Addon "${addon.name}" instalado com sucesso!`);
                    this.render();
                } catch (e) {
                    Lampa.Noty.show(`Erro: ${e.message}`, { time: 4000 });
                }
            });
        };

        this.render = function() {
            return this.html;
        };

        this.destroy = function() {
            this.html = null;
        };

        this.initialize();
    }

    // =================================================================
    //  REGISTRA OS COMPONENTES NO LAMPA
    // =================================================================
    Lampa.Movies.stremio_catalog = function(object) {
        return new StremioCatalogComponent(object);
    };
    Lampa.Movies.stremio_manager = function(object) {
        return new StremioManagerComponent(object);
    };

    // =================================================================
    //  ADICIONA OS ITENS NO MENU PRINCIPAL
    // =================================================================
    Lampa.Listener.follow('app, menu', function(e) {
        if (e.type == 'ready' && e.section == 'menu') {
            // Catálogo
            const catalogItem = {
                title: 'Stremio Catálogo',
                icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,16.5A4.5,4.5 0 0,1 7.5,12A4.5,4.5 0 0,1 12,7.5A4.5,4.5 0 0,1 16.5,12A4.5,4.5 0 0,1 12,16.5Z"/></svg>',
                page: 'stremio_catalog',
                component: 'stremio_catalog',
                onClick: function() {
                    Lampa.Activity.push({
                        url: '',
                        title: 'Stremio Catálogo',
                        component: 'stremio_catalog',
                        page: 1
                    });
                }
            };

            // Gerenciamento
            const managerItem = {
                title: 'Gerenciar Addons Stremio',
                icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19.43,12.98C19.47,12.66 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11.02L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11.02C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.66 4.57,12.98L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.04 4.95,18.95L7.44,17.95C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.95L19.05,18.95C19.27,19.04 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.98M12,15.5C10.07,15.5 8.5,13.93 8.5,12C8.5,10.07 10.07,8.5 12,8.5C13.93,8.5 15.5,10.07 15.5,12C15.5,13.93 13.93,15.5 12,15.5Z"/></svg>',
                page: 'stremio_manager',
                component: 'stremio_manager',
                onClick: function() {
                    Lampa.Activity.push({
                        url: '',
                        title: 'Gerenciar Addons Stremio',
                        component: 'stremio_manager',
                        page: 1
                    });
                }
            };

            if (!e.data.find(it => it.page === 'stremio_catalog')) {
                e.data.push(catalogItem);
            }
            if (!e.data.find(it => it.page === 'stremio_manager')) {
                e.data.push(managerItem);
            }
        }
    });
})();
