import KSPackage from '../src';
import DownloadManager from '../src/management/DownloadManager';

export default {
    depends: ['directories', 'installation', 'repository'],
    beforeEach: t => {
		t.context.kspackage = new KSPackage(t.context.installation, t.context.repository, t.context.directories, new DownloadManager());
    }
}