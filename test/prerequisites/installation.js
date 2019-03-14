import test from "ava";
import fs from "fs-extra";
import path from 'path';
import KSPInstallation from "../../src/management/Installation";
import {Version} from "../../src/metadata/Version";
import './directories';

test.beforeEach(async t => {
    const kspDir = path.join(t.context.testRootDirectory, 'KSP');
    await fs.ensureDir(kspDir);
    t.context.installation = new KSPInstallation(kspDir, new Version('1.4.2'));
});

test('Installation injected into the context', t => {
    t.true(t.context.hasOwnProperty('installation'));
});