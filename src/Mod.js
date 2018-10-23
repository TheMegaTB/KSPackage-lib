// @flow

import { get } from 'request-promise-native';
import { Version } from './Version';
import { DelayPromise } from './helpers';

type URL = String;
type ModReference = {};

const flattenModReferences = referenceList => {
    if (referenceList) return referenceList.map(reference => reference.name);
    else return [];
};

const spacedockIDRegex = /spacedock\.info\/mod\/(\d+?)\//;
const curseIDRegex = /kerbal\.curseforge\.com\/projects\/(\d+)/;
const xcurseIDRegex = /www\.curse\.com\/ksp-mods\/kerbal\/\d+-(.*)/;

export class KSPModVersion {
    // Base metadata
    name: String;
    abstract: String;
    identifier: String;

    author: [String];
    description: String;

    download: URL;
    license: String;
    releaseStatus: String;

    version: Version;
    kspVersion: Version;

    tags: [String];
    install: [{}];

    depends: [ModReference];
    conflicts: [ModReference];
    provides: [String];

    recommends: [ModReference];
    suggests: [ModReference];

    resources: {
        homepage: URL,
        bugtracker: URL,
        repository: URL,
        ci: URL,
        spacedock: URL,
        curse: URL,
        x_screenshot: URL
    };

    // Enhanced metadata (call fetchEnhancedMetadata to retrieve)
    descriptionHTML: String;
    screenshot: URL;
    downloads: Number;
    followers: Number;
    changelog: [{
        changelog: String,
        friendly_version: String
    }];


    constructor(spec: {}) {
        if (spec.kind === 'metapackage') throw new Error(`Metapackages are not supported yet.`);

        this.name = spec.name;
        this.abstract = spec.abstract;
        this.identifier = spec.identifier;

        this.author = spec.author;
        this.description = spec.description;

        this.download = spec.download;
        this.license = spec.license;
        this.releaseStatus = spec.releaseStatus;

        this.version = new Version(spec.version);
        if (spec.ksp_version) this.kspVersion = new Version(spec.ksp_version);
        if (spec.ksp_version_min) this.kspVersionMin = new Version(spec.ksp_version_min);
        if (spec.ksp_version_max) this.kspVersionMax = new Version(spec.ksp_version_max);
        this.kspVersionStrict = spec.ksp_version_strict ? spec.ksp_version_strict : false;

        if (this.kspVersion && (this.kspVersionMin || this.kspVersionMax)) throw new Error("Both kspVersion and kspVersionMin/Max are given.");

        this.tags = spec.tags;
        this.install = spec.install;

        this.depends = flattenModReferences(spec.depends);
        this.conflicts = flattenModReferences(spec.conflicts);
        this.provides = spec.provides || [];

        this.recommends = flattenModReferences(spec.recommends);
        this.suggests = flattenModReferences(spec.suggests);

        this.resources = spec.resources;
        if (spec.resources && spec.resources.x_screenshot) this.screenshot = spec.resources.x_screenshot;
    }

    isCompatibleWithKSP(kspVersion: Version) {
        const componentsToCompare = this.kspVersionStrict ? 3 : 2;

        if (this.kspVersion) {
            return this.kspVersion.compareAgainst(kspVersion, componentsToCompare) === Version.EQUAL;
        }

        else if (this.kspVersionMin && !this.kspVersionMax) {
            const relation = kspVersion.compareAgainst(this.kspVersionMin, componentsToCompare);
            return relation === Version.EQUAL || relation === Version.NEWER;
        }

        else if (this.kspVersionMax && !this.kspVersionMin) {
            const relation = kspVersion.compareAgainst(this.kspVersionMax, componentsToCompare);
            return relation === Version.EQUAL || relation === Version.OLDER;
        }

        else if (this.kspVersionMin && this.kspVersionMax) {
            const lowerBound = kspVersion.compareAgainst(this.kspVersionMin, componentsToCompare);
            const upperBound = kspVersion.compareAgainst(this.kspVersionMax, componentsToCompare);
            return (lowerBound === Version.EQUAL || lowerBound === Version.NEWER)
                && (upperBound === Version.EQUAL || upperBound === Version.OLDER);
        }
    }

    fetchEnhancedMetadata(): Promise {
        const reject = reason => new Promise((resolve, reject) => reject(reason));

        if (this.resources.spacedock) {
            const modIDMatch = spacedockIDRegex.exec(this.resources.spacedock);
            if (!modIDMatch) return reject('Mod ID not found.');
            const modID = modIDMatch[1];

            return get(`https://spacedock.info/api/mod/${modID}`)
                .then(JSON.parse)
                .then(data => {
                    this.abstract = data.short_description;
                    this.description = data.description;
                    this.descriptionHTML = data.description_html;
                    this.screenshot = `https://spacedock.info${data.background}`;
                });
        } else if (this.resources.curse || this.resources.x_curse) {
            let uri = '';

            if (this.resources.curse) {
                const modIDMatch = curseIDRegex.exec(this.resources.curse);
                if (!modIDMatch) return reject('Mod ID not found.');
                uri = `https://api.cfwidget.com/project/${modIDMatch[1]}`
            } else {
                const modIDMatch = xcurseIDRegex.exec(this.resources.x_curse);
                if (!modIDMatch) return reject('Mod ID not found.');
                uri = `https://api.cfwidget.com/kerbal/ksp-mods/${modIDMatch[1]}`
            }

            const fetchCurseData = () => get({ uri, simple: false })
                .then(JSON.parse)
                .then(data => {
                    if (data.error && data.error === 'in_queue') {
                        console.warn('Curse query is queued - this might take a few seconds.');
                        return DelayPromise(10000)().then(this.fetchEnhancedMetadata.bind(this));
                    } else if (data.error) {
                        return reject(data.title);
                    }

                    this.downloads = data.downloads.total;
                    this.descriptionHTML = data.description;
                    if (!this.tags) this.tags = data.categories;
                });

            return fetchCurseData();
        } else {
            return reject('unimplemented');
        }

        // TODO Implement enhanced metadata fetchers
        // - KSP Forums
        // - GitHub README.md
    }
}

export class KSPMod {
    versions: [KSPModVersion] = [];

    addVersion(specification) {
        try {
            this.versions.push(new KSPModVersion(specification));
            this.versions.sort((a, b) => a.version.compareAgainst(b.version));
        } catch(err) {
            console.warn(`Failed to add version for '${specification.identifier}': ${err}`);
        }
    }

    isCompatibleWithKSP(kspVersion: Version) {
        for (let version in this.versions)
            if (this.versions.hasOwnProperty(version)
                && this.versions[version].isCompatibleWithKSP(kspVersion))
                return true;

        return false;
    }

    getVersionForKSP(kspVersion) {
        for (let i = this.versions.length - 1; i >= 0; i--)
            if (this.versions[i].isCompatibleWithKSP(kspVersion))
                return this.versions[i];
    }

    get latest(): KSPModVersion {
        return this.versions[this.versions.length - 1];
    }

    get identifier(): String {
        return this.versions.length ? this.versions[0].identifier : '';
    }
}