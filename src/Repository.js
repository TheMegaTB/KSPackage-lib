import yauzl from 'yauzl';
import request from 'request-promise-native';
import fs from 'fs-extra';
import path from 'path';

import config from '../config';
import KSPackage from "./index";
import {Version} from "./Version";
import {KSPMod, KSPModVersion} from "./Mod";
import {groupBy, hashForFiles} from "./helpers";
import { ModIdentifier } from "./externalTypes/CKANModSpecification";
import Fuse from "fuse.js";

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

const searchOptions = {
    shouldSort: true,
    threshold: 0.6,
    location: 0,
    distance: 100,
    maxPatternLength: 32,
    minMatchCharLength: 1,
    keys: [
        {
            'name': 'abstract',
            'weight': 0.3
        }, {
            'name': 'name',
            'weight': 0.7
        }, {
            'name': 'author',
            'weight': 0.5
        }
    ]
};

export default class Repository {
    kspackage: KSPackage;
    _mods: Array<KSPMod> = [];
    _fuse: { [string]: Fuse };

    get repoCachePath() {
        return path.join(this.kspackage.cacheDirectory, 'repository.json');
    }

    constructor(kspackage: KSPackage) {
        this.kspackage = kspackage;
    }

    async init() {
        try {
            await this.loadFromCache();
        } catch (err) {
            // Cache miss. Fetch from the web!
            await this.fetch();
        }
    }

    searchForCompatibleMod(query: string, kspVersion: Version): Array<KSPModVersion> {
        const fuseKey = kspVersion.stringRepresentation;

        if (!this._fuse.hasOwnProperty(fuseKey)) {
            // TODO Also include non-latest version metadata (if the user so desires)
            const latestCompatibleModVersions = this.latestCompatibleModVersions(kspVersion);
            this._fuse[fuseKey] = new Fuse(latestCompatibleModVersions, searchOptions);
        }

        return this._fuse[fuseKey].search(query);
    }

    modsCompatibleWithKSPVersion(kspVersion: Version): Array<KSPMod> {
        return this._mods.filter(mod => mod.isCompatibleWithKSP(kspVersion));
    }

    latestCompatibleModVersions(kspVersion: Version): Array<KSPModVersion> {
        return this.modsCompatibleWithKSPVersion(kspVersion).map(mod => mod.getLatestVersionForKSP(kspVersion));
    }

    modByIdentifier(identifier: ModIdentifier, kspVersion: Version): ?KSPModVersion {
        return this._mods
            .map(mod => mod.getLatestVersionForKSP(kspVersion))
            .filter(mod => mod)
            .find(modVersion => modVersion.identifier === identifier);
    }

    compatibleModsProvidingFeature(kspVersion: Version, feature: string): { [ModIdentifier]: [KSPModVersion] } {
        // Collect all versions of all mods that are compatible with this KSP version and provide the given feature.
        const compatibleVersions: Array<KSPModVersion> = this._mods.flatMap(mod =>
            mod.getVersionsForKSP(kspVersion)
                .filter(version => version.providesFeature(feature))
        );

        // Group them by identifier
        const groupedVersions =  groupBy(compatibleVersions, version => version.identifier);

        // Sort them by version
        for (let identifier in groupedVersions) {
            if (!groupedVersions.hasOwnProperty(identifier)) continue;
            groupedVersions[identifier].sort((a, b) => Version.compare(a.version, b.version));
        }

        return groupedVersions;
    }

    getModVersion(identifier: ModIdentifier, version: Version): ?KSPModVersion {
        const versions: Array<KSPModVersion> = this._mods.flatMap(mod => mod.versions);
        const matchingVersions = versions.filter(modVersion =>
            modVersion.identifier === identifier && modVersion.version.compareAgainst(version) === Version.EQUAL
        );

        if (matchingVersions.length > 1) console.warn("Found more than one meta entry for mod version:", identifier, version.stringRepresentation);
        if (matchingVersions.length > 0) return matchingVersions[0];
    }

    _resetSearchIndex() {
        this._fuse = {};
    }

    async fetch() {
        const { mods, cache } = await fetchRepository(config.repository);

        this._mods = mods;

        // Write the cache
        await fs.writeJson(this.repoCachePath, cache);

        // Calculate its checksum
        const cacheChecksum = await hashForFiles([this.repoCachePath]);
        this.kspackage.dataStorage.set('repositoryChecksum', cacheChecksum);

        this._resetSearchIndex();
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

        this._resetSearchIndex();
    }
}