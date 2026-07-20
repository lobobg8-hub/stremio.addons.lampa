const Stremio = {
    addons: [],

    async install(manifestUrl) {
        const manifest = await fetch(manifestUrl).then(r => r.json());

        this.addons.push({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            endpoint: manifestUrl.replace("/manifest.json", "")
        });

        return manifest;
    },

    async catalogs() {
        let list = [];

        for (const addon of this.addons) {
            const manifest = await fetch(addon.endpoint + "/manifest.json")
                .then(r => r.json());

            list.push(...manifest.catalogs);
        }

        return list;
    },

    async streams(id, type) {
        let streams = [];

        for (const addon of this.addons) {
            try {
                const url =
                    addon.endpoint +
                    "/stream/" +
                    type +
                    "/" +
                    id +
                    ".json";

                const json = await fetch(url).then(r => r.json());

                streams.push(...json.streams);
            }
            catch(e){}
        }

        return streams;
    }
};
