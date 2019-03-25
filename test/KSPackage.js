import test from 'ava';
import path from 'path';
import {ChangeSetType} from "../src";
import {registerHooks} from "../testHooks";
import klaw from "klaw";

function generateFSTree(directoryPath) {
    const items = []; // files, directories, symlinks, etc
    return new Promise((resolve, reject) => {
        klaw(directoryPath)
            .on('data', item => items.push(item.path))
            .on('end', () => resolve(items))
            .on('error', err => reject(err));
    });
}

async function generateKSPFileTree(t) {
    const gamePath = t.context.installation.kspPath;
    const files = await generateFSTree(gamePath);
    return files.map(filePath => path.relative(gamePath, filePath));
}

registerHooks(test, ['kspackage']);

test('Enqueuing mods for installation', t => {
    t.context.kspackage.queueForInstallation('AstronomersVisualPack');
    t.context.kspackage.queueForInstallation('kOS');

    t.deepEqual(t.context.kspackage.queuedChanges, {
        AstronomersVisualPack: ChangeSetType.INSTALL,
        kOS: ChangeSetType.INSTALL
    })
});

test('Enqueuing not installed mods for removal', t => {
    t.throws(() => {
        t.context.kspackage.queueForRemoval('Scatterer');
    });
});

test('Enqueuing non existing mods', t => {
    t.throws(() => {
        t.context.kspackage.queueForInstallation('SuperDuperMegaRandomNonExistingMod(HopeFully!@@#$%^&*_)');
    });
});

test('Enqueuing incompatible mods', t => {
    t.throws(() => {
        t.context.kspackage.queueForInstallation('SVE-Sunflare');
    });
});

test('Dequeuing mods', t => {
    t.context.installation.queueForInstallation('AstronomersVisualPack');
    t.context.installation.queueForInstallation('kOS');
    t.context.installation.queueForRemoval('Scatterer');

    t.context.kspackage.dequeue('AstronomersVisualPack');
    t.context.kspackage.dequeue('Scatterer');

    t.deepEqual(t.context.kspackage.queuedChanges, {
        kOS: ChangeSetType.INSTALL
    });
});

test('Installing mod', async t => {
    t.context.kspackage.queueForInstallation('ModuleManager');
    await t.context.kspackage.applyChangeSet(() => t.fail());
    t.snapshot(await generateKSPFileTree(t));
});

test('Installing mod with dependencies', async t => {
    t.context.kspackage.queueForInstallation('kOS');
    await t.context.kspackage.applyChangeSet(() => t.fail());
    t.snapshot(await generateKSPFileTree(t));
});

// TODO This test gets stuck for some reason
test.skip('Installing mod with dependencies and choices', async t => {
    t.context.kspackage.queueForInstallation('AstronomersVisualPack');
    await t.context.kspackage.applyChangeSet(() => t.fail());
    t.snapshot(await generateKSPFileTree(t));
});