import directories from './directories';
import repository from './repository';
import installation from './installation';
import kspackage from './kspackage';
import {flatMap, promiseWaterfall} from "../src/helpers";

const hooks = {
    directories,
    repository,
    installation,
    kspackage
};

const hookOrder = ['directories', 'installation', 'repository', 'kspackage'];

export async function callHooks(t, requestedHooks, hookType) {
    await promiseWaterfall(hookOrder, hookName => {
        if (!requestedHooks.has(hookName) || typeof hooks[hookName][hookType] !== 'function') return Promise.resolve();
        return hooks[hookName][hookType](t);
    });
}

export function registerHooks(test, hookNames) {
    const requestedHooks = new Set(flatMap(hookNames, name => hooks[name].depends.concat([name]) || [name]));

    test.beforeEach(t => callHooks(t, requestedHooks, 'beforeEach'));
    test.before(t => callHooks(t, requestedHooks, 'before'));
    test.afterEach(t => callHooks(t, requestedHooks, 'afterEach'));
    test.after(t => callHooks(t, requestedHooks, 'after'));
}