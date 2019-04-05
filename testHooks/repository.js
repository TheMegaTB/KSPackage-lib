import fs from 'fs-extra';
import path from 'path';
import Repository from '../src/metadata/Repository';
import DownloadManager from '../src/management/DownloadManager';

function createTestRepository(directories) {
	// TODO Provide a dummy DownloadManager
	return new Repository(directories, new DownloadManager());
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