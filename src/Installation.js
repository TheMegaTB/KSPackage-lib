//@flow
import path from 'path';
import fs from 'fs-extra';
import yauzl from 'yauzl';
import request from 'request-promise-native';
import {Version} from "./Version";
import {KSPModVersion} from "./Mod";
import {flatMap} from "./helpers";

const downloadFile = (url, target) => {
    const writeStream = fs.createWriteStream(target, {flags: 'w'});

    let totalSize = 0;
    let downloadedSize = 0;

    return new Promise((resolve, reject) => {
        request.get(url)
            .on('response', data => {
                totalSize = data.headers['content-length'];
            })
            .on('data', data => {
                downloadedSize += data.length;
                // TODO Call progress callback every x bytes
            })
            .on('error', err => {
                writeStream.close();
                fs.unlink(target);
                reject(err.message);
            })
            .pipe(writeStream);

        writeStream.on('finish', () => {
            resolve();
        });
        writeStream.on('error', err => {
            writeStream.close();
            if (err.code !== 'EEXIST') fs.unlink(target);
            reject(err.message);
        })
    });
};

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

export default class KSPInstallation {
    kspPath: String;
    kspVersion: Version;

    constructor(kspPath: String, kspVersion: Version) {
        this.kspPath = kspPath;
        this.kspVersion = kspVersion;
    }

    get gameDataPath(): String {
        return path.join(this.kspPath, 'GameData');
    }

    get modStoragePath(): String {
        return path.join(this.kspPath, '.kspackage', 'mods');
    }

    pathForModVersion(modVersion: KSPModVersion): String {
        return path.join(this.modStoragePath, modVersion.identifier, modVersion.version.stringRepresentation);
    }

    async downloadModVersion(modVersion: KSPModVersion) {
        // TODO Look if the mod is already present. If so load the metadata from disk and use that instead.

        const targetDirectory = this.pathForModVersion(modVersion);
        const targetZipFile = path.join(targetDirectory, 'mod.zip');

        await fs.ensureDir(targetDirectory);

        const zipFileExists = await fs.exists(targetZipFile);
        if (zipFileExists) console.log("skipping download");
        if (!zipFileExists) await downloadFile(modVersion.download, targetZipFile);

        const {files, directories} = await extractFile(targetZipFile, targetDirectory);

        console.log(files);
        console.log(directories);
        console.log("directives:", modVersion.install);

        const fileMap = flatMap(modVersion.install, installInstruction => {
            const directive = installInstruction.convertFindToFile(files, directories);

            let installDirectory;
            let makeDirectories;

            if (directive.install_to === 'GameData' || directive.install_to.startsWith('GameData/')) {
                if (directive.install_to.indexOf('/../') > -1 || directive.install_to.endsWith('/..'))
                    throw new Error(`Invalid installation path: ${directive.install_to}`);

                let subDirectory = directive.install_to.substr('GameData'.length);
                if (subDirectory.startsWith('/')) subDirectory = subDirectory.substr(1);

                installDirectory = path.join(this.gameDataPath, subDirectory);
                makeDirectories = true;
            } else if (directive.install_to.startsWith('Ships')) {
                makeDirectories = false;

                switch (directive.install_to) {
                    case 'Ships':
                        installDirectory = path.join(this.kspPath, 'Ships');
                        break;
                    case 'Ships/VAB':
                        installDirectory = path.join(this.kspPath, 'Ships', 'VAB');
                        break;
                    case 'Ships/SPH':
                        installDirectory = path.join(this.kspPath, 'Ships', 'SPH');
                        break;
                    case 'Ships/@thumbs':
                        installDirectory = path.join(this.kspPath, 'Ships', '@thumbs');
                        break;
                    case 'Ships/@thumbs/VAB':
                        installDirectory = path.join(this.kspPath, 'Ships', '@thumbs', 'VAB');
                        break;
                    case 'Ships/@thumbs/SPH':
                        installDirectory = path.join(this.kspPath, 'Ships', '@thumbs', 'SPH');
                        break;
                    default:
                        throw new Error('Unknown install_to ' + directive.install_to);
                }
            } else {
                switch (directive.install_to) {
                    case 'Tutorial':
                        installDirectory = path.join(this.kspPath, 'Tutorial');
                        makeDirectories = true;
                        break;

                    case 'Scenarios':
                        installDirectory = path.join(this.kspPath, 'Scenarios');
                        makeDirectories = true;
                        break;

                    case 'Missions':
                        installDirectory = path.join(this.kspPath, 'Missions');
                        makeDirectories = true;
                        break;

                    case 'GameRoot':
                        installDirectory = this.kspPath;
                        makeDirectories = false;
                        break;

                    default:
                        throw new Error('Unknown install_to ' + directive.install_to);
                }
            }

            return files
                .filter(file => directive.matches(file))
                .map(file => ({
                    source: file,
                    destination: directive.transformOutputName(file, installDirectory),
                    makeDirectories
                }));
        });

        fileMap.forEach(mapping => {
            console.log(mapping.source);
            console.log(`\t${mapping.destination}\n`);
        });

        if (fileMap.length === 0) throw new Error(`No files to install for mod ${modVersion.identifier}`);
    }
}