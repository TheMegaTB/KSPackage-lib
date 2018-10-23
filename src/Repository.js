import yauzl from 'yauzl';
import request from 'request-promise-native';

import config from '../config';
import KSPackage from "./index";
import {Version} from "./Version";
import {KSPMod, KSPModVersion} from "./Mod";

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

        archive.on('end', () => resolve(Object.keys(repo).map(modID => repo[modID])));

        archive.on('error', reject);

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
                                if (!repo[id]) repo[id] = new KSPMod();
                                repo[id].addVersion(parsedJSON);
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

        archive.readEntry();
    }));
}

const fetchRepository = (repoURL) => request.get(repoURL, { encoding: null })
    .then(openArchive)
    .then(parseRepository);

const mergeArrays = (acc, arr) => acc.concat(arr);
const mergeRepositories = repositories => repositories.reduce(mergeArrays, []);
const isCompatibleWith = (kspVersion: Version) => (mod: KSPMod) => mod.isCompatibleWithKSP(kspVersion);

export default class Repository {
    kspackage: KSPackage;
    _mods: [KSPMod] = [];
    _compatibleMods: [KSPModVersion] = [];

    constructor(kspackage: KSPackage) {
        this.kspackage = kspackage;
    }


    updateCompatibleMods() {
        this._compatibleMods = this._mods
            .filter(isCompatibleWith(this.kspackage.kspVersion))
            .map(mod => mod.getVersionForKSP(this.kspackage.kspVersion));
    }

    fetch(): Promise<void> {
        return Promise.all(config.repositories.map(repo => fetchRepository(repo)))
            .then(mergeRepositories)
            .then(mods => {
                this._mods = mods;
                this.updateCompatibleMods();
            });
    }
}