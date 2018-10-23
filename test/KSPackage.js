import test from 'ava';
import KSPackage from "../src";

test.before(t => {
    t.context.kspackage = new KSPackage();
});

test('default directories are set', t => {
    t.true(t.context.kspackage.storageDirectory.length > 0);
    t.true(t.context.kspackage.temporaryDirectory.length > 0);
});