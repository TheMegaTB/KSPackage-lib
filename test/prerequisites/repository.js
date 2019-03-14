import test from 'ava';
import './directories';
import fs from "fs-extra";
import path from 'path';
import Repository from "../../src/metadata/Repository";

function createTestRepository(directories) {
    return new Repository(directories, async () => {
        return await fs.readFile('./test/metadata/data/testRepository.zip');
    });
}

test.beforeEach(async t => {
    t.context.repository = createTestRepository(t.context.directories);

    const storeFile = path.join(t.context.directories.storage, 'repository.json');
    const cacheFile = path.join(t.context.directories.cache, 'repository.json');

    await fs.ensureFile(storeFile);
    await fs.ensureFile(cacheFile);

    await fs.copyFile('./test/metadata/data/repositoryStore.json', storeFile);
    await fs.copyFile('./test/metadata/data/cachedRepository.json', cacheFile);

    // TODO Move cached repository files into place
    //      Loads quicker than unzipping and parsing everything again.
    await t.context.repository.loadFromCache();
});

test('Repository injected into the context', t => {
    t.true(t.context.hasOwnProperty('repository'));
});