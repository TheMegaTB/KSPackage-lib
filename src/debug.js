import KSPackage from "./";
import {Version} from "./metadata/Version";
import KSPInstallation from "./management/Installation";

init().then(() => {}).catch(err => console.error(err));

async function init() {

    const installation = new KSPInstallation(process.env.HOME + '/Downloads/KSP', new Version('1.4.2'));

    // Load repo from cache or fetch it
    console.time('kspackageInit');
    const kspackage = await KSPackage.create(installation);
    console.timeEnd('kspackageInit');

    await resolvingExample(kspackage);
}

async function resolvingExample(kspackage) {
    // Queue mod for install
    // kspackage.queueForRemoval('AstronomersVisualPack');
    // kspackage.queueForInstallation('AstronomersVisualPack');
    kspackage.queueForInstallation('Scatterer');
    // kspackage.queueForInstallation('kOS');
    // kspackage.queueForInstallation('NearFutureSolar');
    // kspackage.queueForInstallation('NearFutureElectrical');
    // kspackage.queueForInstallation('NearFuturePropulsion');
    // kspackage.queueForInstallation('NearFutureSpacecraft');
    // kspackage.queueForInstallation('Firespitter');
    // kspackage.queueForInstallation('SmartParts');
    // kspackage.queueForInstallation('kRPC');
    // kspackage.queueForInstallation('VesselView');

    // Get resolver
    await kspackage.applyChangeSet(async choice => {
        console.log(`Choices to satisfy feature '${choice.feature}' for mod '${choice.mod}':`);
        choice.choices.forEach((choice, id) => console.log(id, choice));

        const selected = await waitForInput();

        choice.select(choice.choices[selected]);
    });
}

function waitForInput() {
    return new Promise(resolve => {
        process.stdin.resume();

        process.stdin.once('data', function (data) {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    })
}

// console.dir(tree, {depth: null, colors: true});