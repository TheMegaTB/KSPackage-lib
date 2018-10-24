import test from 'ava';
import KSPackage from "../src";
import Repository from "../src/Repository";

test.before(t => {
    let kspackage = new KSPackage();
    t.context.repo = new Repository(kspackage);
});

test('fetching the repository does not throw', t => {
    t.context.repo.fetch().then(() => {
    });
});