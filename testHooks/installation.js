import fs from "fs-extra";
import path from 'path';
import KSPInstallation from "../src/management/Installation";
import {Version} from "../src/metadata/Version";

export default {
    depends: ['directories'],
    beforeEach: async t => {
        const kspDir = path.join(t.context.testRootDirectory, 'KSP');
        await fs.ensureDir(kspDir);
        t.context.installation = new KSPInstallation(kspDir, new Version('1.4.2'));
    }
}