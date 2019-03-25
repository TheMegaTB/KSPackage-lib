//@flow
import fs from 'fs-extra';
import crypto from 'crypto';
import through2 from 'through2';
import klaw from 'klaw';
import type {DirectorySet, Path} from "./types/internal";
import path from "path";

// -- Promise helpers --
export function promiseWaterfall<T>(array: Array<T>, mapper: (T) => Promise<any>): Promise<any> {
    return array.reduce((previousPromise, entry) => previousPromise.then(() => mapper(entry)), Promise.resolve());
}

export function DelayPromise<T>(delay: number): (T) => Promise<T> {
    //return a function that accepts a single variable
    return data => {
        //this function returns a promise.
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                //a promise that is resolved after "delay" milliseconds with the data provided
                resolve(data);
            }, delay);
        });
    }
}

// -- Array operations --
function concat<T>(x: Array<T>, y: Array<T> | T): Array<T> { return x.concat(y); }
export function flatMap<T, U>(xs: Array<T>, f: (T) => Array<U>): Array<U> {
    return xs.map(f).reduce(concat, []);
}
export function compactMap<T, U>(xs: Array<T>, f: (T) => ?U): Array<U> {
    return xs.reduce((acc, entry) => {
        const value = f(entry);
        if (value) acc.push(value);
        return acc;
    }, []);
}

export function any<T>(arrayOrString: Array<T> | T, prefix: (T) => boolean): boolean {
    return (arrayOrString instanceof Array)
        ? arrayOrString.reduce((acc, x) => acc || prefix(x), false)
        : prefix(arrayOrString);
}

// TODO This function should also get a string passed in.
//$FlowFixMe
export function contains<T>(searchable: Array<T>, element: T): boolean {
    return searchable.indexOf(element) > -1;
}

//$FlowFixMe
export function flatten(arr, result = []) {
    for (let i = 0, length = arr.length; i < length; i++) {
        const value = arr[i];
        if (Array.isArray(value)) {
            flatten(value, result);
        } else {
            result.push(value);
        }
    }
    return result;
}

// -- RegExp stuff --
export const regexEscape = (str: string): string => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

export const getLeadingPath = (path: Path): Path => /\//.test(path) ? path.replace(/(^.*)\/.+/, '$1') : "";

// -- Filesystem --
export const enumerateFilesInDirectoryRecursively = (directoryPath: Path): Promise<Array<Path>> => {
    const fileFilter = through2.obj(function (item, enc, next) {
        if (item.stats.isFile()) this.push(item);
        next();
    });

    const items = []; // files, directories, symlinks, etc
    return new Promise((resolve, reject) => {
        klaw(directoryPath, { preserveSymlinks: true })
            .pipe(fileFilter)
            .on('data', item => items.push(item.path))
            .on('end', () => resolve(items))
            .on('error', err => reject(err));
    });
};

const promisePipe = (source, destination, pipeOptions) => {
    return new Promise(((resolve, reject) => {
        source.on('end', resolve);
        source.on('error', reject);
        source.pipe(destination, pipeOptions);
    }));
};

const pipeFile = (path, destination, pipeOptions) => promisePipe(fs.createReadStream(path), destination, pipeOptions);

export async function hashForFiles(filePaths: Array<Path>, hashType: string = 'md5'): Promise<?(string | Buffer)> {
    const hash = crypto.createHash(hashType);
    hash.setEncoding('hex');

    for (let filePath of filePaths)
        await pipeFile(filePath, hash, { end: false });

    hash.end();
    return hash.read();
}

export async function hashForDirectory(directoryPath: Path, hashType: string = 'md5'): Promise<?(string | Buffer)> {
    const files = await enumerateFilesInDirectoryRecursively(directoryPath);
    files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return await hashForFiles(files, hashType);
}

export function groupBy<T, U>(array: Array<T>, keyClosure: (T) => U): { [U]: Array<T> } {
    const baseObject: { [U]: Array<T> } = {};
    return array.reduce((acc, entry) => {
        const key = keyClosure(entry);
        if (!acc.hasOwnProperty(key)) acc[key] = [];
        acc[key].push(entry);
        return acc;
    }, baseObject);
}

export function getPlatformSpecificDirectories(): DirectorySet {
    const directories = {
        storage: "",
        temporary: "",
        cache: ""
    };

    const home = process.env.HOME || '/';
    switch (process.platform) {
        case 'darwin': // macOS
            directories.storage = path.join(home, 'Library', 'Application Support', 'KSPackage');
            directories.temporary = path.join(home, 'Library', 'Caches', 'KSPackage'); // TODO Find a better location
            directories.cache = path.join(home, 'Library', 'Caches', 'KSPackage');
            break;
        case 'win32':
            const appData = process.env.APPDATA || 'C:\\appData';
            const temp = process.env.TEMP || 'C:\\tmp';
            directories.storage = path.join(appData, 'KSPackage');
            directories.temporary = path.join(temp, 'KSPackage');
            directories.cache = path.join(appData, 'KSPackage', 'cache');
            break;
        case 'linux':
            directories.storage = path.join(home, '.local', 'share', 'KSPackage');
            directories.temporary = path.join('/tmp', 'KSPackage');
            directories.cache = path.join(home, '.cache', 'KSPackage');
            break;
        default:
            throw new Error("Unrecognized operating system. Unable to set storage directories.");
    }

    return directories;
}