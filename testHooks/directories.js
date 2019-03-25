import path from 'path';
import fs from 'fs-extra';

function randomID() {
    return Math.random().toString(36).substring(7);
}

export default {
    beforeEach: async t => {
        let temp;
        const home = process.env.HOME || '/';
        switch (process.platform) {
            case 'darwin':
            case 'linux':
                temp = path.join(home, 'Library', 'Caches', 'KSPackageTest', randomID());
                break;
            case 'win32':
                let parent = process.env.TEMP || path.join('C:', 'tmp');
                temp = path.join(parent, 'KSPackageTest', randomID());
                break;
            default:
                throw new Error("Unrecognized operating system. Unable to setup test environment.");
        }

        t.context.testRootDirectory = temp;

        t.context.directories = {
            storage: path.join(temp, 'storage'),
            temporary: path.join(temp, 'temporary'),
            cache: path.join(temp, 'cache')
        };

        await fs.ensureDir(t.context.directories.storage);
        await fs.ensureDir(t.context.directories.temporary);
        await fs.ensureDir(t.context.directories.cache);

        t.log(t.context.testRootDirectory);
    },
    afterEach: t => fs.remove(t.context.testRootDirectory)
}