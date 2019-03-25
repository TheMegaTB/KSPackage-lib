import fs from "fs-extra";
import path from 'path';
import Repository from "../src/metadata/Repository";

function createTestRepository(directories) {
    return new Repository(directories, async () => {
        return await fs.readFile('./test/metadata/data/testRepository.zip');
    });
}

export default {
    depends: ['directories'],
    beforeEach: async t => {
        t.context.repository = createTestRepository(t.context.directories);

        const storeFile = path.join(t.context.directories.storage, 'repository.json');
        const cacheFile = path.join(t.context.directories.cache, 'repository.json');

        await fs.ensureFile(storeFile);
        await fs.ensureFile(cacheFile);

        await fs.copyFile('./test/metadata/data/repositoryStore.json', storeFile);
        await fs.copyFile('./test/metadata/data/cachedRepository.json', cacheFile);

        await t.context.repository.loadFromCache();
    }
}