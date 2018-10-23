//@flow
import fs from 'fs';
import path from 'path';
import {Version} from "./Version";
import Repository from "./Repository";
import {KSPModVersion} from "./Mod";
import DependencyResolver from "./DependencyResolver";

const providesFeature = feature => (mod: KSPModVersion) => (mod.provides && mod.provides.indexOf(feature) > -1) || mod.identifier === feature;

export default class KSPackage {
    _storageDirectory: string;
    get storageDirectory(): string { return this._storageDirectory; }
    set storageDirectory(value: string) {
        // $FlowFixMe
        if (!fs.existsSync(value)) fs.mkdirSync(value, { recursive: true });
        this._storageDirectory = value;
    }

    _temporaryDirectory: string;
    get temporaryDirectory(): string { return this._temporaryDirectory; }
    set temporaryDirectory(value: string) {
        // $FlowFixMe
        if (!fs.existsSync(value)) fs.mkdirSync(value, { recursive: true });
        this._temporaryDirectory = value;
    }

    _kspVersion: Version = new Version('any');
    get kspVersion(): Version { return this._kspVersion; }
    set kspVersion(value: Version) {
        this._kspVersion = value;
        this.repository.updateCompatibleMods();
    }

    repository: Repository = new Repository(this);

    constructor() {
        // TODO replace this with cross-platform code:
        // process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + 'Library/Preferences' : process.env.HOME + '.local/share');
        const isMacOS = process.platform === 'darwin';
        const isWindows = process.env.APPDATA !== undefined;

        if (isMacOS) this.storageDirectory = path.join(process.env.HOME || '', 'Library', 'Application Support', 'KSPackage');
        else if (isWindows) this.storageDirectory = path.join(process.env.APPDATA, 'KSPackage');
        else this.storageDirectory = path.join(process.env.HOME, '.local', 'share', 'KSPackage');

        this.temporaryDirectory = path.join('/tmp', 'KSPackage');
    }

    getDependencyChoices(feature): [KSPModVersion] {
        return this.repository._compatibleMods
            .filter(providesFeature(feature));
    }

    getMod(identifier): KSPModVersion {
        return this.repository._compatibleMods
            .find(mod => mod.identifier === identifier);
    }

    getResolverForInstallationOf(mods): DependencyResolver {
        return new DependencyResolver(
            mods,
            id => {
                const resolved = this.getMod(id);
                if (!resolved) console.log("Unable to resolve mod:", id);
                return resolved;
            },
            feature => this.getDependencyChoices(feature)
        );
    }
}