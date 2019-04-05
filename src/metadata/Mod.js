// @flow
import crypto from 'crypto';
import {get} from 'request-promise-native';
import {Version} from './Version';
import {any, contains, DelayPromise, getLeadingPath, regexEscape} from '../helpers';
import path from 'path';
import type {
	CKANModSpecification,
	ModIdentifier,
	ModInstallDirective,
	ModReference,
	ModResources
} from '../types/CKANModSpecification';
import type {URL} from '../types/internal';

const flattenModReferences = (referenceList: ?Array<ModReference>): Array<string> => {
    if (referenceList) return referenceList.map(reference => reference.name);
    else return [];
};

const spacedockIDRegex = /spacedock\.info\/mod\/(\d+?)\//;
const curseIDRegex = /kerbal\.curseforge\.com\/projects\/(\d+)/;
const xcurseIDRegex = /www\.curse\.com\/ksp-mods\/kerbal\/\d+-(.*)/;

export class KSPModInstallDirective {
    // Either file, find, or find_regexp is required
    file: ?string;
    find: ?string;
    find_regexp: ?string;

    // Options
    find_matches_files: ?boolean;

    // Target
    install_to: ?string;
    as: ?string;
    filter: ?Array<string>;
    filter_regexp: ?Array<string>;
    include_only: ?Array<string>;
    include_only_regexp: ?Array<string>;

    constructor(directive: KSPModInstallDirective | ModInstallDirective) {
        // Copy over all properties
        this.file = directive.file;
        this.find = directive.find;
        this.find_regexp = directive.find_regexp;

        this.find_matches_files = directive.find_matches_files;

        this.install_to = directive.install_to;
        this.as = directive.as;
        this.filter = directive.filter;
        this.filter_regexp = directive.filter_regexp;
        this.include_only = directive.include_only;
        this.include_only_regexp = directive.include_only_regexp;

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
        if (filters.length > 0 && includes.length > 0) throw new Error("Install directives can only contain filter or include_only directives, not both");
    }

    convertFindToFile(files: Array<string>, directories: Set<string>) {
        if (this.file) return this;

        // Match *only* things with our find string as a directory.
        // We can't just look for directories, because some zipfiles
        // don't include entries for directories, but still include entries
        // for the files they contain.
        const inst_filt = this.find != null
            ? new RegExp("(?:^|/)" + regexEscape(this.find) + "$", 'i')
            : new RegExp(this.find_regexp || '', 'i');

        // Find the shortest directory path that matches our filter,
        // including all parent directories of all entries.
        let shortest;
        if (this.find_matches_files) {
            for (let file of files) {
                // Check against search regex
                if ((!shortest || file.length < shortest.length) && inst_filt.test(file))
                    shortest = file;
            }
        }

        for (let dir of directories) {
            // Remove trailing slash
            dir = dir.replace(/\/$/g, '');

            // TODO No idea what this would be good for but its being used in CKAN
            //      It seems that is is being used for creating empty directories. Currently those are being ignored.
            // const dirName = path.basename(dir);

            // Check against search regex
            if ((!shortest || dir.length < shortest.length) && inst_filt.test(dir))
                shortest = dir;
        }

        if (!shortest) {
            throw new Error(`Could not find ${this.find || this.find_regexp || "''"} entry in zipfile to install`);
        }

        const findDirective = new KSPModInstallDirective(this);
        findDirective.file = shortest;
        findDirective.find = null;
        findDirective.find_regexp = null;
        return findDirective;
    }

    matches(path: string) {
        if (this.file == null) throw new Error('Only supported with file directive');

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

    transformOutputName(outputName: string, installDirectory: string): string {
        if (this.file == null) throw new Error("Only supported with file directive");
        let leadingPathToRemove = getLeadingPath(this.file);

        // Special-casing, if this.file is just "GameData" or "Ships", strip it.
        // TODO from CKAN: Do we need to do anything special for tutorials or GameRoot?
        if (leadingPathToRemove.length === 0 && (this.file === 'GameData' || this.file === 'Ships')) {
            leadingPathToRemove = this.file;
            if (this.as) throw new Error("Cannot specify `as` if `file` is GameData or Ships.");
        }

        // If there's a leading path to remove, then we have some extra work that needs doing...
        if (leadingPathToRemove.length > 0) {
            const leadingRegexString = '^' + regexEscape(leadingPathToRemove) + '/';
            const leadingRegex = new RegExp(leadingRegexString);

            if (!leadingRegex.test(outputName)) throw new Error(`Output file name (${outputName}) not matching leading path of stanza.file (${leadingRegexString})`);

            // Strip off leading path name
            outputName = outputName.replace(leadingRegex, "");
        }

        // If an `as` is specified, replace the first component in the file path with the value of `as`
        // This works for both when `find` specifies a directory and when it specifies a file.
        if (this.as) {
            const as = this.as;
            if (contains(as, '/')) throw new Error('`as` may not contain path separators.');

            const components = outputName.split('/').filter(x => x);
            components[0] = as;
            outputName = components.join('/');
        }

        return path.normalize(path.join(installDirectory, outputName));
    }
}

export class KSPModVersion {
    // Base metadata
    name: ModIdentifier;
    abstract: string;
    identifier: string;

    author: string | [string];
    description: string;

    download: URL;
    downloadSize: number;
    license: string;
    releaseStatus: string;

    version: Version;
    kspVersion: Version;
    kspVersionMin: ?Version;
    kspVersionMax: ?Version;
    kspVersionStrict: boolean;

    tags: ?Array<string>;
    install: Array<KSPModInstallDirective>;

    depends: Array<string>;
    conflicts: Array<string>;
    provides: Array<string>;

    recommends: Array<string>;
    suggests: Array<string>;

    resources: ModResources;

    // Enhanced metadata (call fetchEnhancedMetadata to retrieve)
    descriptionHTML: string;
    screenshot: URL;
	website: URL;
    downloads: Number;
    followers: Number;
    changelog: Array<{
        changelog: string,
        friendly_version: string
    }>;

    get uid() {
        const hash = crypto.createHash('md5');
        hash.update(this.identifier);
        hash.update(this.version.stringRepresentation);
        return hash.digest('hex');
    }

    constructor(spec: CKANModSpecification) {
        if (spec.kind === 'metapackage') throw new Error(`Metapackages are not supported yet.`);

        this.name = spec.name;
        this.abstract = spec.abstract;
        this.identifier = spec.identifier;

        this.author = spec.author;
        this.description = spec.description;

        this.download = spec.download;
        this.downloadSize = spec.download_size;
        this.license = spec.license;
        this.releaseStatus = spec.releaseStatus;

        this.version = new Version(spec.version);
        if (spec.ksp_version) this.kspVersion = new Version(spec.ksp_version);
        if (spec.ksp_version_min) this.kspVersionMin = new Version(spec.ksp_version_min);
        if (spec.ksp_version_max) this.kspVersionMax = new Version(spec.ksp_version_max);
        this.kspVersionStrict = spec.ksp_version_strict ? spec.ksp_version_strict : false;

        if (this.kspVersion && (this.kspVersionMin || this.kspVersionMax)) throw new Error("Both kspVersion and kspVersionMin/Max are given.");

        this.tags = spec.tags;
        if (spec.install) this.install = spec.install.map(directive => new KSPModInstallDirective(directive));
        else this.install = [ new KSPModInstallDirective({
            file: undefined,
            find: spec.identifier,
            find_regexp: undefined,

            find_matches_files: undefined,
    
            install_to: 'GameData',
            as: undefined,
            filter: undefined,
            filter_regexp: undefined,
            include_only: undefined,
            include_only_regexp: undefined
        }) ];

        this.depends = flattenModReferences(spec.depends);
        this.conflicts = flattenModReferences(spec.conflicts);
        this.provides = spec.provides || [];

        this.recommends = flattenModReferences(spec.recommends);
        this.suggests = flattenModReferences(spec.suggests);

        this.resources = spec.resources || {};
        if (spec.resources && spec.resources.x_screenshot) this.screenshot = spec.resources.x_screenshot;
    }

    providesFeature(feature: string): boolean {
        return (this.provides && this.provides.indexOf(feature) > -1) || this.identifier === feature;
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
            const maxVersion = this.kspVersionMax;
            const minVersion = this.kspVersionMin;
            const lowerBound = kspVersion.compareAgainst(minVersion, componentsToCompare);
            const upperBound = kspVersion.compareAgainst(maxVersion, componentsToCompare);
            return (lowerBound === Version.EQUAL || lowerBound === Version.NEWER)
                && (upperBound === Version.EQUAL || upperBound === Version.OLDER);
        }
    }

    fetchEnhancedMetadata(): Promise<void> {
        const reject = reason => new Promise((resolve, reject) => reject(reason));

        if (this.resources.spacedock) {
            const modIDMatch = spacedockIDRegex.exec(this.resources.spacedock);
			if (!modIDMatch) return reject('Mod ID not found');
            const modID = modIDMatch[1];

            return get(`https://spacedock.info/api/mod/${modID}`)
                .then(JSON.parse)
                .then(data => {
					if (data.short_description) this.abstract = data.short_description;
					if (data.description) this.description = data.description;
					if (data.description_html) this.descriptionHTML = data.description_html;
					if (data.background) this.screenshot = `https://spacedock.info${data.background}`;
					if (data.downloads) this.downloads = data.downloads;
					if (data.followers) this.followers = data.followers;
                });
        } else if (this.resources.curse || this.resources.x_curse) {
            let uri = '';

            if (this.resources.curse) {
                const modIDMatch = curseIDRegex.exec(this.resources.curse);
				if (!modIDMatch) return reject('Mod ID not found');
                uri = `https://api.cfwidget.com/project/${modIDMatch[1]}`
            } else if (this.resources.x_curse) {
                const modIDMatch = xcurseIDRegex.exec(this.resources.x_curse);
				if (!modIDMatch) return reject('Mod ID not found');
                uri = `https://api.cfwidget.com/kerbal/ksp-mods/${modIDMatch[1]}`
            } else {
				return reject('Mod ID not found');
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
			return reject('No enhanced metadata available');
        }

        // TODO Implement enhanced metadata fetchers
        // - KSP Forums
        // - GitHub README.md
    }
}

export class KSPMod {
    versions: Array<KSPModVersion> = [];

    addVersion(specification: CKANModSpecification) {
        this.versions.push(new KSPModVersion(specification));
        this.versions.sort((a, b) => a.version.compareAgainst(b.version));
    }

    isCompatibleWithKSP(kspVersion: Version): boolean {
        for (let version of this.versions)
            if (version.isCompatibleWithKSP(kspVersion))
                return true;

        return false;
    }

    getLatestVersionForKSP(kspVersion: Version): ?KSPModVersion {
        for (let i = this.versions.length - 1; i >= 0; i--)
            if (this.versions[i].isCompatibleWithKSP(kspVersion))
                return this.versions[i];
    }

    getVersionsForKSP(kspVersion: Version): Array<KSPModVersion> {
        return this.versions.filter(version => version.isCompatibleWithKSP(kspVersion));
    }

    getSpecificVersion(version: Version): ?KSPModVersion {
        return this.versions.find(modVersion => modVersion.version.compareAgainst(version) === Version.EQUAL);
    }

    get latest(): KSPModVersion {
        // TODO Handle the case where there are no versions
        return this.versions[this.versions.length - 1];
    }

    // TODO Might be confusing and identifiers might change over the course of time. Remove this.
    get identifier(): string {
        return this.versions.length ? this.versions[0].identifier : '';
    }
}