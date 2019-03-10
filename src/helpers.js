import fs from 'fs-extra';
import crypto from 'crypto';
import through2 from 'through2';
import klaw from 'klaw';

// -- Promise helpers --
export function DelayPromise(delay) {
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
const concat = (x, y) => x.concat(y);
export const flatMap = (xs, f) => xs.map(f).reduce(concat, []);

export const any = (arrayOrString, prefix) => {
    return (arrayOrString instanceof Array)
        ? arrayOrString.reduce((acc, x) => acc || prefix(x), false)
        : prefix(arrayOrString);
};

export const contains = (searchable, element) => searchable.indexOf(element) > -1;

export const flatten = function(arr, result = []) {
    for (let i = 0, length = arr.length; i < length; i++) {
        const value = arr[i];
        if (Array.isArray(value)) {
            flatten(value, result);
        } else {
            result.push(value);
        }
    }
    return result;
};

// -- RegExp stuff --
export const regexEscape = str => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

export const getLeadingPath = path => /\//.test(path) ? path.replace(/(^.*)\/.+/, '$1') : "";

// -- Filesystem --
const enumerateFilesInDirectoryRecursively = directoryPath => {
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

export const hashForFiles = async (filePaths, hashType = 'md5') => {
    const hash = crypto.createHash(hashType);
    hash.setEncoding('hex');

    for (let filePath of filePaths)
        await pipeFile(filePath, hash, { end: false });

    hash.end();
    return hash.read();
};

export const hashForDirectory = async (directoryPath, hashType) => {
    const files = await enumerateFilesInDirectoryRecursively(directoryPath);
    files.sort((a, b) => a < b);
    return await hashForFiles(files, hashType);
};