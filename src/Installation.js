//@flow
import path from 'path';
import fs from 'fs-extra';
import yauzl from 'yauzl';
import Store from 'data-store';
import {Version} from "./Version";
import {KSPModVersion} from "./Mod";
import {flatMap, hashForDirectory} from "./helpers";
import DownloadManager, {DownloadTask} from "./DownloadManager";
import type {ModIdentifier} from "./externalTypes/CKANModSpecification";

const extractFile = (archive, targetDir) => {
    return new Promise((resolve, reject) => {
        yauzl.open(archive, {lazyEntries: true}, (err, zipfile) => {
            if (err) reject(err);

            const files = [];
            const directories = new Set();

            zipfile.readEntry();

            zipfile.on("entry", async (entry) => {
                if (/\/$/.test(entry.fileName)) {
                    // directory file names end with '/'
                    directories.add(entry.fileName);
                    await fs.ensureDir(path.join(targetDir, entry.fileName));
                    zipfile.readEntry();
                } else {
                    // TODO Add all parent directories to directories
                    files.push(entry.fileName);
                    // ensure parent directory exists
                    await fs.ensureDir(path.dirname(path.join(targetDir, entry.fileName)));

                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) reject(err);
                        const writeStream = fs.createWriteStream(path.join(targetDir, entry.fileName));
                        writeStream.on("close", () => zipfile.readEntry());
                        writeStream.on('error', reject);
                        readStream.pipe(writeStream);
                    });
                }
            });

            zipfile.on("end", () => {
                resolve({files, directories});
            });
        });
    });
};

type InstalledModEntity = { explicit: boolean };
type InstalledModMap = { [string]: InstalledModEntity };
export type FileMapEntry = {
    source: string,
    destination: string,
    makeDirectories: boolean
};
export type FileMap = Array<FileMapEntry>;

export default class KSPInstallation {
    kspPath: string;
    kspVersion: Version;
    downloadManager: DownloadManager;
    lockFileStorage: Store;

    get metadataFolder(): string {
        return path.join(this.kspPath, '.kspackage');
    }

    get lockFilePath(): string {
        return path.join(this.metadataFolder, 'lockFile.json');
    }

    get installedModEntities(): InstalledModMap {
        return this.lockFileStorage.get('installed', {});
    }

    get installedMods(): Array<string> {
        return Object.keys(this.installedModEntities);
    }

    get explicitlyInstalledMods(): Array<string> {
        const entities = this.installedModEntities;
        return Object.keys(entities).filter(modID => entities[modID].explicit);
    }

    constructor(kspPath: string, kspVersion: ?Version) {
        this.kspPath = kspPath;
        this.downloadManager = new DownloadManager();
        this.lockFileStorage = new Store({ path: this.lockFilePath });

        if (kspVersion) this.kspVersion = kspVersion;

        // Try to detect KSP version, fallback to passed in version, throw if both are unavailable.
        try {
            const fileContent = fs.readFileSync(path.join(this.kspPath, 'readme.txt'), 'utf8');
            const version = /^Version\s+(\d+\.\d+\.\d+)/mi.exec(fileContent);
            if (version && version[1]) this.kspVersion = new Version(version[1]);
            else throw new Error("Unable to detect KSP version.");
        } catch (err) {
            if (!kspVersion) throw err;
        }
    }

    versionOfInstalledMod(identifier: ModIdentifier): ?Version {
        const stringRepresentation = this.lockFileStorage.get(`installed.${identifier}.version`);
        if (stringRepresentation) return new Version(stringRepresentation);
    }

    writeInstalledModsToLockFile(installSet: InstalledModMap) {
        this.lockFileStorage.set('installed', installSet);
    }

    async modFileMap(modVersion: KSPModVersion): Promise<FileMap> {
        const modVersionString = modVersion.version.stringRepresentation.replace(':', '-');
        const modVersionFolder = path.join(this.metadataFolder, 'mods', modVersion.identifier, modVersionString);
        const metaFile = path.join(modVersionFolder, 'meta.json');
        const archiveFile = path.join(modVersionFolder, 'dl.zip');
        const extractionDirectory = path.join(modVersionFolder, 'extracted');
        const relativeExtractionDirectory = path.relative(this.kspPath, extractionDirectory);

        await fs.ensureDir(extractionDirectory);

        // Check if the cache exists and return its contents
        if (await fs.exists(metaFile)) {
            try {
                const metadata = await fs.readJson(metaFile);

                if (metadata.uid !== modVersion.uid) throw new Error('UID mismatch.');
                if (!(metadata.fileMap instanceof Array)) throw new Error('Cache integrity compromised (fileMap).');

                // Generate a hash for the extracted files to check integrity
                const extractedFilesHash = await hashForDirectory(extractionDirectory);
                if (extractedFilesHash !== metadata.checksum) throw new Error('Cache integrity compromised (extraction).');

                return metadata.fileMap
            } catch (err) {
                console.error(`Failed to read cache for mod ${modVersion.identifier} with version ${modVersion.version.stringRepresentation}: ${err.message}`);
            }

            // TODO If we reached this point something went wrong. Clear the extraction directory!
        }

        await this.downloadManager.enqueue(new DownloadTask(modVersion.download, archiveFile, modVersion.downloadSize));

        const {files, directories} = await extractFile(archiveFile, extractionDirectory);

        const fileMap = flatMap(modVersion.install, installInstruction => {
            const directive = installInstruction.convertFindToFile(files, directories);

            let installDirectory;
            let makeDirectories;

            if (directive.install_to === 'GameData' || directive.install_to.startsWith('GameData/')) {
                if (directive.install_to.indexOf('/../') > -1 || directive.install_to.endsWith('/..'))
                    throw new Error(`Invalid installation path: ${directive.install_to}`);

                let subDirectory = directive.install_to.substr('GameData'.length);
                if (subDirectory.startsWith('/')) subDirectory = subDirectory.substr(1);

                installDirectory = path.join('GameData', subDirectory);
                makeDirectories = true;
            } else if (directive.install_to.startsWith('Ships')) {
                makeDirectories = false;

                switch (directive.install_to) {
                    case 'Ships':
                        installDirectory = path.join('Ships');
                        break;
                    case 'Ships/VAB':
                        installDirectory = path.join('Ships', 'VAB');
                        break;
                    case 'Ships/SPH':
                        installDirectory = path.join('Ships', 'SPH');
                        break;
                    case 'Ships/@thumbs':
                        installDirectory = path.join('Ships', '@thumbs');
                        break;
                    case 'Ships/@thumbs/VAB':
                        installDirectory = path.join('Ships', '@thumbs', 'VAB');
                        break;
                    case 'Ships/@thumbs/SPH':
                        installDirectory = path.join('Ships', '@thumbs', 'SPH');
                        break;
                    default:
                        throw new Error('Unknown install_to ' + directive.install_to);
                }
            } else {
                switch (directive.install_to) {
                    case 'Tutorial':
                        installDirectory = 'Tutorial';
                        makeDirectories = true;
                        break;

                    case 'Scenarios':
                        installDirectory = 'Scenarios';
                        makeDirectories = true;
                        break;

                    case 'Missions':
                        installDirectory = 'Missions';
                        makeDirectories = true;
                        break;

                    case 'GameRoot':
                        installDirectory = '.';
                        makeDirectories = false;
                        break;

                    default:
                        throw new Error('Unknown install_to ' + directive.install_to);
                }
            }

            return files
                .filter(file => directive.matches(file))
                .map(file => ({
                    source: path.join(relativeExtractionDirectory, file),
                    destination: directive.transformOutputName(file, installDirectory),
                    makeDirectories
                }));
        });

        if (fileMap.length === 0) throw new Error(`No files to install for mod ${modVersion.identifier}`);

        // Generate a meta-file for caching purposes
        const metaFileContent = {
            uid: modVersion.uid,
            checksum: await hashForDirectory(extractionDirectory),
            fileMap
        };

        await fs.writeJson(metaFile, metaFileContent);
        await fs.unlink(archiveFile);

        // Return the file map
        return fileMap;
    }

    async linkFiles(fileMap: FileMap): Promise<void> {
        await promiseWaterfall(fileMap, async entry => {
            const source = path.join(this.kspPath, entry.source);
            const destination = path.join(this.kspPath, entry.destination);
            const relativePath = path.relative(path.dirname(destination), source);

            if (entry.makeDirectories) await fs.mkdir(path.dirname(destination), { recursive: true });

            // TODO Provide configuration option on whether or not to use hard/soft links.
            await fs.symlink(relativePath, destination);
            // await fs.link(source, destination);
        });
    }

    async unlinkFiles(fileMap: FileMap): Promise<void> {
        for (let file of fileMap) {
            const filePath = path.join(this.kspPath, file.destination);
            // Remove the file
            try {
                await fs.unlink(filePath);

                // Recursively remove its parents if they are empty.
                await recursivelyRemoveEmptyParentDirectories(
                    path.dirname(filePath),
                    directory => path.normalize(path.join(directory, '..')) === this.kspPath
                );
            } catch (err) {
                console.error("Failed to remove file:", err);
            }
        }
    }
}

async function recursivelyRemoveEmptyParentDirectories(directory, blacklistClosure) {
    try {
        await fs.rmdir(directory);
    } catch (e) {
        if (e.code !== 'ENOTEMPTY') throw e;
        return;
    }

    const parent = path.normalize(path.join(directory, '..'));
    if (!blacklistClosure(parent)) await recursivelyRemoveEmptyParentDirectories(parent, blacklistClosure);
}

function promiseWaterfall(array, mapper) {
    return array.reduce((previousPromise, entry) => previousPromise.then(() => mapper(entry)), Promise.resolve());
}