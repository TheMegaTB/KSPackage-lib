import test from 'ava';
import path from 'path';
import fs from 'fs-extra';
import '../prerequisites/repository';

test('Fetch does not throw', async t => {
    await t.notThrowsAsync(async () => {
        await t.context.repository.fetch();
        t.is(t.context.repository._mods.length, 2151);
    });
});

test('Loading from valid cache does not throw', async t => {
    await t.notThrowsAsync(async () => {
        t.context.repository._mods = [];
        await t.context.repository.loadFromCache();
        t.is(t.context.repository._mods.length, 2151);
    });
});

test('Loading from invalid cache does throw', async t => {
    const repoFile = path.join(t.context.directories.cache, 'repository.json');
    await fs.appendFile(repoFile, '{ this file is no longer valid *duh* },dk*%&$#()@');

    t.context.repository._mods = [];

    await t.throwsAsync(async () => {
        await t.context.repository.loadFromCache();
        t.is(t.context.repository._mods.length, 2151);
    });
});