//@flow
import fs from 'fs-extra';
import path from 'path';
import Store from 'data-store';
import {Version} from "./Version";
import Repository from "./Repository";
import {KSPModVersion} from "./Mod";
import DependencyResolver from "./DependencyResolver";
import KSPInstallation from "./Installation";

const providesFeature = feature => (mod: KSPModVersion) => (mod.provides && mod.provides.indexOf(feature) > -1) || mod.identifier === feature;

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

    _kspVersion: Version = new Version('any');
    get kspVersion(): Version { return this._kspVersion; }
    set kspVersion(value: Version) {
        this._kspVersion = value;
        this.repository.updateCompatibleMods();
    }

    // --- Other variables

    repository: Repository;
    dataStorage: Store;
    changeSet = {};
    installation: KSPInstallation;

    // --- Constructor and initializer

    constructor(kspInstallation: KSPInstallation) {
        const isMacOS = process.platform === 'darwin';
        const isWindows = process.env.APPDATA !== undefined;

        if (isMacOS) this.storageDirectory = path.join(process.env.HOME || '', 'Library', 'Application Support', 'KSPackage');
        else if (isWindows) this.storageDirectory = path.join(process.env.APPDATA, 'KSPackage');
        else this.storageDirectory = path.join(process.env.HOME, '.local', 'share', 'KSPackage');

        // TODO Add M$ windows handling
        if (isWindows) this.temporaryDirectory = path.join(process.env.TEMP, 'KSPackage');
        else this.temporaryDirectory = path.join('/tmp', 'KSPackage');

        if (isMacOS) this.cacheDirectory = path.join(process.env.HOME, 'Library', 'Caches', 'KSPackage');
        else if (isWindows) this.cacheDirectory = path.join(process.env.APPDATA, 'KSPackage', 'cache');
        else this.cacheDirectory = path.join(process.env.HOME, '.cache', 'KSPackage');

        // Initialize the data store
        this.dataStorage = new Store({ path: path.join(this.storageDirectory, 'data.json') });

        // Initialize the repository
        this.repository = new Repository(this);

        // Store the KSP installation
        this.installation = kspInstallation;
    }

    async init() {
        await this.repository.init();
    }

    // --- Internal stuff

    _getDependencyChoices(feature): [KSPModVersion] {
        return this.repository._compatibleMods
            .filter(providesFeature(feature));
    }

    _getMod(identifier): KSPModVersion {
        return this.repository._compatibleMods
            .find(mod => mod.identifier === identifier);
    }

    _getResolverForInstallationOf(mods): DependencyResolver {
        return new DependencyResolver(
            mods,
            id => {
                const resolved = this._getMod(id);
                if (!resolved) console.log("Unable to resolve mod:", id);
                return resolved;
            },
            feature => this._getDependencyChoices(feature)
        );
    }

    // --- ChangeSet methods

    queueForInstallation(modIdentifier) {
        // TODO Use getDependencyChoices instead. The identifier could be a feature.
        if (!this._getMod(modIdentifier))
            throw new Error(`Mod is not available for KSP ${this.kspVersion.stringRepresentation}`);

        // TODO Start downloading mod in the background if enabled

        this.changeSet[modIdentifier] = ChangeSetType.INSTALL;
    }

    queueForRemoval(modIdentifier) {
        // TODO This will remove dependencies of the mod even if the user manually installed them
        if (this.installation.installedMods.indexOf(modIdentifier) === -1)
            throw new Error(`${modIdentifier} is not currently installed.`);

        this.changeSet[modIdentifier] = ChangeSetType.UNINSTALL;
    }

    // --- Change set applying

    _buildDependencyTrees(): DependencyResolver {
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
        const resolver = this._getResolverForInstallationOf(newSetOfInstalled);
        resolver.buildDependencyTrees();

        // Check if the resolver would actually work
        if (resolver.resolvableSets.length === 0)
            throw new Error('Unresolvable changeset.'); // TODO Return which dependencies are unresolvable

        // Clear the changeSet and set the resolver.
        this.changeSet = {};

        return resolver;
    }

    async _buildFileMap(mods: Array<KSPModVersion>) {
        const fileTrees = await Promise.all(
            mods.map(async mod => await this.installation.modFileMap(mod))
        );

        const fileMap = fileTrees.reduce((finalTree, tree) => {
            tree.forEach(entry => {
                // TODO Handle conflicts according to the dependency tree (further up in tree takes priority)
                if (finalTree.hasOwnProperty(entry.destination)) console.warn("Overwriting destination directive!");
                finalTree[entry.destination] = entry
            });

            return finalTree;
        }, {});

        return Object.values(fileMap);
    }

    async applyChangeSet(resolveChoiceClosure: (choice: Object) => Promise<>, useLockFileForChoices: boolean = true) {
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

        const resolver: DependencyResolver = this._buildDependencyTrees();
        const installSet = await resolver.resolveChoices(choiceResolver);
        const pendingForInstall = Object.keys(installSet);
        const pendingForInstallMods = pendingForInstall.map(modID => this._getMod(modID));

        // TODO Move this to the resolver (thus making it version aware). Currently it always takes the latest one.
        Object.keys(installSet).forEach(modID => {
            installSet[modID].version = this._getMod(modID).version.stringRepresentation;
        });

        // TODO Download pending mods prior to destroying whats currently there

        // 1. Unlink all previously installed mods
        // TODO Use lock file to unlink previously installed versions (as new ones may not have the same files)
        console.log("Unlinking mods:", this.installation.installedMods);
        const previouslyInstalledMods = this.installation.installedMods.map(modID => this._getMod(modID));
        const currentFileTree = await this._buildFileMap(previouslyInstalledMods);
        await this.installation.unlinkFiles(currentFileTree);

        // 2. Write updated lock file
        console.log("Writing lockfile and updating installed mod list ...");
        this.installation.writeInstalledModsToLockFile(installSet);

        // 3. Link new and previously installed mods
        console.log("Linking mods:", pendingForInstall);
        const newFileTree = await this._buildFileMap(pendingForInstallMods);
        await this.installation.linkFiles(newFileTree)
    }
}