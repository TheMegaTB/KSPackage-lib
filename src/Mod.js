// @flow

import {get} from 'request-promise-native';
import {Version} from './Version';
import {any, contains, DelayPromise, getLeadingPath, regexEscape} from './helpers';
import path from "path";

type URL = String;
type ModReference = {};

const flattenModReferences = referenceList => {
    if (referenceList) return referenceList.map(reference => reference.name);
    else return [];
};

const spacedockIDRegex = /spacedock\.info\/mod\/(\d+?)\//;
const curseIDRegex = /kerbal\.curseforge\.com\/projects\/(\d+)/;
const xcurseIDRegex = /www\.curse\.com\/ksp-mods\/kerbal\/\d+-(.*)/;

export class KSPModInstallDirective {
    // Either file, find, or find_regexp is required
    file: String;
    find: String;
    find_regexp: String;

    // Options
    find_matches_files: boolean;

    // Target
    install_to: String;
    as: String;
    filter: [String];
    filter_regexp: [String];
    include_only: [String];
    include_only_regexp: [String];

    constructor(directive) {
        // Copy over all properties
        for (let key in directive)
            if (directive.hasOwnProperty(key)) this[key] = directive[key];

        // Check for the target directive
        if (!this.install_to) throw new Error("Install directives may contain a install_to");

        // Normalize install_to
        this.install_to = path.normalize(this.install_to);

        // Make sure we have either a `file`, `find`, or `find_regexp`
        const source = [this.file, this.find, this.find_regexp].filter(x => x);
        if (source.length !== 1) throw new Error("Install directives may contain one of file, find, find_regexp");

        // Make sure only filter or include_only fields exist but not both at the same time
        const filters = [this.filter, this.filter_regexp].filter(x => x);
        const includes = [this.include_only, this.include_only_regexp].filter(x => x);
        if (filters > 0 && includes > 0) throw new Error("Install directives can only contain filter or include_only directives, not both");
    }

    convertFindToFile(files, directories) {
        if (this.file) return this;

        // Match *only* things with our find string as a directory.
        // We can't just look for directories, because some zipfiles
        // don't include entries for directories, but still include entries
        // for the files they contain.
        const inst_filt = this.find !== undefined
            ? new RegExp("(?:^|/)" + regexEscape(this.find) + "$", 'i')
            : new RegExp(this.find_regexp, 'i');

        // Find the shortest directory path that matches our filter,
        // including all parent directories of all entries.
        let shortest;
        if (this.find_matches_files) {
            // TODO Run over 'files'
        }

        for (let dir of directories) {
            // Remove trailing slash
            dir = dir.replace(/\/$/g, '');

            // TODO No idea what this would be good for but its being used in CKAN
            const dirName = path.basename(dir);

            // Check against search regex
            if ((!shortest || dir.length < shortest.length) && inst_filt.test(dir))
                shortest = dir;
        }

        if (!shortest) {
            throw new Error(`Could not find ${this.find || this.find_regexp} entry in zipfile to install`);
        }

        const findDirective = new KSPModInstallDirective(this);
        findDirective.file = shortest;
        findDirective.find = null;
        findDirective.find_regexp = null;
        return findDirective;
    }

    matches(path) {
        if (this.file === null) throw new Error('Only supported with file directive');

        // We want everthing that matches our 'file', either as an exact match,
        // or as a path leading up to it.
        const wantedFilter = new RegExp('^' + regexEscape(this.file) + '(/|$)');

        // If it doesn't match the filter ignore it
        if (!wantedFilter.test(path)) return false;

        // Exclude .ckan files
        if (/.ckan$/i.test(path)) return false;

        // Split path into components
        const components = path.toLowerCase().split('/');

        // Check filters
        if (this.filter && any(this.filter, filter => contains(components, filter.toLowerCase()))) return false;
        if (this.filter_regexp && any(this.filter_regexp, regex => new RegExp(regex).test(path))) return false;

        // Check includes
        if (this.include_only && any(this.include_only, include => contains(components, include.toLowerCase()))) return true;
        if (this.include_only_regexp && any(this.include_only_regexp, regex => new RegExp(regex).test(path))) return true;

        return !(this.include_only || this.include_only_regexp);
    }

    transformOutputName(outputName, installDirectory) {
        let leadingPathToRemove = getLeadingPath(this.file);

        // Special-casing, if this.file is just "GameData" or "Ships", strip it.
        // TODO from CKAN: Do we need to do anything special for tutorials or GameRoot?
        if (leadingPathToRemove.length === 0 && (this.file === 'GameData' || this.file === 'Ships')) {
            leadingPathToRemove = this.file;
            if (this.as) throw new Error("Cannot specify `as` if `file` is GameData or Ships.");
        }

        // If there's a leading path to remove, then we have some extra work that needs doing...
        if (leadingPathToRemove.length > 0) {
            const leadingRegex = new RegExp('^' + regexEscape(leadingPathToRemove) + '/');

            if (!leadingRegex.test(outputName)) throw new Error(`Output file name (${outputName}) not matching leading path of stanza.file (${leadingRegex})`);

            // Strip off leading path name
            outputName = outputName.replace(leadingRegex, "");
        }

        // If an `as` is specified, replace the first component in the file path with the value of `as`
        // This works for both when `find` specifies a directory and when it specifies a file.
        if (this.as) {
            if (contains(this.as, '/')) throw new Error('`as` may not contain path separators.');

            const components = outputName.split('/').filter(x => x);
            components[0] = this.as;
            outputName = components.join('/');
        }

        return path.normalize(path.join(installDirectory, outputName));
    }
}

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
        this.install = (spec.install || [{install_to: 'GameData', find: spec.identifier}])
            .map(directive => new KSPModInstallDirective(directive));

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