//@flow
import path from 'path';
import fs from 'fs-extra';
import yauzl from 'yauzl';
import request from 'request-promise-native';
import {Version} from "./Version";
import {KSPModVersion} from "./Mod";

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

            zipfile.readEntry();

            zipfile.on("entry", async (entry) => {
                if (/\/$/.test(entry.fileName)) {
                    // directory file names end with '/'
                    await fs.ensureDir(path.join(targetDir, entry.fileName));
                    zipfile.readEntry();
                } else {
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
                resolve(files);
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

        await downloadFile(modVersion.download, targetZipFile);
        const extractedFiles = await extractFile(targetZipFile, targetDirectory);

        console.log(extractedFiles);

        // TODO Resolve extractedFiles to [file : targetPath]
    }
}