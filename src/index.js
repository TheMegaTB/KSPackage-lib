//@flow
import path from 'path';
import Store from 'data-store';
import {Version} from "./metadata/Version";
import Repository from "./metadata/Repository";
import {KSPModVersion} from "./metadata/Mod";
import DependencyResolver from "./management/DependencyResolver";
import type {FileMap, FileMapEntry, InstalledModMap} from "./management/Installation";
import KSPInstallation from "./management/Installation";
import type {ModIdentifier} from "./types/CKANModSpecification";
import type {DependencyChoice} from "./management/DependencyResolver";
import type {DirectorySet} from "./types/internal";
import {getPlatformSpecificDirectories} from "./helpers";

export class ChangeSetType {
    static INSTALL = 'INSTALL';
    static UNINSTALL = 'UNINSTALL';
}

export default class KSPackage {
    // --- Public variables
    get kspVersion(): Version { return this._installation.kspVersion; }
    get installedMods(): InstalledModMap { return this._installation.installedModEntities; }
    get queuedChanges(): { [string]: boolean } { return this._installation.changeSet; }

    // --- Private variables

    _repository: Repository;
    _dataStorage: Store;
    _installation: KSPInstallation;

    // --- Constructor and initializer

    static async create(kspInstallation: ?KSPInstallation) {
        const directories = getPlatformSpecificDirectories();

        const repository = new Repository(directories);
        const installation = kspInstallation ? kspInstallation : await KSPInstallation.autodetectSteamInstallation();

        const instance = new KSPackage(installation, repository, directories);
        await instance.init();

        return instance;
    }

    async init() {
        await this._repository.init();
    }

    constructor(installation: KSPInstallation, repository: Repository, directories: DirectorySet) {
        // Initialize the data store (not currently used at the moment - intended for persistent settings)
        this._dataStorage = new Store({ path: path.join(directories.storage, 'kspackage.json') });

        // Initialize the repository
        this._repository = repository;

        // Store the KSP installation
        this._installation = installation;
    }

    // --- Public methods

    // - Interacting with the change set

    queueForInstallation(modIdentifier: ModIdentifier) {
        const providers = this._repository.compatibleModsProvidingFeature(this.kspVersion, modIdentifier);
        if (Object.keys(providers).length === 0)
            throw new Error(`Mod is not available for KSP ${this.kspVersion.stringRepresentation}`);

        this._installation.queueForInstallation(modIdentifier);
    }

    queueForRemoval(modIdentifier: ModIdentifier) {
        if (this._installation.installedMods.indexOf(modIdentifier) === -1)
            throw new Error(`${modIdentifier} is not currently installed.`);
        this._installation.queueForRemoval(modIdentifier);
    }

    dequeue(modIdentifier: ModIdentifier) {
        this._installation.dequeue(modIdentifier);
    }

    // TODO Provide status feedback (what is currently being operated on)
    async applyChangeSet(resolveChoiceClosure: (choice: DependencyChoice) => Promise<void>, useLockFileForChoices: boolean = true, useLockFileForVersions: boolean = true) {
        let choiceResolver = resolveChoiceClosure;

        if (useLockFileForChoices) choiceResolver = this._lockFileChoiceResolver(resolveChoiceClosure);

        const resolver: DependencyResolver = this._buildDependencyTrees(useLockFileForVersions);
        const installSet: {} = await resolver.resolveChoices(choiceResolver);
        const pendingForInstall = Object.keys(installSet);
        const pendingForInstallMods = this._modIDListToModList(pendingForInstall);

        pendingForInstallMods.forEach(mod => {
            installSet[mod.identifier].version = mod.version.stringRepresentation;
        });

        // 0. Download missing prerequisites and build the current and target file map
        const previouslyInstalledMods = this._modIDListToModList(this._installation.installedMods);
        const currentFileTree = await this._buildFileMap(previouslyInstalledMods);
        const newFileTree = await this._buildFileMap(pendingForInstallMods);

        // 1. Unlink all previously installed mods
        console.log("Unlinking mods:", this._installation.installedMods);
        await this._installation.unlinkFiles(currentFileTree);

        // 2. Write updated lock file
        console.log("Writing lockfile and updating installed mod list ...");
        this._installation.writeInstalledModsToLockFile(installSet);

        // 3. Link new and previously installed mods
        console.log("Linking mods:", pendingForInstall);
        await this._installation.linkFiles(newFileTree)
    }

    // --- Private methods

    // - Retrieving mods

    _getInstalledOrLatestModVersion(identifier: string): ?KSPModVersion {
        const installedVersion = this._installation.versionOfInstalledMod(identifier);
        if (installedVersion) {
            const installedModVersion = this._repository.getModVersion(identifier, installedVersion);
            if (installedModVersion) return installedModVersion;
        }

        return this._repository.modByIdentifier(identifier, this.kspVersion);
    }

    _modIDListToModList(modIDs: Array<string>): Array<KSPModVersion> {
        return modIDs.map(modID => {
            const mod = this._getInstalledOrLatestModVersion(modID);
            if (!mod) throw new Error("Unable to resolve mod.");
            return mod;
        });
    }

    // - Applying the change set

    _getResolverForInstallationOf(mods: Array<string>, useLockFileForVersions: boolean): DependencyResolver {
        return new DependencyResolver(
            mods,
            id => {
                const mod = this._getInstalledOrLatestModVersion(id);
                if (!mod) throw new Error(`Unable to resolve mod: ${id}`);
                return mod;
            },
            feature => {
                const providingMods = this._repository.compatibleModsProvidingFeature(this.kspVersion, feature);

                return Object.keys(providingMods).reduce((acc, modID) => {
                    const availableVersions = providingMods[modID];
                    const installedVersion = this._installation.versionOfInstalledMod(modID);

                    if (installedVersion && useLockFileForVersions) {
                        const installedModVersion = availableVersions.find(mod => mod.version.compareAgainst(installedVersion) === Version.EQUAL);
                        if (installedModVersion) acc.push(installedModVersion);
                        else {
                            console.warn(`Unable to satisfy pinned version (${installedVersion.stringRepresentation}) for '${modID}'! Using latest instead.`);
                            if (availableVersions.length > 0) acc.push(availableVersions[availableVersions.length - 1]);
                        }
                    } else if (availableVersions.length > 0) {
                        acc.push(availableVersions[availableVersions.length - 1]);
                    }

                    return acc;
                }, []);
            }
        );
    }

    _buildDependencyTrees(useLockFileForVersions: boolean): DependencyResolver {
        // Filter out mods queued for removal
        // TODO Figure out what to do when a user wants to uninstall a mod that is both explicit and a dependency of another explicitly specified mod.
        const newSetOfInstalled = this._installation.explicitlyInstalledMods.filter(modID =>
            !(this._installation.changeSet.hasOwnProperty(modID) && this._installation.changeSet[modID] === ChangeSetType.UNINSTALL)
        );

        // Add mods queued for installation
        for (let modID in this._installation.changeSet) {
            if (this._installation.changeSet.hasOwnProperty(modID) && this._installation.changeSet[modID] === ChangeSetType.INSTALL)
                newSetOfInstalled.push(modID);
        }

        // Create a DependencyResolver instance and build the dependency trees.
        const resolver = this._getResolverForInstallationOf(newSetOfInstalled, useLockFileForVersions);
        resolver.buildDependencyTrees();

        // Check if the resolver would actually work
        if (resolver.resolvableSets.length === 0)
            throw new Error('Unresolvable changeset.'); // TODO Return which dependencies are unresolvable

        // Clear the changeSet and set the resolver.
        this._installation.clearChangeSet();

        return resolver;
    }

    async _buildFileMap(mods: Array<KSPModVersion>): Promise<FileMap> {
        const fileTrees = await Promise.all(
            mods.map(async mod => await this._installation.modFileMap(mod))
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

    _lockFileChoiceResolver(resolveChoiceClosure: (choice: DependencyChoice) => Promise<void>) {
        const previousInstallSet = this._installation.installedModEntities;
        return async (choice: DependencyChoice) => {
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
}