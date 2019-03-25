import test from 'ava';
import {Version} from "../../src/metadata/Version";

function versionTest(inputString, expectedComponents, additionalTestClosure) {
    return t => {
        const v = new Version(inputString);
        t.deepEqual(v.components, expectedComponents);
        if (typeof additionalTestClosure === 'function') additionalTestClosure(t, v);
    }
}

test('Semantic version parse #1', versionTest('1.2.3', ['1', '2', '3']));
test('Semantic version parse #2', versionTest('12.3', ['12', '3']));
test('Semantic version parse #3', versionTest('12.2399.6.2', ['12', '2399', '6', '2']));

test('Strips unnecessary parts', versionTest('v1.399.5', ['1', '399', '5'], (t, v) => {
    t.falsy(v.appendage);
    t.falsy(v.release);
    t.false(v.wildcard);
}));

test('Splits appendages off', versionTest('1.1-beta', ['1', '1'], (t, v) => {
    t.is(v.appendage, 'beta');
}));

test('Parses release number', versionTest('1:1.5', ['1', '5'], (t, v) => {
    t.is(v.release, '1');
}));

test('Parses release with preceding `v`', versionTest('v1:1.5', ['1', '5'], (t, v) => {
    t.is(v.release, '1');
}));

test('Serializes correctly', t => {
    const v = new Version('v5:1.2-beta');
    t.is(v.stringRepresentation, '5:1.2-beta');
});

test('Serialization is deterministic', t => {
    const v = new Version('v5:1.2-beta');
    const stringRepresentation = v.stringRepresentation;
    const v2 = new Version(stringRepresentation);
    const reserializedStringRepresentation = v2.stringRepresentation;
    t.is(stringRepresentation, reserializedStringRepresentation);
});