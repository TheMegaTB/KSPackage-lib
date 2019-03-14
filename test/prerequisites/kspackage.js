import test from 'ava';
import './directories'
import './installation'
import './repository'
import KSPackage from "../../src";

test.beforeEach(t => {
    t.context.kspackage = new KSPackage(t.context.installation, t.context.repository, t.context.directories);
});