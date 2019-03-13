//@flow
import fs from 'fs-extra';
import path from 'path';
import Store from 'data-store';
import {Version} from "./Version";
import Repository from "./Repository";
import {KSPModVersion} from "./Mod";
import DependencyResolver from "./DependencyResolver";
import type {FileMap, FileMapEntry} from "./Installation";
import KSPInstallation from "./Installation";

export class ChangeSetType {
    static INSTALL = true;
    static UNINSTALL = false;
}

export default class KSPackage {
    // --- Getter & Setter
    _storageDirectory: string;
    get storageDirectory(): string { return this._storageDirectory; }
    set storageDirectory(value: string) {
        fs.ensureDir(value);
        this._storageDirectory = value;
    }

    _temporaryDirectory: string;
    get temporaryDirectory(): string { return this._temporaryDirectory; }
    set temporaryDirectory(value: string) {
        fs.ensureDir(value);
        this._temporaryDirectory = value;
    }

    _cacheDirectory: string;
    get cacheDirectory(): string { return this._cacheDirectory; }
    set cacheDirectory(value: string) {
        fs.ensureDir(value);
        this._cacheDirectory = value;
    }

    // TODO Remove this. Should be handled by KSPInstallation. Used in Repository.
    _kspVersion: Version = new Version('any');
    get kspVersion(): Version { return this._kspVersion; }
    set kspVersion(value: Version) {
        this._kspVersion = value;
    }

    // --- Other variables

    repository: Repository;
    dataStorage: Store;
    // TODO Move the changeSet into the installation.
    changeSet = {};
    installation: KSPInstallation;

    // --- Constructor and initializer

    constructor(kspInstallation: KSPInstallation) {
        // TODO Make kspInstallation optional and search for the installation based on the OS
        // Reference: https://github.com/KSP-CKAN/CKAN/blob/master/Core/KSPPathUtils.cs#L16

        const home = process.env.HOME || '/';
        switch (process.platform) {
            case 'darwin': // macOS
                this.storageDirectory = path.join(home, 'Library', 'Application Support', 'KSPackage');
                this.temporaryDirectory = path.join('/tmp', 'KSPackage');
                this.cacheDirectory = path.join(home, 'Library', 'Caches', 'KSPackage');
                break;
            case 'win32':
                const appData = process.env.APPDATA || 'C:\\appData';
                const temp = process.env.TEMP || 'C:\\tmp';
                this.storageDirectory = path.join(appData, 'KSPackage');
                this.temporaryDirectory = path.join(temp, 'KSPackage');
                this.cacheDirectory = path.join(appData, 'KSPackage', 'cache');
                break;
            case 'linux':
                this.storageDirectory = path.join(home, '.local', 'share', 'KSPackage');
                this.temporaryDirectory = path.join('/tmp', 'KSPackage');
                this.cacheDirectory = path.join(home, '.cache', 'KSPackage');
                break;
            default:
                throw new Error("Unrecognized operating system. Unable to set storage directories.");
        }

        // Initialize the data store
        this.dataStorage = new Store({ path: path.join(this.storageDirectory, 'data.json') });

        // Initialize the repository
        // TODO Remove strong coupling with `this` from Repository
        this.repository = new Repository(this);

        // Store the KSP installation
        this.installation = kspInstallation;
    }

    async init() {
        await this.repository.init();
    }

    // --- Internal stuff

    _getInstalledOrLatestModVersion(identifier: string): ?KSPModVersion {
        const installedVersion = this.installation.versionOfInstalledMod(identifier);
        if (installedVersion) {
            const installedModVersion = this.repository.getModVersion(identifier, installedVersion);
            if (installedModVersion) return installedModVersion;
        }

        return this.repository.modByIdentifier(identifier, this.kspVersion);
    }

    _getResolverForInstallationOf(mods: Array<string>, useLockFileForVersions: boolean): DependencyResolver {
        return new DependencyResolver(
            mods,
            id => {
                const mod = this._getInstalledOrLatestModVersion(id);
                if (!mod) throw new Error(`Unable to resolve mod: ${id}`);
                return mod;
            },
            feature => {
                const providingMods = this.repository.compatibleModsProvidingFeature(this.kspVersion, feature);

                return Object.keys(providingMods).reduce((acc, modID) => {
                    const availableVersions = providingMods[modID];
                    const installedVersion = this.installation.versionOfInstalledMod(modID);

                    if (installedVersion && useLockFileForVersions) {
                        const installedModVersion = availableVersions.find(mod => mod.version.compareAgainst(installedVersion) === Version.EQUAL);
                        acc.push(installedModVersion);
                    } else if (availableVersions.length > 0) {
                        acc.push(availableVersions[availableVersions.length - 1]);
                    }

                    return acc;
                }, []);
            }
        );
    }

    // --- ChangeSet methods

    queueForInstallation(modIdentifier: string) {
        const providers = this.repository.compatibleModsProvidingFeature(this.kspVersion, modIdentifier);
        if (Object.keys(providers).length === 0)
            throw new Error(`Mod is not available for KSP ${this.kspVersion.stringRepresentation}`);

        this.changeSet[modIdentifier] = ChangeSetType.INSTALL;
    }

    queueForRemoval(modIdentifier: string) {
        if (this.installation.installedMods.indexOf(modIdentifier) === -1)
            throw new Error(`${modIdentifier} is not currently installed.`);

        this.changeSet[modIdentifier] = ChangeSetType.UNINSTALL;
    }

    // --- Change set applying

    _buildDependencyTrees(useLockFileForVersions: boolean): DependencyResolver {
        // Filter out mods queued for removal
        // TODO Figure out what to do when a user wants to uninstall a mod that is both explicit and a dependency of another explicitly specified mod.
        const newSetOfInstalled = this.installation.explicitlyInstalledMods.filter(modID =>
            !(this.changeSet.hasOwnProperty(modID) && this.changeSet[modID] === ChangeSetType.UNINSTALL)
        );

        // Add mods queued for installation
        for (let modID in this.changeSet) {
            if (this.changeSet.hasOwnProperty(modID) && this.changeSet[modID])
                newSetOfInstalled.push(modID);
        }

        // Create a DependencyResolver instance and build the dependency trees.
        const resolver = this._getResolverForInstallationOf(newSetOfInstalled, useLockFileForVersions);
        resolver.buildDependencyTrees();

        // Check if the resolver would actually work
        if (resolver.resolvableSets.length === 0)
            throw new Error('Unresolvable changeset.'); // TODO Return which dependencies are unresolvable

        // Clear the changeSet and set the resolver.
        this.changeSet = {};

        return resolver;
    }

    async _buildFileMap(mods: Array<KSPModVersion>): Promise<FileMap> {
        const fileTrees = await Promise.all(
            mods.map(async mod => await this.installation.modFileMap(mod))
        );

        const fileMap: { [string]: FileMapEntry } = fileTrees.reduce((finalTree, tree) => {
            tree.forEach(entry => {
                // TODO Handle conflicts according to the dependency tree (further up in tree takes priority)
                if (finalTree.hasOwnProperty(entry.destination)) console.warn("Overwriting destination directive!");
                finalTree[entry.destination] = entry
            });

            return finalTree;
        }, {});

        return Object.keys(fileMap).map(key => fileMap[key]);
    }

    // TODO Provide status feedback (what is currently being operated on)
    async applyChangeSet(resolveChoiceClosure: (choice: Object) => Promise<void>, useLockFileForChoices: boolean = true, useLockFileForVersions: boolean = true) {
        let choiceResolver = resolveChoiceClosure;

        if (useLockFileForChoices) {
            const previousInstallSet = this.installation.installedModEntities;
            choiceResolver = async (choice) => {
                // Check if the choice can be resolved through the lockfile
                // TODO This might cause issues if the user wants to uninstall a locked choice
                // TODO In this case it should ask him again instead of using the lockfile
                for (let choiceOptionIdentifier of choice.choices) {
                    if (Object.keys(previousInstallSet).indexOf(choiceOptionIdentifier) > -1) {
                        choice.select(choiceOptionIdentifier);
                        console.log("Auto resolved choice through lockfile:", choice.feature, '->', choiceOptionIdentifier);
                        return;
                    }
                }

                // Ask the resolveChoiceClosure if we can't resolve it
                await resolveChoiceClosure(choice);
            };
        }

        console.time('buildingDependencyTrees');
        const resolver: DependencyResolver = this._buildDependencyTrees(useLockFileForVersions);
        console.timeEnd('buildingDependencyTrees');
        const installSet: {} = await resolver.resolveChoices(choiceResolver);
        const pendingForInstall = Object.keys(installSet);
        const pendingForInstallMods = this.modIDListToModList(pendingForInstall);

        pendingForInstallMods.forEach(mod => {
            installSet[mod.identifier].version = mod.version.stringRepresentation;
        });

        // 0. Download missing prerequisites and build the current and target file map
        const previouslyInstalledMods = this.modIDListToModList(this.installation.installedMods);
        const currentFileTree = await this._buildFileMap(previouslyInstalledMods);
        const newFileTree = await this._buildFileMap(pendingForInstallMods);

        // 1. Unlink all previously installed mods
        console.log("Unlinking mods:", this.installation.installedMods);
        await this.installation.unlinkFiles(currentFileTree);

        // 2. Write updated lock file
        console.log("Writing lockfile and updating installed mod list ...");
        this.installation.writeInstalledModsToLockFile(installSet);

        // 3. Link new and previously installed mods
        console.log("Linking mods:", pendingForInstall);
        await this.installation.linkFiles(newFileTree)
    }

    modIDListToModList(modIDs: Array<string>): Array<KSPModVersion> {
        return modIDs.map(modID => {
            const mod = this._getInstalledOrLatestModVersion(modID);
            if (!mod) throw new Error("Unable to resolve mod.");
            return mod;
        });
    }
}