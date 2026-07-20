(function () {
    'use strict';

    // ============================================================
    //  PLUGIN MANIFEST (registra no Lampa.Manifest.plugins)
    // ============================================================
    var plugin = {
        name: 'MX Stremio',
        version: '1.1.0',
        description: 'Stremio Addons + TorBox Debrid para Lampa Next Gen',
        type: 'plugin',
        component: 'stremio_catalog',
        icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12,2L2,7l10 5 10-5-10-5zM2,17l10 5 10-5M2,12l10 5 10-5"/></svg>'
    };

    // Auto-registra no Lampa assim que o objeto Lampa existir
    function registerPluginManifest() {
        if (typeof Lampa === 'undefined') return false;
        Lampa.Manifest = Lampa.Manifest || {};
        Lampa.Manifest.plugins = Lampa.Manifest.plugins || {};
        Lampa.Manifest.plugins[plugin.name] = plugin;
        return true;
    }

    // Tenta registrar já; se Lampa não existir, tenta no 'app' ready
    if (!registerPluginManifest()) {
        var _readyCheck = setInterval(function () {
            if (registerPluginManifest()) clearInterval(_readyCheck);
        }, 50);
    }

    // ============================================================
    //  CONFIG
    // ============================================================
    const STORAGE_KEY = 'lampa_mx_stremio_addons';
    const STREAM_TIMEOUT = 8000;        // timeout fetch em ms
    const MAX_POLLS = 12;               // tentativas de polling TorBox
    const INITIAL_POLL_DELAY = 5000;    // delay inicial
    const POLL_DELAY = 2000;            // delay entre polls
    const CHUNK_SIZE = 3;               // torrents em paralelo

    // ============================================================
    //  STREMIO ADDON MANAGER
    // ============================================================
    const StremioAddonManager = (function () {
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
            let url = (input || '').trim();
            if (!url) throw new Error('URL vazia');
            if (url.startsWith('stremio://')) {
                url = url.replace('stremio://', 'https://');
            }
            if (url.includes('/manifest.json')) {
                return url.replace(/\/manifest\.json.*$/, '/manifest.json');
            }
            if (!url.endsWith('/')) url += '/';
            return url + 'manifest.json';
        }

        async function fetchWithTimeout(url, opts = {}) {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), STREAM_TIMEOUT);
            try {
                return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
            } finally {
                clearTimeout(t);
            }
        }

        async function installAddon(manifestUrlInput) {
            const manifestUrl = normalizeManifestUrl(manifestUrlInput);
            const res = await fetchWithTimeout(manifestUrl);
            if (!res.ok) throw new Error('Manifest inacessível (HTTP ' + res.status + ')');
            const manifest = await res.json();
            if (!manifest.id || !Array.isArray(manifest.resources)) {
                throw new Error('Manifest inválido: faltam id ou resources');
            }
            const baseUrl = manifestUrl.replace(/\/manifest\.json$/, '');
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
            const idx = list.findIndex(a => a.id === addon.id);
            if (idx >= 0) list[idx] = addon; else list.push(addon);
            saveInstalledAddons(list);
            return addon;
        }

        function removeAddon(id) {
            saveInstalledAddons(getInstalledAddons().filter(a => a.id !== id));
        }

        function listAddons() {
            return getInstalledAddons();
        }

        function supportsResource(addon, resource, type) {
            const hasRes = addon.resources.some(r => {
                if (typeof r === 'string') return r === resource;
                return r.name === resource && (!r.types || r.types.includes(type));
            });
            return hasRes && (addon.types.length === 0 || addon.types.includes(type));
        }

        async function getStreams(type, id) {
            const addons = getInstalledAddons().filter(a => supportsResource(a, 'stream', type));
            const results = [];
            const seen = new Set();
            await Promise.all(addons.map(async (addon) => {
                try {
                    const url = addon.baseUrl + '/stream/' + type + '/' + encodeURIComponent(id) + '.json';
                    const res = await fetchWithTimeout(url);
                    if (!res.ok) return;
                    const data = await res.json();
                    if (!Array.isArray(data.streams)) return;
                    data.streams.forEach(s => {
                        const key = s.infoHash || s.url;
                        if (!key || seen.has(key)) return;
                        seen.add(key);
                        results.push(Object.assign({}, s, {
                            _addonId: addon.id,
                            _addonName: addon.name
                        }));
                    });
                } catch (e) {
                    console.warn('[MX][Stremio] ' + addon.id + ' falhou:', e.message);
                }
            }));
            return results;
        }

        async function getCatalog(addon, type, catalogId, extra) {
            extra = extra || {};
            let url = addon.baseUrl + '/catalog/' + type + '/' + encodeURIComponent(catalogId) + '/';
            const extraStr = Object.keys(extra)
                .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]))
                .join('&');
            url += (extraStr ? extraStr + '.' : '') + 'json';
            const res = await fetchWithTimeout(url);
            if (!res.ok) throw new Error('Catálogo falhou (HTTP ' + res.status + ')');
            return res.json();
        }

        return {
            installAddon: installAddon,
            removeAddon: removeAddon,
            listAddons: listAddons,
            getStreams: getStreams,
            getCatalog: getCatalog,
            supportsResource: supportsResource
        };
    })();

    // ============================================================
    //  TORBOX DEBRID CONVERTER
    // ============================================================
    function getDebridConfig() {
        return {
            enabled: Lampa.Storage.get('mx_use_debrid', true) !== false,
            apiKey: Lampa.Storage.get('mx_torbox_key', '') || ''
        };
    }

    async function processSingleTorBox(stream) {
        const config = getDebridConfig();
        const apiKey = config.apiKey;
        if (!apiKey) throw new Error('API Key do TorBox não configurada');

        const magnet = stream.url;

        // 1. Adicionar magnet
        const addResponse = await fetch('https://api.torbox.app/v2/api/torrents/createtorrent', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ magnet: magnet })
        });
        if (!addResponse.ok) {
            const errText = await addResponse.text();
            throw new Error('TorBox add falhou: ' + errText);
        }
        const addData = await addResponse.json();
        if (!addData.success) throw new Error('TorBox erro: ' + (addData.message || 'desconhecido'));
        const torrentId = addData.data && addData.data.torrent_id;
        if (!torrentId) throw new Error('TorBox sem torrent_id');

        // 2. Polling com filtro por ID
        let downloadUrl = null;
        let retries = 0;
        let delay = INITIAL_POLL_DELAY;

        while (retries < MAX_POLLS) {
            await new Promise(r => setTimeout(r, delay));

            const infoResponse = await fetch(
                'https://api.torbox.app/v2/api/torrents/mylist?id=' + torrentId,
                { headers: { 'Authorization': 'Bearer ' + apiKey } }
            );
            if (!infoResponse.ok) {
                retries++;
                delay = POLL_DELAY;
                continue;
            }
            const infoData = await infoResponse.json();
            const torrentInfo = infoData && infoData.data && infoData.data[0];
            if (!torrentInfo) {
                retries++;
                delay = POLL_DELAY;
                continue;
            }

            const isReady = torrentInfo.cached === true ||
                            torrentInfo.download_present === true ||
                            (torrentInfo.progress === 1 && torrentInfo.download_finished === true);

            if (isReady) {
                const files = torrentInfo.files || [];
                const videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                const videoFiles = files.filter(f => {
                    const name = (f.name || f.short_name || '').toLowerCase();
                    return videoExts.some(ext => name.endsWith(ext));
                });
                let bestFile = null;
                if (videoFiles.length > 0) {
                    bestFile = videoFiles.reduce((a, b) => (a.size > b.size ? a : b));
                } else if (files.length > 0) {
                    bestFile = files.reduce((a, b) => (a.size > b.size ? a : b));
                }
                if (!bestFile) throw new Error('Nenhum arquivo válido no torrent');

                const dlResponse = await fetch('https://api.torbox.app/v2/api/torrents/requestdl', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ torrent_id: torrentId, file_id: bestFile.id })
                });
                if (!dlResponse.ok) throw new Error('Falha ao gerar link: HTTP ' + dlResponse.status);
                const dlData = await dlResponse.json();
                if (!dlData.success) throw new Error('Erro no requestdl: ' + (dlData.message || ''));
                downloadUrl = (dlData.data && (dlData.data.url || dlData.data.download_url || dlData.data.link)) || null;
                if (!downloadUrl) throw new Error('URL de download não retornada');
                break;
            }

            retries++;
            delay = Math.min(POLL_DELAY * retries, 10000);
        }

        if (!downloadUrl) throw new Error('Timeout aguardando torrent ' + torrentId);

        return {
            url: downloadUrl,
            title: stream.title || 'Stream via TorBox',
            _addonId: stream._addonId,
            _addonName: stream._addonName,
            _debrid: 'torbox'
        };
    }

    async function convertMagnetToDebrid(streams, onProgress) {
        const debridStreams = [];
        const magnetStreams = streams.filter(s => s.url && s.url.startsWith('magnet:'));
        const httpStreams = streams.filter(s => s.url && !s.url.startsWith('magnet:'));

        for (let i = 0; i < magnetStreams.length; i += CHUNK_SIZE) {
            const chunk = magnetStreams.slice(i, i + CHUNK_SIZE);
            if (onProgress) onProgress(i, magnetStreams.length);
            const results = await Promise.allSettled(chunk.map(s => processSingleTorBox(s)));
            results.forEach(r => {
                if (r.status === 'fulfilled' && r.value) {
                    debridStreams.push(r.value);
                } else if (r.status === 'rejected') {
                    console.warn('[MX][TorBox]', r.reason && r.reason.message);
                }
            });
            if (i + CHUNK_SIZE < magnetStreams.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        debridStreams.push.apply(debridStreams, httpStreams);
        return debridStreams;
    }

    // ============================================================
    //  STREAM SELECTOR (modal pra escolher stream)
    // ============================================================
    function showStreamSelector(streams, item, onPick) {
        if (!streams || streams.length === 0) {
            Lampa.Noty.show('Nenhum stream jogável encontrado', { time: 3000 });
            return;
        }
        const seen = new Set();
        const unique = streams.filter(s => {
            if (!s.url || seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
        });
        const items = unique.map((s, idx) => ({
            title: s.title || ('Stream ' + (idx + 1)),
            subtitle: (s._addonName || 'Addon') + (s._debrid ? ' • TorBox' : ''),
            stream: s
        }));
        Lampa.Select.show({
            title: item.name || 'Escolha um stream',
            items: items,
            onSelect: function (selected) { onPick(selected.stream); },
            onBack: function () {}
        });
    }

    // ============================================================
    //  CATALOG COMPONENT
    // ============================================================
    function StremioCatalogComponent(object) {
        object = object || {};
        this.html = document.createElement('div');
        this.html.className = 'mx-catalog';
        this.currentPage = 1;
        this.catalogAddon = null;
        this.catalogType = 'movie';
        this.catalogId = 'top';
        this.extra = {};
        this.eventCleanups = [];

        this.initialize = function () {
            this.html.innerHTML =
                '<div class="broadcast__scan" style="text-align:center;padding:50px;">' +
                '<div></div><div>Carregando catálogo...</div></div>';
            this.loadCatalog();
        };

        this.loadCatalog = async function (append) {
            append = !!append;
            try {
                if (!this.catalogAddon) {
                    const addons = StremioAddonManager.listAddons();
                    this.catalogAddon = addons.find(a =>
                        StremioAddonManager.supportsResource(a, 'catalog', 'movie') ||
                        StremioAddonManager.supportsResource(a, 'catalog', 'series')
                    );
                    if (!this.catalogAddon) {
                        this.html.innerHTML =
                            '<div class="empty" style="text-align:center;padding:50px;">' +
                            'Nenhum addon com catálogo instalado.<br>Vá em "Gerenciar Addons" para adicionar.' +
                            '</div>';
                        return;
                    }
                    if (this.catalogAddon.catalogs && this.catalogAddon.catalogs.length > 0) {
                        const first = this.catalogAddon.catalogs[0];
                        this.catalogType = first.type || 'movie';
                        this.catalogId = first.id || 'top';
                    }
                }

                const data = await StremioAddonManager.getCatalog(
                    this.catalogAddon,
                    this.catalogType,
                    this.catalogId,
                    Object.assign({}, this.extra, { page: this.currentPage })
                );
                this.renderItems(data.metas || [], append);
            } catch (e) {
                this.html.innerHTML =
                    '<div class="empty" style="text-align:center;padding:50px;">Erro: ' + e.message + '</div>';
            }
        };

        this.renderItems = function (items, append) {
            if (!append) this.html.innerHTML = '';
            if (items.length === 0 && !append) {
                this.html.innerHTML = '<div class="empty" style="text-align:center;padding:50px;">Nenhum item encontrado</div>';
                return;
            }
            const grid = document.createElement('div');
            grid.className = 'mx-catalog__grid';
            items.forEach(item => grid.appendChild(this.createCard(item)));
            this.html.appendChild(grid);
        };

        this.createCard = function (item) {
            const card = document.createElement('div');
            card.className = 'mx-card';
            const poster = item.poster || item.background || '';
            const img = document.createElement('div');
            img.className = 'mx-card__poster';
            if (poster) img.style.backgroundImage = 'url("' + poster + '")';
            const title = document.createElement('div');
            title.className = 'mx-card__title';
            title.innerText = item.name || 'Sem título';
            const sub = document.createElement('div');
            sub.className = 'mx-card__sub';
            const subParts = [item.year, item.type].filter(Boolean);
            if (subParts.length) sub.innerText = subParts.join(' • ');
            card.appendChild(img);
            card.appendChild(title);
            if (sub.innerText) card.appendChild(sub);
            const onClick = () => this.playItem(item);
            card.addEventListener('click', onClick);
            this.eventCleanups.push(() => card.removeEventListener('click', onClick));
            return card;
        };

        this.playItem = async function (item) {
            const type = item.type || this.catalogType;
            const id = item.id;
            if (!id) {
                Lampa.Noty.show('Item sem ID válido', { time: 3000 });
                return;
            }

            Lampa.Noty.show('Buscando streams: ' + (item.name || ''), { time: 1500 });
            let rawStreams;
            try {
                rawStreams = await StremioAddonManager.getStreams(type, id);
            } catch (e) {
                Lampa.Noty.show('Erro ao buscar streams: ' + e.message, { time: 4000 });
                return;
            }

            const normalized = rawStreams.map(s => {
                if (s.infoHash) {
                    const magnet = 'magnet:?xt=urn:btih:' + s.infoHash +
                        (s.fileIdx !== undefined ? '&fileIdx=' + s.fileIdx : '');
                    return {
                        url: magnet,
                        title: s.title || s.name || 'Stream',
                        _addonId: s._addonId,
                        _addonName: s._addonName
                    };
                }
                return {
                    url: s.url,
                    title: s.title || s.name || 'Stream',
                    _addonId: s._addonId,
                    _addonName: s._addonName
                };
            }).filter(s => s.url);

            if (normalized.length === 0) {
                Lampa.Noty.show('Nenhum stream disponível para este título', { time: 3000 });
                return;
            }

            const config = getDebridConfig();
            let playable = normalized;
            if (config.enabled && config.apiKey) {
                if (Lampa.Loading) Lampa.Loading.start();
                try {
                    playable = await convertMagnetToDebrid(normalized, function (cur, total) {
                        Lampa.Noty.show('Convertendo ' + (cur + 1) + '/' + total + ' via TorBox...', { time: 1500 });
                    });
                } catch (e) {
                    console.warn('[MX][TorBox]', e.message);
                }
                if (Lampa.Loading) Lampa.Loading.stop();
            }

            const valid = playable.filter(s => s.url && /^https?:\/\//.test(s.url));
            showStreamSelector(valid, item, function (stream) {
                Lampa.Player.play({
                    url: stream.url,
                    title: item.name || 'Stream',
                    poster: item.poster || item.background || ''
                });
            });
        };

        this.render = function () { return this.html; };

        this.destroy = function () {
            this.eventCleanups.forEach(fn => { try { fn(); } catch (e) {} });
            this.eventCleanups = [];
            this.html.innerHTML = '';
            this.html = null;
        };

        this.initialize();
    }

    // ============================================================
    //  MANAGER COMPONENT (lista addons + instalar/remover)
    // ============================================================
    function StremioManagerComponent(object) {
        object = object || {};
        this.html = document.createElement('div');
        this.html.className = 'mx-manager';
        this.eventCleanups = [];

        this.build = function () {
            this.eventCleanups.forEach(fn => { try { fn(); } catch (e) {} });
            this.eventCleanups = [];
            this.html.innerHTML = '';

            const addons = StremioAddonManager.listAddons();

            const head = document.createElement('div');
            head.className = 'mx-manager__head';
            head.innerHTML = '<h2>Addons Stremio instalados (' + addons.length + ')</h2>';
            this.html.appendChild(head);

            const installBtn = document.createElement('button');
            installBtn.className = 'mx-btn mx-btn--primary';
            installBtn.innerText = '+ Instalar novo addon';
            const onInstall = () => this.showInstallPrompt();
            installBtn.addEventListener('click', onInstall);
            this.eventCleanups.push(() => installBtn.removeEventListener('click', onInstall));
            this.html.appendChild(installBtn);

            if (addons.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'mx-empty';
                empty.innerText = 'Nenhum addon instalado. Clique em "Instalar" para começar.';
                this.html.appendChild(empty);
                return;
            }

            const list = document.createElement('div');
            list.className = 'mx-list';
            addons.forEach(addon => list.appendChild(this.createAddonCard(addon)));
            this.html.appendChild(list);
        };

        this.createAddonCard = function (addon) {
            const card = document.createElement('div');
            card.className = 'mx-addon-card';

            const info = document.createElement('div');
            info.className = 'mx-addon-card__info';
            const types = (addon.types && addon.types.length) ? addon.types.join(', ') : 'todos os tipos';
            info.innerHTML =
                '<div class="mx-addon-card__name">' + escapeHtml(addon.name) + '</div>' +
                '<div class="mx-addon-card__meta">' + escapeHtml(types) + ' • v' + escapeHtml(addon.version) + '</div>' +
                '<div class="mx-addon-card__id">' + escapeHtml(addon.id) + '</div>';

            const btn = document.createElement('button');
            btn.className = 'mx-btn mx-btn--danger';
            btn.innerText = 'Remover';
            const onRemove = () => this.removeAddon(addon);
            btn.addEventListener('click', onRemove);
            this.eventCleanups.push(() => btn.removeEventListener('click', onRemove));

            card.appendChild(info);
            card.appendChild(btn);
            return card;
        };

        this.removeAddon = function (addon) {
            Lampa.Input.confirm('Remover "' + addon.name + '"?', () => {
                StremioAddonManager.removeAddon(addon.id);
                Lampa.Noty.show('Addon "' + addon.name + '" removido.');
                this.build();
            });
        };

        this.showInstallPrompt = function () {
            const cb = async (value) => {
                if (!value) return;
                try {
                    const addon = await StremioAddonManager.installAddon(value);
                    Lampa.Noty.show('Addon "' + addon.name + '" instalado com sucesso!');
                    this.build();
                } catch (e) {
                    Lampa.Noty.show('Erro: ' + e.message, { time: 4000 });
                }
            };

            if (Lampa.Input.prompt) {
                Lampa.Input.prompt({
                    title: 'URL do Manifest Stremio',
                    placeholder: 'Ex: https://torrentio.strem.fun/manifest.json'
                }, cb);
            } else {
                Lampa.Input.edit({
                    title: 'URL do Manifest Stremio',
                    value: ''
                }, cb);
            }
        };

        this.render = function () { return this.html; };

        this.destroy = function () {
            this.eventCleanups.forEach(fn => { try { fn(); } catch (e) {} });
            this.eventCleanups = [];
            this.html.innerHTML = '';
            this.html = null;
        };

        this.build();
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ============================================================
    //  SETTINGS INTEGRATION
    // ============================================================
    function registerSettings() {
        Lampa.Settings.api('mx_use_debrid', {
            name: 'MX — Usar TorBox',
            type: 'check',
            value: true
        });
        Lampa.Settings.api('mx_torbox_key', {
            name: 'MX — TorBox API Key',
            type: 'input',
            value: '',
            placeholder: 'Cole aqui sua key do TorBox.app'
        });
    }

    // ============================================================
    //  MENU INTEGRATION
    // ============================================================
    function registerMenu() {
        Lampa.Listener.follow('menu', function (e) {
            if (e.type !== 'ready') return;
            const data = e.data || e.items || [];
            const add = (item) => {
                if (!data.find(it => it.page === item.page)) data.push(item);
            };
            add({
                title: 'Stremio Catálogo',
                icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12,2L2,7l10 5 10-5-10-5zM2,17l10 5 10-5M2,12l10 5 10-5"/></svg>',
                page: 'mx_stremio_catalog',
                component: 'stremio_catalog'
            });
            add({
                title: 'Gerenciar Addons Stremio',
                icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19.43,12.98C19.47,12.66 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11.02L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11.02C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.66 4.57,12.98L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.04 4.95,18.95L7.44,17.95C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.95L19.05,18.95C19.27,19.04 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.98M12,15.5C10.07,15.5 8.5,13.93 8.5,12C8.5,10.07 10.07,8.5 12,8.5C13.93,8.5 15.5,10.07 15.5,12C15.5,13.93 13.93,15.5 12,15.5Z"/></svg>',
                page: 'mx_stremio_manager',
                component: 'stremio_manager'
            });
        });
    }

    // ============================================================
    //  STYLES
    // ============================================================
    function injectStyles() {
        if (document.getElementById('mx-styles')) return;
        const style = document.createElement('style');
        style.id = 'mx-styles';
        style.textContent =
            '.mx-catalog { padding: 20px; }' +
            '.mx-catalog__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; }' +
            '.mx-card { cursor: pointer; transition: transform 0.2s; }' +
            '.mx-card:hover { transform: scale(1.03); }' +
            '.mx-card__poster { height: 220px; background-size: cover; background-position: center; background-color: #1a1a2e; background-image: linear-gradient(135deg,#1a1a2e 0%,#2d2d44 100%); border-radius: 8px; }' +
            '.mx-card__title { margin-top: 10px; color: #fff; font-weight: 500; text-align: center; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
            '.mx-card__sub { font-size: 12px; color: #aaa; text-align: center; }' +
            '.mx-manager { padding: 20px; }' +
            '.mx-manager__head { margin-bottom: 16px; }' +
            '.mx-manager__head h2 { color: #fff; font-size: 20px; margin: 0; }' +
            '.mx-btn { border: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; cursor: pointer; margin-bottom: 20px; color: #fff; }' +
            '.mx-btn--primary { background: #e50914; }' +
            '.mx-btn--primary:hover { background: #f50a16; }' +
            '.mx-btn--danger { background: #444; padding: 8px 16px; font-size: 13px; margin-bottom: 0; }' +
            '.mx-btn--danger:hover { background: #5a1a1a; }' +
            '.mx-empty { color: #aaa; padding: 40px; text-align: center; }' +
            '.mx-list { display: flex; flex-direction: column; gap: 12px; }' +
            '.mx-addon-card { display: flex; justify-content: space-between; align-items: center; background: #1a1a2e; padding: 16px 20px; border-radius: 8px; border-left: 4px solid #e50914; }' +
            '.mx-addon-card__name { color: #fff; font-size: 16px; font-weight: 500; }' +
            '.mx-addon-card__meta { color: #888; font-size: 13px; margin-top: 4px; }' +
            '.mx-addon-card__id { color: #555; font-size: 11px; margin-top: 2px; }';
        document.head.appendChild(style);
    }

    // ============================================================
    //  FIRST-RUN CHECK (aviso amigável se TorBox não tá configurado)
    // ============================================================
    function firstRunCheck() {
        const seen = Lampa.Storage.get('mx_first_run_done', false);
        if (seen) return;
        Lampa.Storage.set('mx_first_run_done', true);
        setTimeout(() => {
            const config = getDebridConfig();
            if (config.enabled && !config.apiKey) {
                Lampa.Noty.show(
                    'MX Stremio: configure sua API Key do TorBox em Settings → MX — TorBox API Key',
                    { time: 6000 }
                );
            }
        }, 3000);
    }

    // ============================================================
    //  BOOT
    // ============================================================
    function start() {
        Lampa.Component.add('stremio_catalog', StremioCatalogComponent);
        Lampa.Component.add('stremio_manager', StremioManagerComponent);
        registerSettings();
        registerMenu();
        injectStyles();
        firstRunCheck();
        console.log('[MX] Plugin carregado (Stremio Addons + TorBox) v1.1.0');
    }

    if (window.appready) {
        start();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
