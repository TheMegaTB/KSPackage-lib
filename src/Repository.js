import yauzl from 'yauzl';
import request from 'request-promise-native';
import fs from 'fs-extra';
import path from 'path';

import config from '../config';
import KSPackage from "./index";
import {Version} from "./Version";
import {KSPMod, KSPModVersion} from "./Mod";
import {hashForFiles} from "./helpers";

function openArchive(file) {
    return new Promise(((resolve, reject) =>
            yauzl.fromBuffer(file, { lazyEntries: true }, (err, zipfile) => {
                if (err) reject(err);
                else resolve(zipfile);
            })
    ));
}

function parseRepository(archive) {
    return new Promise(((resolve, reject) => {
        const repo = {};
        const cache = {};

        archive.on('entry', entry => {
            // Match all files in the registry that end in .ckan
            if (/\.ckan$/.test(entry.fileName)) {
                archive.openReadStream(entry, (err, readStream) => {
                    if (err) reject(err);
                    else {
                        let data = '';

                        readStream.on('error', reject);

                        readStream.on('data', chunk => data += chunk);

                        readStream.on('end', () => {
                            let parsedJSON;

                            try {
                                parsedJSON = JSON.parse(data);
                            } catch (err) {
                                console.error(entry.fileName, err);
                                reject(err);
                            }

                            if (parsedJSON) {
                                const id = parsedJSON.identifier;

                                // Add the version to the repo
                                if (!repo[id]) repo[id] = new KSPMod();
                                repo[id].addVersion(parsedJSON);

                                // Add the version to the cache
                                if (!cache[id]) cache[id] = [];
                                cache[id].push(parsedJSON);
                            }

                            // Read the next entry
                            archive.readEntry();
                        });
                    }
                });
            } else {
                archive.readEntry();
            }
        });

        archive.on('error', reject);
        archive.on('end', () => {
            const mods = Object.keys(repo).map(modID => repo[modID]);
            resolve({ mods, cache });
        });

        archive.readEntry();
    }));
}

const fetchRepository = (repoURL) => request.get(repoURL, { encoding: null })
    .then(openArchive)
    .then(parseRepository);

// const mergeArrays = (acc, arr) => acc.concat(arr);
// const mergeRepositories = repositories => repositories.reduce(mergeArrays, []);
const isCompatibleWith = (kspVersion: Version) => (mod: KSPMod) => mod.isCompatibleWithKSP(kspVersion);

export default class Repository {
    kspackage: KSPackage;
    _mods: [KSPMod] = [];
    _compatibleMods: [KSPModVersion] = [];

    get repoCachePath() {
        return path.join(this.kspackage.cacheDirectory, 'repository.json');
    }

    constructor(kspackage: KSPackage) {
        this.kspackage = kspackage;
    }

    async init() {
        try {
            await this.kspackage.repository.loadFromCache();
        } catch (err) {
            // Cache miss. Fetch from the web!
            await this.kspackage.repository.fetch();
        }
    }

    updateCompatibleMods() {
        this._compatibleMods = this._mods
            .filter(isCompatibleWith(this.kspackage.kspVersion))
            .map(mod => mod.getVersionForKSP(this.kspackage.kspVersion));
    }

    async fetch() {
        const { mods, cache } = await fetchRepository(config.repository);

        this._mods = mods;
        this.updateCompatibleMods();

        // Write the cache
        await fs.writeJson(this.repoCachePath, cache);

        // Calculate its checksum
        const cacheChecksum = await hashForFiles([this.repoCachePath]);
        this.kspackage.dataStorage.set('repositoryChecksum', cacheChecksum);
    }

    async loadFromCache() {
        // Calculate and compare the checksum
        const cacheChecksum = await hashForFiles([this.repoCachePath]);
        if (this.kspackage.dataStorage.get('repositoryChecksum') !== cacheChecksum)
            throw new Error('Failed to load cache: Checksum mismatch!');

        // Load the cache from disk
        const cache = await fs.readJson(this.repoCachePath);

        // Convert the versions into instances of KSPMod
        for (let modID in cache) {
            if (!cache.hasOwnProperty(modID)) continue;

            const versions = cache[modID];
            const mod = new KSPMod();
            versions.forEach(version => mod.addVersion(version));
            cache[modID] = mod;
        }

        // Flatten everything into an array and store it
        this._mods = Object.keys(cache).map(modID => cache[modID]);
        this.updateCompatibleMods();
    }
}